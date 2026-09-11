import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  PaymentMethod,
  Prisma,
  StatementImportStatus,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
  StatementSourceFormat,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { EntitlementsService } from "../common/entitlements/entitlements.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { DEFAULT_MAX_STATEMENT_FILE_SIZE } from "../common/upload/statement-upload.config";
import { CardStatementProcessorService } from "./card-statement-processor.service";
import type { ParsedStatementData } from "./card-statements.types";
import { ConfirmStatementImportDto } from "./dto/confirm-statement-import.dto";
import { CreateStatementImportDto } from "./dto/create-statement-import.dto";
import { QueryStatementImportsDto } from "./dto/query-statement-imports.dto";
import {
  UpdateStatementRowDto,
  UpdateStatementRowsDto,
} from "./dto/update-statement-rows.dto";
import { StatementProcessingError } from "./parsers/statement-parser.interface";

const PDF_SIGNATURE = "%PDF-";
const DEFAULT_PAGE_SIZE = 20;
const STATEMENT_IMPORT_FEATURE = "statement_imports";
const ALLOWED_EXPENSE_KINDS = new Set<StatementRowKind>([
  StatementRowKind.CHARGE,
  StatementRowKind.INTEREST,
  StatementRowKind.TAX,
]);

type ExpenseCandidate = Prisma.StatementRowGetPayload<{
  select: {
    id: true;
    section: true;
    kind: true;
    transactionDate: true;
    description: true;
    merchantName: true;
    amount: true;
    currency: true;
    categoryId: true;
    linkedCreditCardId: true;
  };
}>;

@Injectable()
export class CardStatementsService {
  private readonly logger = new Logger(CardStatementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly statementProcessor: CardStatementProcessorService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async createImport(
    userId: string,
    dto: CreateStatementImportDto,
    file?: Express.Multer.File,
  ) {
    await this.assertPremium(userId);

    if (!file) {
      throw new BadRequestException("Statement PDF is required");
    }

    this.assertPdf(file);

    if (dto.creditCardId) {
      await this.assertCreditCardOwnership(userId, dto.creditCardId);
    }

    const sourceSha256 = createHash("sha256").update(file.buffer).digest("hex");
    const existing = await this.prisma.statementImport.findUnique({
      where: {
        userId_sourceSha256: {
          userId,
          sourceSha256,
        },
      },
      select: {
        id: true,
        status: true,
        version: true,
        warningCount: true,
        failureCode: true,
      },
    });

    if (existing) {
      return { ...existing, duplicate: true };
    }

    const sourceObjectKey = await this.storageService.uploadFile(
      file,
      `statements/${userId}`,
    );

    let statementImport: {
      id: string;
      status: StatementImportStatus;
      version: number;
    };
    try {
      statementImport = await this.prisma.statementImport.create({
        data: {
          userId,
          creditCardId: dto.creditCardId,
          sourceFormat: StatementSourceFormat.PDF,
          sourceFileName: this.normalizeFileName(file.originalname),
          sourceMimeType: file.mimetype,
          sourceSizeBytes: file.size,
          sourceSha256,
          sourceObjectKey,
        },
        select: {
          id: true,
          status: true,
          version: true,
        },
      });
    } catch (error) {
      await this.tryDeleteSourceObject(sourceObjectKey);

      if (this.isUniqueConstraintError(error)) {
        const concurrent = await this.prisma.statementImport.findUnique({
          where: {
            userId_sourceSha256: {
              userId,
              sourceSha256,
            },
          },
          select: {
            id: true,
            status: true,
            version: true,
            warningCount: true,
            failureCode: true,
          },
        });

        if (concurrent) {
          return { ...concurrent, duplicate: true };
        }
      }

      throw error;
    }

    const processed = await this.processImportBuffer(
      userId,
      statementImport.id,
      file.buffer,
    );
    return {
      id: processed.id,
      status: processed.status,
      version: processed.version,
      warningCount: processed.warningCount,
      failureCode: processed.failureCode,
      duplicate: false,
    };
  }

  async processStoredImport(userId: string, id: string) {
    await this.assertPremium(userId);

    const statementImport = await this.findOwnedImport(userId, id);
    if (
      statementImport.status !== StatementImportStatus.UPLOADED &&
      statementImport.status !== StatementImportStatus.FAILED
    ) {
      throw new ConflictException(
        "Only uploaded or failed imports can be processed",
      );
    }
    if (!statementImport.sourceObjectKey) {
      throw new ConflictException(
        "Statement source PDF is no longer available",
      );
    }

    const buffer = await this.readStoredSource(statementImport.sourceObjectKey);
    return this.processImportBuffer(userId, id, buffer);
  }

  async findAll(userId: string, query: QueryStatementImportsDto) {
    await this.assertPremium(userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.StatementImportWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.statementImport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          creditCardId: true,
          sourceFileName: true,
          sourceFormat: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          version: true,
          warningCount: true,
          parsedAt: true,
          confirmedAt: true,
          revertedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.statementImport.count({ where }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(userId: string, id: string) {
    await this.assertPremium(userId);

    const statementImport = await this.prisma.statementImport.findFirst({
      where: { id, userId },
      include: {
        creditCard: {
          select: {
            id: true,
            name: true,
            bank: true,
            brand: true,
            last4: true,
          },
        },
        reconciliation: true,
        paymentTargets: { orderBy: { position: "asc" } },
        instruments: {
          orderBy: { position: "asc" },
          include: {
            linkedCreditCard: {
              select: { id: true, name: true, bank: true, last4: true },
            },
          },
        },
        financingPlans: { orderBy: { position: "asc" } },
        rows: {
          orderBy: { position: "asc" },
          include: {
            category: true,
            linkedCreditCard: {
              select: { id: true, name: true, bank: true, last4: true },
            },
            expense: { select: { id: true } },
          },
        },
      },
    });

    if (!statementImport) {
      throw new NotFoundException("Statement import not found");
    }

    const { sourceObjectKey, ...publicImport } = statementImport;
    return {
      ...publicImport,
      sourceStored: Boolean(sourceObjectKey),
    };
  }

  async stageParsedStatement(
    userId: string,
    id: string,
    parsed: ParsedStatementData,
  ) {
    const statementImport = await this.findOwnedImport(userId, id);
    if (
      statementImport.status !== StatementImportStatus.UPLOADED &&
      statementImport.status !== StatementImportStatus.FAILED
    ) {
      throw new ConflictException(
        "Only uploaded or failed imports can receive parsed data",
      );
    }

    this.assertParsedStatementShape(parsed);

    await this.prisma.$transaction(async (tx) => {
      await this.assertOwnedReferences(
        tx,
        userId,
        parsed.rows.map((row) => row.categoryId),
        [
          statementImport.creditCardId,
          ...parsed.rows.map((row) => row.linkedCreditCardId),
          ...parsed.instruments.map(
            (instrument) => instrument.linkedCreditCardId,
          ),
        ],
      );

      await tx.statementRow.deleteMany({ where: { statementImportId: id } });
      await tx.statementFinancingPlan.deleteMany({
        where: { statementImportId: id },
      });
      await tx.statementInstrumentSnapshot.deleteMany({
        where: { statementImportId: id },
      });
      await tx.statementPaymentTarget.deleteMany({
        where: { statementImportId: id },
      });
      await tx.statementReconciliation.deleteMany({
        where: { statementImportId: id },
      });

      const instrumentIds = new Map<number, string>();
      for (const instrument of parsed.instruments) {
        const created = await tx.statementInstrumentSnapshot.create({
          data: {
            statementImportId: id,
            position: instrument.position,
            label: instrument.label,
            kind: instrument.kind,
            last4: instrument.last4,
            linkedCreditCardId: instrument.linkedCreditCardId,
          },
          select: { id: true },
        });
        instrumentIds.set(instrument.position, created.id);
      }

      const financingPlanIds = new Map<number, string>();
      for (const plan of parsed.financingPlans) {
        const created = await tx.statementFinancingPlan.create({
          data: {
            statementImportId: id,
            instrumentSnapshotId:
              plan.instrumentPosition === null ||
              plan.instrumentPosition === undefined
                ? null
                : instrumentIds.get(plan.instrumentPosition),
            type: plan.type,
            merchantName: plan.merchantName,
            purchaseDate: plan.purchaseDate,
            originalAmount: plan.originalAmount,
            installmentAmount: plan.installmentAmount,
            installmentNumber: plan.installmentNumber,
            installmentCount: plan.installmentCount,
            remainingAmount: plan.remainingAmount,
            currency: plan.currency,
            sourceRowNumber: plan.sourceRowNumber,
            position: plan.position,
          },
          select: { id: true },
        });
        financingPlanIds.set(plan.position, created.id);
      }

      if (parsed.paymentTargets.length > 0) {
        await tx.statementPaymentTarget.createMany({
          data: parsed.paymentTargets.map((target) => ({
            statementImportId: id,
            kind: target.kind,
            label: target.label,
            amount: target.amount,
            currency: target.currency,
            dueDate: target.dueDate,
            sourceRowNumber: target.sourceRowNumber,
            position: target.position,
          })),
        });
      }

      if (parsed.rows.length > 0) {
        await tx.statementRow.createMany({
          data: parsed.rows.map((row) => ({
            statementImportId: id,
            occurrenceKey: row.occurrenceKey,
            section: row.section,
            sourceRowNumber: row.sourceRowNumber,
            position: row.position,
            transactionDate: row.transactionDate,
            description: row.description,
            merchantName: row.merchantName,
            amount: row.amount,
            currency: row.currency,
            kind: row.kind,
            decision: row.decision ?? StatementRowDecision.PENDING,
            categoryId: row.categoryId,
            linkedCreditCardId: row.linkedCreditCardId,
            financingPlanId:
              row.financingPlanPosition === null ||
              row.financingPlanPosition === undefined
                ? null
                : financingPlanIds.get(row.financingPlanPosition),
            warningCodes: row.warningCodes,
            rawText: row.rawText,
          })),
        });
      }

      await tx.statementReconciliation.create({
        data: {
          statementImportId: id,
          ...parsed.reconciliation,
        },
      });

      const updated = await tx.statementImport.updateMany({
        where: {
          id,
          userId,
          version: statementImport.version,
          status: {
            in: [StatementImportStatus.UPLOADED, StatementImportStatus.FAILED],
          },
        },
        data: {
          status: StatementImportStatus.NEEDS_REVIEW,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          parserVersion: parsed.parserVersion,
          warningCount: parsed.warningCount,
          parsedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException("Statement import changed during parsing");
      }
    });

    return this.findOne(userId, id);
  }

  async updateRows(userId: string, id: string, dto: UpdateStatementRowsDto) {
    await this.assertPremium(userId);

    const statementImport = await this.findOwnedImport(userId, id);
    this.assertReviewable(
      statementImport.status,
      statementImport.version,
      dto.version,
    );

    const rowIds = dto.rows.map((row) => row.id);
    if (new Set(rowIds).size !== rowIds.length) {
      throw new BadRequestException(
        "Each statement row can be updated only once",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const ownedRows = await tx.statementRow.findMany({
        where: { statementImportId: id, id: { in: rowIds } },
        select: { id: true },
      });
      if (ownedRows.length !== rowIds.length) {
        throw new BadRequestException(
          "One or more statement rows do not belong to this import",
        );
      }

      for (const row of dto.rows) {
        await tx.statementRow.update({
          where: { id: row.id },
          data: this.buildRowUpdate(row),
        });
      }

      const candidates = await this.getExpenseCandidates(tx, id);
      await this.assertExpenseCandidates(
        tx,
        userId,
        statementImport.creditCardId,
        candidates,
      );

      const updated = await tx.statementImport.updateMany({
        where: {
          id,
          userId,
          version: dto.version,
          status: StatementImportStatus.NEEDS_REVIEW,
        },
        data: { version: { increment: 1 } },
      });

      if (updated.count !== 1) {
        throw new ConflictException("Statement import version is stale");
      }
    });

    return this.findOne(userId, id);
  }

  async confirm(userId: string, id: string, dto: ConfirmStatementImportDto) {
    await this.assertPremium(userId);

    const statementImport = await this.findOwnedImport(userId, id);
    if (statementImport.status === StatementImportStatus.CONFIRMED) {
      return this.buildIdempotentConfirmation(userId, id);
    }
    this.assertReviewable(
      statementImport.status,
      statementImport.version,
      dto.version,
    );

    const createdExpenseCount = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.statementImport.updateMany({
        where: {
          id,
          userId,
          version: dto.version,
          status: StatementImportStatus.NEEDS_REVIEW,
        },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Statement import version is stale");
      }

      const current = await tx.statementImport.findUnique({
        where: { id },
        include: {
          reconciliation: true,
          rows: true,
        },
      });
      if (!current) {
        throw new NotFoundException("Statement import not found");
      }
      if (
        !current.reconciliation ||
        current.reconciliation.status !== StatementReconciliationStatus.PASSED
      ) {
        throw new BadRequestException(
          "Statement reconciliation must pass before confirmation",
        );
      }
      if (
        current.rows.some(
          (row) => row.decision === StatementRowDecision.PENDING,
        )
      ) {
        throw new BadRequestException(
          "All statement rows must be reviewed before confirmation",
        );
      }

      const candidates = current.rows.filter(
        (row) => row.decision === StatementRowDecision.INCLUDE_EXPENSE,
      );
      if (candidates.length === 0) {
        throw new BadRequestException(
          "At least one statement row must be included as an expense",
        );
      }

      await this.assertExpenseCandidates(
        tx,
        userId,
        current.creditCardId,
        candidates,
      );

      await tx.expense.createMany({
        data: candidates.map((row) => ({
          userId,
          title: (row.merchantName || row.description).slice(0, 120),
          merchantName: row.merchantName,
          cost: row.amount,
          currency: row.currency,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          creditCardId: row.linkedCreditCardId ?? current.creditCardId,
          categoryId: row.categoryId,
          date: row.transactionDate as Date,
          note: "Imported from a reviewed credit-card statement",
          statementRowId: row.id,
        })),
      });

      await tx.statementImport.update({
        where: { id },
        data: {
          status: StatementImportStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      return candidates.length;
    });

    const sourceDeletionPending = !(await this.deleteStoredSource(
      userId,
      id,
      statementImport.sourceObjectKey,
    ));

    return {
      import: await this.findOne(userId, id),
      createdExpenseCount,
      alreadyConfirmed: false,
      sourceDeletionPending,
    };
  }

  async revert(userId: string, id: string, dto: ConfirmStatementImportDto) {
    await this.assertPremium(userId);

    const statementImport = await this.findOwnedImport(userId, id);
    if (statementImport.status === StatementImportStatus.REVERTED) {
      return {
        import: await this.findOne(userId, id),
        deletedExpenseCount: 0,
        alreadyReverted: true,
      };
    }
    if (statementImport.status !== StatementImportStatus.CONFIRMED) {
      throw new ConflictException("Only confirmed imports can be reverted");
    }
    if (statementImport.version !== dto.version) {
      throw new ConflictException("Statement import version is stale");
    }

    const deletedExpenseCount = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.statementImport.updateMany({
        where: {
          id,
          userId,
          version: dto.version,
          status: StatementImportStatus.CONFIRMED,
        },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Statement import version is stale");
      }

      const importedRows = await tx.statementRow.findMany({
        where: { statementImportId: id },
        select: { id: true },
      });
      const deleted = await tx.expense.deleteMany({
        where: { statementRowId: { in: importedRows.map((row) => row.id) } },
      });

      await tx.statementImport.update({
        where: { id },
        data: {
          status: StatementImportStatus.REVERTED,
          revertedAt: new Date(),
        },
      });

      return deleted.count;
    });

    await this.deleteStoredSource(userId, id, statementImport.sourceObjectKey);

    return {
      import: await this.findOne(userId, id),
      deletedExpenseCount,
      alreadyReverted: false,
    };
  }

  private async buildIdempotentConfirmation(userId: string, id: string) {
    const createdExpenseCount = await this.prisma.expense.count({
      where: {
        statementRow: { statementImportId: id },
        userId,
      },
    });
    const statementImport = await this.findOne(userId, id);

    return {
      import: statementImport,
      createdExpenseCount,
      alreadyConfirmed: true,
      sourceDeletionPending: statementImport.sourceStored,
    };
  }

  private async findOwnedImport(userId: string, id: string) {
    const statementImport = await this.prisma.statementImport.findFirst({
      where: { id, userId },
    });
    if (!statementImport) {
      throw new NotFoundException("Statement import not found");
    }
    return statementImport;
  }

  private async processImportBuffer(
    userId: string,
    id: string,
    buffer: Buffer,
  ) {
    let parsed: ParsedStatementData;
    try {
      parsed = await this.statementProcessor.process(buffer);
    } catch (error) {
      const processingError =
        error instanceof StatementProcessingError
          ? error
          : new StatementProcessingError(
              "STATEMENT_PROCESSING_FAILED",
              "The statement could not be processed",
            );
      await this.markProcessingFailed(userId, id, processingError);
      return this.findOne(userId, id);
    }

    return this.stageParsedStatement(userId, id, parsed);
  }

  private async markProcessingFailed(
    userId: string,
    id: string,
    error: StatementProcessingError,
  ) {
    const updated = await this.prisma.statementImport.updateMany({
      where: {
        id,
        userId,
        status: {
          in: [StatementImportStatus.UPLOADED, StatementImportStatus.FAILED],
        },
      },
      data: {
        status: StatementImportStatus.FAILED,
        failureCode: error.code,
        failureMessage: error.message,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException("Statement import changed during processing");
    }
  }

  private async readStoredSource(sourceObjectKey: string) {
    const file = await this.storageService.getFileStream(sourceObjectKey);
    if (
      file.contentLength !== null &&
      file.contentLength > DEFAULT_MAX_STATEMENT_FILE_SIZE
    ) {
      throw new BadRequestException("Stored statement exceeds the file limit");
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const rawChunk of file.stream as AsyncIterable<
      Buffer | string
    >) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk, "utf8");
      size += chunk.length;
      if (size > DEFAULT_MAX_STATEMENT_FILE_SIZE) {
        throw new BadRequestException(
          "Stored statement exceeds the file limit",
        );
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  private assertReviewable(
    status: StatementImportStatus,
    currentVersion: number,
    requestedVersion: number,
  ) {
    if (status !== StatementImportStatus.NEEDS_REVIEW) {
      throw new ConflictException("Statement import is not awaiting review");
    }
    if (currentVersion !== requestedVersion) {
      throw new ConflictException("Statement import version is stale");
    }
  }

  private buildRowUpdate(row: UpdateStatementRowDto) {
    return {
      ...(row.decision !== undefined ? { decision: row.decision } : {}),
      ...(row.kind !== undefined ? { kind: row.kind } : {}),
      ...(row.transactionDate !== undefined
        ? { transactionDate: new Date(row.transactionDate) }
        : {}),
      ...(row.description !== undefined
        ? { description: row.description }
        : {}),
      ...(row.merchantName !== undefined
        ? { merchantName: row.merchantName }
        : {}),
      ...(row.amount !== undefined ? { amount: row.amount } : {}),
      ...(row.currency !== undefined ? { currency: row.currency } : {}),
      ...(row.categoryId !== undefined ? { categoryId: row.categoryId } : {}),
      ...(row.linkedCreditCardId !== undefined
        ? { linkedCreditCardId: row.linkedCreditCardId }
        : {}),
      ...(row.decisionNote !== undefined
        ? { decisionNote: row.decisionNote }
        : {}),
    };
  }

  private getExpenseCandidates(tx: Prisma.TransactionClient, importId: string) {
    return tx.statementRow.findMany({
      where: {
        statementImportId: importId,
        decision: StatementRowDecision.INCLUDE_EXPENSE,
      },
      select: {
        id: true,
        section: true,
        kind: true,
        transactionDate: true,
        description: true,
        merchantName: true,
        amount: true,
        currency: true,
        categoryId: true,
        linkedCreditCardId: true,
      },
    });
  }

  private async assertExpenseCandidates(
    tx: Prisma.TransactionClient,
    userId: string,
    importCreditCardId: string | null,
    candidates: ExpenseCandidate[],
  ) {
    for (const row of candidates) {
      if (
        row.section === StatementSection.CFDI ||
        !ALLOWED_EXPENSE_KINDS.has(row.kind)
      ) {
        throw new BadRequestException(
          `Statement row ${row.id} cannot be included as an expense`,
        );
      }
      if (!row.transactionDate) {
        throw new BadRequestException(
          `Statement row ${row.id} requires a transaction date`,
        );
      }
      if (!row.categoryId) {
        throw new BadRequestException(
          `Statement row ${row.id} requires a category`,
        );
      }
      if (!row.linkedCreditCardId && !importCreditCardId) {
        throw new BadRequestException(
          `Statement row ${row.id} requires a linked credit card`,
        );
      }
      if (Number(row.amount) <= 0) {
        throw new BadRequestException(
          `Statement row ${row.id} requires a positive amount`,
        );
      }
      if (!/^[A-Z]{3}$/.test(row.currency)) {
        throw new BadRequestException(
          `Statement row ${row.id} has an invalid currency`,
        );
      }
    }

    await this.assertOwnedReferences(
      tx,
      userId,
      candidates.map((row) => row.categoryId),
      candidates.map((row) => row.linkedCreditCardId ?? importCreditCardId),
    );
  }

  private async assertOwnedReferences(
    tx: Prisma.TransactionClient,
    userId: string,
    categoryIds: Array<string | null | undefined>,
    creditCardIds: Array<string | null | undefined>,
  ) {
    const uniqueCategoryIds = this.uniqueValues(categoryIds);
    const uniqueCreditCardIds = this.uniqueValues(creditCardIds);

    if (uniqueCategoryIds.length > 0) {
      const categoryCount = await tx.category.count({
        where: { userId, id: { in: uniqueCategoryIds } },
      });
      if (categoryCount !== uniqueCategoryIds.length) {
        throw new BadRequestException(
          "One or more selected categories are not available",
        );
      }
    }

    if (uniqueCreditCardIds.length > 0) {
      const creditCardCount = await tx.creditCard.count({
        where: { userId, id: { in: uniqueCreditCardIds } },
      });
      if (creditCardCount !== uniqueCreditCardIds.length) {
        throw new BadRequestException(
          "One or more selected credit cards are not available",
        );
      }
    }
  }

  private uniqueValues(values: Array<string | null | undefined>) {
    return Array.from(
      new Set(values.filter((value): value is string => Boolean(value))),
    );
  }

  private async assertCreditCardOwnership(
    userId: string,
    creditCardId: string,
  ) {
    const card = await this.prisma.creditCard.findFirst({
      where: { id: creditCardId, userId },
      select: { id: true },
    });
    if (!card) {
      throw new BadRequestException("Selected credit card is not available");
    }
  }

  private assertPdf(file: Express.Multer.File) {
    const signature = file.buffer
      .subarray(0, PDF_SIGNATURE.length)
      .toString("ascii");
    if (file.mimetype !== "application/pdf" || signature !== PDF_SIGNATURE) {
      throw new BadRequestException("Invalid PDF statement");
    }
  }

  private normalizeFileName(fileName: string) {
    const normalized = fileName.split(/[\\/]/).pop()?.trim();
    return normalized ? normalized.slice(0, 255) : null;
  }

  private assertParsedStatementShape(parsed: ParsedStatementData) {
    if (parsed.periodEnd < parsed.periodStart) {
      throw new BadRequestException(
        "Statement period end cannot be before period start",
      );
    }
    if (!parsed.parserVersion.trim()) {
      throw new BadRequestException("Parser version is required");
    }
    if (!Number.isInteger(parsed.warningCount) || parsed.warningCount < 0) {
      throw new BadRequestException(
        "Warning count must be a non-negative integer",
      );
    }

    this.assertUniqueNumbers(
      parsed.instruments.map((item) => item.position),
      "instrument positions",
    );
    this.assertUniqueNumbers(
      parsed.financingPlans.map((item) => item.position),
      "financing plan positions",
    );
    this.assertUniqueNumbers(
      parsed.paymentTargets.map((item) => item.position),
      "payment target positions",
    );
    this.assertUniqueNumbers(
      parsed.rows.map((item) => item.position),
      "statement row positions",
    );

    const occurrenceKeys = parsed.rows.map((row) => row.occurrenceKey);
    if (
      occurrenceKeys.some((key) => !key.trim()) ||
      new Set(occurrenceKeys).size !== occurrenceKeys.length
    ) {
      throw new BadRequestException(
        "Statement row occurrence keys must be non-empty and unique",
      );
    }

    const instrumentPositions = new Set(
      parsed.instruments.map((item) => item.position),
    );
    if (
      parsed.financingPlans.some(
        (plan) =>
          plan.instrumentPosition !== null &&
          plan.instrumentPosition !== undefined &&
          !instrumentPositions.has(plan.instrumentPosition),
      )
    ) {
      throw new BadRequestException(
        "A financing plan references an unknown instrument position",
      );
    }

    const planPositions = new Set(
      parsed.financingPlans.map((item) => item.position),
    );
    if (
      parsed.rows.some(
        (row) =>
          row.financingPlanPosition !== null &&
          row.financingPlanPosition !== undefined &&
          !planPositions.has(row.financingPlanPosition),
      )
    ) {
      throw new BadRequestException(
        "A statement row references an unknown financing plan position",
      );
    }
  }

  private assertUniqueNumbers(values: number[], label: string) {
    if (
      values.some((value) => !Number.isInteger(value) || value < 0) ||
      new Set(values).size !== values.length
    ) {
      throw new BadRequestException(
        `${label} must be unique non-negative integers`,
      );
    }
  }

  private async deleteStoredSource(
    userId: string,
    importId: string,
    sourceObjectKey: string | null,
  ) {
    if (!sourceObjectKey) {
      return true;
    }

    const deleted = await this.tryDeleteSourceObject(sourceObjectKey, importId);
    if (deleted) {
      await this.prisma.statementImport.updateMany({
        where: { id: importId, userId, sourceObjectKey },
        data: { sourceObjectKey: null },
      });
    }
    return deleted;
  }

  private async tryDeleteSourceObject(
    sourceObjectKey: string,
    importId?: string,
  ) {
    try {
      await this.storageService.deleteFile(sourceObjectKey);
      return true;
    } catch {
      this.logger.warn(
        importId
          ? `Statement source deletion is pending for import ${importId}`
          : "Could not clean up an unreferenced statement upload",
      );
      return false;
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return error instanceof Error && "code" in error && error.code === "P2002";
  }

  private assertPremium(userId: string) {
    return this.entitlementsService.assertPremium(
      userId,
      STATEMENT_IMPORT_FEATURE,
    );
  }
}
