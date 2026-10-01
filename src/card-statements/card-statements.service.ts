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
import { MarkStatementPaidDto } from "./dto/mark-statement-paid.dto";
import { StatementPaymentsService } from "./statement-payments.service";
import {
  MATCHES_REGISTERED_EXPENSE_CODE,
  matchStatementRowsToExpenses,
} from "./statement-expense-matcher";

const PDF_SIGNATURE = "%PDF-";
const DEFAULT_PAGE_SIZE = 20;
const STATEMENT_IMPORT_FEATURE = "statement_imports";
const STATEMENT_CYCLE_CONFLICT_CODE = "STATEMENT_CYCLE_CONFLICT";
const STATEMENT_CYCLE_CONFLICT_MESSAGE =
  "A statement import already owns this card billing cycle";
const MATCH_WINDOW_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
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
    private readonly statementPaymentsService: StatementPaymentsService,
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
        failureMessage: true,
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
            failureMessage: true,
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
      failureMessage: processed.failureMessage,
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

    if (query.creditCardId) {
      await this.assertCreditCardOwnership(userId, query.creditCardId);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.StatementImportWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.creditCardId ? { creditCardId: query.creditCardId } : {}),
    };

    const [rawItems, total] = await this.prisma.$transaction([
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
          isPaid: true,
          paidAt: true,
          paidAmount: true,
          paymentStatus: true,
          paymentVersion: true,
          reconciliation: {
            select: { closingBalance: true, currency: true, status: true },
          },
          paymentTargets: {
            orderBy: { position: "asc" },
            select: {
              kind: true,
              amount: true,
              currency: true,
              dueDate: true,
              position: true,
            },
          },
          payments: {
            select: { amount: true, currency: true, voidedAt: true },
          },
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.statementImport.count({ where }),
    ]);
    const items = rawItems.map(({ paymentTargets, payments, ...item }) => ({
      ...item,
      paymentSummary: this.statementPaymentsService.summarize({
        reconciliation: item.reconciliation,
        paymentTargets,
        payments,
      }),
    }));

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
            currency: true,
          },
        },
        reconciliation: true,
        paymentTargets: { orderBy: { position: "asc" } },
        payments: {
          orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        },
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
            matchedExpense: {
              select: { id: true, title: true, cost: true, date: true },
            },
          },
        },
      },
    });

    if (!statementImport) {
      throw new NotFoundException("Statement import not found");
    }

    const { sourceObjectKey, rows, payments, ...publicImport } =
      statementImport;
    const publicRows = rows.map(({ rawText, ...row }) => {
      void rawText;
      return { ...row, isAdjusted: this.hasAccountingAdjustment(row) };
    });
    return {
      ...publicImport,
      paymentSummary: this.statementPaymentsService.summarize(statementImport),
      paymentHistory: payments,
      rows: publicRows,
      adjustmentCount: publicRows.filter((row) => row.isAdjusted).length,
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

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.assertNoDuplicateCycle(tx, {
          id,
          userId,
          creditCardId: statementImport.creditCardId,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
        });
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

        const expenseMatches = await this.matchRegisteredExpenses(
          tx,
          userId,
          statementImport.creditCardId,
          parsed,
        );

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
              parsedTransactionDate: row.transactionDate,
              parsedAmount: row.amount,
              parsedCurrency: row.currency,
              parsedKind: row.kind,
              decision: expenseMatches.has(row.occurrenceKey)
                ? StatementRowDecision.INFO_ONLY
                : (row.decision ?? StatementRowDecision.PENDING),
              matchedExpenseId: expenseMatches.get(row.occurrenceKey) ?? null,
              categoryId: row.categoryId,
              linkedCreditCardId: row.linkedCreditCardId,
              financingPlanId:
                row.financingPlanPosition === null ||
                row.financingPlanPosition === undefined
                  ? null
                  : financingPlanIds.get(row.financingPlanPosition),
              warningCodes: expenseMatches.has(row.occurrenceKey)
                ? [...(row.warningCodes ?? []), MATCHES_REGISTERED_EXPENSE_CODE]
                : row.warningCodes,
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
              in: [
                StatementImportStatus.UPLOADED,
                StatementImportStatus.FAILED,
              ],
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
          throw new ConflictException(
            "Statement import changed during parsing",
          );
        }
      });
    } catch (error) {
      if (this.isStatementCycleConstraintError(error)) {
        throw this.statementCycleConflict();
      }
      throw error;
    }

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
      });
      if (ownedRows.length !== rowIds.length) {
        throw new BadRequestException(
          "One or more statement rows do not belong to this import",
        );
      }

      for (const row of dto.rows) {
        const currentRow = ownedRows.find((ownedRow) => ownedRow.id === row.id);
        if (!currentRow) {
          throw new BadRequestException(
            "One or more statement rows do not belong to this import",
          );
        }
        const rowUpdate = {
          ...this.buildRowUpdate(row),
          ...this.buildMatchClearUpdate(currentRow, row),
        };
        const projectedRow = {
          ...currentRow,
          ...rowUpdate,
        };
        this.assertAdjustmentJustified(projectedRow);
        await tx.statementRow.update({
          where: { id: row.id },
          data: rowUpdate,
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

    const confirmation = await this.prisma.$transaction(async (tx) => {
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
      current.rows.forEach((row) => this.assertAdjustmentJustified(row));

      const candidates = current.rows.filter(
        (row) => row.decision === StatementRowDecision.INCLUDE_EXPENSE,
      );
      const matchedRows = current.rows.filter(
        (row) =>
          row.decision === StatementRowDecision.INFO_ONLY &&
          Boolean(row.matchedExpenseId),
      );
      if (candidates.length === 0 && matchedRows.length === 0) {
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

      if (candidates.length > 0) {
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
      }

      // Rows matched to an already-registered expense adopt that expense
      // instead of creating a duplicate. An expense that was linked elsewhere
      // or deleted since staging is skipped, never failing the confirmation.
      let linkedExpenseCount = 0;
      for (const row of matchedRows) {
        const linked = await tx.expense.updateMany({
          where: {
            id: row.matchedExpenseId as string,
            userId,
            statementRowId: null,
          },
          data: { statementRowId: row.id },
        });
        linkedExpenseCount += linked.count;
      }

      await tx.statementImport.update({
        where: { id },
        data: {
          status: StatementImportStatus.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

      return {
        createdExpenseCount: candidates.length,
        linkedExpenseCount,
        skippedMatchedExpenseCount: matchedRows.length - linkedExpenseCount,
      };
    });

    const sourceDeletionPending = !(await this.deleteStoredSource(
      userId,
      id,
      statementImport.sourceObjectKey,
    ));

    return {
      import: await this.findOne(userId, id),
      ...confirmation,
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
        unlinkedExpenseCount: 0,
        alreadyReverted: true,
      };
    }
    if (statementImport.status !== StatementImportStatus.CONFIRMED) {
      throw new ConflictException("Only confirmed imports can be reverted");
    }
    if (statementImport.version !== dto.version) {
      throw new ConflictException("Statement import version is stale");
    }

    const revertion = await this.prisma.$transaction(async (tx) => {
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
        select: { id: true, matchedExpenseId: true },
      });
      const rowIds = importedRows.map((row) => row.id);
      const matchedExpenseIds = importedRows.flatMap((row) =>
        row.matchedExpenseId ? [row.matchedExpenseId] : [],
      );

      // Pre-existing (manually registered) expenses adopted by this import are
      // only unlinked; just the expenses created from rows are deleted.
      let unlinkedExpenseCount = 0;
      if (matchedExpenseIds.length > 0) {
        const unlinked = await tx.expense.updateMany({
          where: {
            statementRowId: { in: rowIds },
            id: { in: matchedExpenseIds },
          },
          data: { statementRowId: null },
        });
        unlinkedExpenseCount = unlinked.count;
      }
      const deleted = await tx.expense.deleteMany({
        where: {
          statementRowId: { in: rowIds },
          id: { notIn: matchedExpenseIds },
        },
      });

      await tx.statementImport.update({
        where: { id },
        data: {
          status: StatementImportStatus.REVERTED,
          revertedAt: new Date(),
        },
      });

      return {
        deletedExpenseCount: deleted.count,
        unlinkedExpenseCount,
      };
    });

    await this.deleteStoredSource(userId, id, statementImport.sourceObjectKey);

    return {
      import: await this.findOne(userId, id),
      ...revertion,
      alreadyReverted: false,
    };
  }

  async resume(userId: string, id: string, dto: ConfirmStatementImportDto) {
    await this.assertPremium(userId);

    const statementImport = await this.findOwnedImport(userId, id);
    if (statementImport.status !== StatementImportStatus.REVERTED) {
      throw new ConflictException("Only reverted imports can be resumed");
    }
    if (statementImport.version !== dto.version) {
      throw new ConflictException("Statement import version is stale");
    }

    const claimed = await this.prisma.statementImport.updateMany({
      where: {
        id,
        userId,
        version: dto.version,
        status: StatementImportStatus.REVERTED,
      },
      data: {
        status: StatementImportStatus.NEEDS_REVIEW,
        revertedAt: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException("Statement import version is stale");
    }

    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.assertPremium(userId);

    const statementImport = await this.findOwnedImport(userId, id);
    if (statementImport.status === StatementImportStatus.CONFIRMED) {
      throw new ConflictException("Revert this statement before deleting it.");
    }
    const paymentCount = await this.prisma.statementPayment.count({
      where: { statementImportId: id },
    });
    if (paymentCount > 0) {
      throw new ConflictException(
        "Statements with payment history cannot be deleted",
      );
    }

    await this.deleteStoredSource(userId, id, statementImport.sourceObjectKey);
    await this.prisma.statementImport.delete({ where: { id } });

    return { message: "Statement import deleted" };
  }

  async setPaidStatus(userId: string, id: string, dto: MarkStatementPaidDto) {
    await this.assertPremium(userId);
    const statementImport = await this.findOwnedImport(userId, id);
    if (!dto.isPaid) {
      await this.statementPaymentsService.clearCompatibilityStatus(userId, id);
      return this.findOne(userId, id);
    }
    if (dto.amount === undefined) {
      throw new BadRequestException("Payment amount is required");
    }
    await this.statementPaymentsService.createCompatibilityPayment(userId, id, {
      amount: dto.amount,
      expectedVersion: dto.expectedVersion ?? statementImport.paymentVersion,
      currency: dto.currency,
    });
    return this.findOne(userId, id);
  }

  private async buildIdempotentConfirmation(userId: string, id: string) {
    const [createdExpenseCount, linkedExpenseCount] = await Promise.all([
      this.prisma.expense.count({
        where: {
          statementRow: { statementImportId: id, matchedExpenseId: null },
          userId,
        },
      }),
      this.prisma.expense.count({
        where: {
          statementRow: {
            statementImportId: id,
            matchedExpenseId: { not: null },
          },
          userId,
        },
      }),
    ]);
    const statementImport = await this.findOne(userId, id);

    return {
      import: statementImport,
      createdExpenseCount,
      linkedExpenseCount,
      skippedMatchedExpenseCount: 0,
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
      if (!(error instanceof StatementProcessingError)) {
        // An unexpected (non-parser) failure — the client only ever sees the
        // generic message above, so this is the only place the real cause
        // is recoverable.
        this.logger.error(
          `Unexpected error processing statement import ${id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      }
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
        ? { decisionNote: this.normalizeDecisionNote(row.decisionNote) }
        : {}),
    };
  }

  /** Drops a stale expense match once the user overrides the INFO_ONLY decision. */
  private buildMatchClearUpdate(
    currentRow: { matchedExpenseId?: string | null; warningCodes?: unknown },
    update: UpdateStatementRowDto,
  ) {
    if (
      !currentRow.matchedExpenseId ||
      update.decision === undefined ||
      update.decision === StatementRowDecision.INFO_ONLY
    ) {
      return {};
    }
    const warningCodes = Array.isArray(currentRow.warningCodes)
      ? (currentRow.warningCodes as string[]).filter(
          (code) => code !== MATCHES_REGISTERED_EXPENSE_CODE,
        )
      : [];
    return { matchedExpenseId: null, warningCodes };
  }

  private async matchRegisteredExpenses(
    tx: Prisma.TransactionClient,
    userId: string,
    creditCardId: string | null,
    parsed: ParsedStatementData,
  ): Promise<Map<string, string>> {
    if (!creditCardId || parsed.rows.length === 0) {
      return new Map();
    }
    const windowMs = MATCH_WINDOW_DAYS * MS_PER_DAY;
    const expenses = await tx.expense.findMany({
      where: {
        userId,
        creditCardId,
        statementRowId: null,
        date: {
          gte: new Date(parsed.periodStart.getTime() - windowMs),
          lte: new Date(parsed.periodEnd.getTime() + windowMs + MS_PER_DAY),
        },
      },
      select: {
        id: true,
        title: true,
        merchantName: true,
        cost: true,
        currency: true,
        date: true,
        isInstallment: true,
      },
    });
    return matchStatementRowsToExpenses({
      rows: parsed.rows.map((row) => ({
        key: row.occurrenceKey,
        kind: row.kind,
        decision: row.decision,
        transactionDate: row.transactionDate,
        description: row.description,
        merchantName: row.merchantName,
        amount: row.amount,
        currency: row.currency,
      })),
      expenses: expenses.map((expense) => ({
        ...expense,
        cost: Number(expense.cost),
      })),
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
    });
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
    if (!/^[A-Z]{3}$/.test(parsed.reconciliation.currency)) {
      throw new BadRequestException("Reconciliation currency is invalid");
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

  private isStatementCycleConstraintError(error: unknown) {
    if (
      !this.isUniqueConstraintError(error) ||
      !error.meta ||
      typeof error.meta !== "object" ||
      !("target" in error.meta)
    ) {
      return false;
    }

    const target = error.meta.target;
    if (target === "statement_imports_user_card_period_key") {
      return true;
    }
    if (!Array.isArray(target) || target.length !== 4) {
      return false;
    }

    const cycleFields = new Set([
      "userId",
      "creditCardId",
      "periodStart",
      "periodEnd",
    ]);
    return (
      new Set(target).size === cycleFields.size &&
      target.every(
        (field) => typeof field === "string" && cycleFields.has(field),
      )
    );
  }

  private isUniqueConstraintError(
    error: unknown,
  ): error is Error & { code: "P2002"; meta?: unknown } {
    return error instanceof Error && "code" in error && error.code === "P2002";
  }

  private async assertNoDuplicateCycle(
    tx: Prisma.TransactionClient,
    cycle: {
      id: string;
      userId: string;
      creditCardId: string | null;
      periodStart: Date;
      periodEnd: Date;
    },
  ) {
    if (!cycle.creditCardId) return;
    const existing = await tx.statementImport.findFirst({
      where: {
        id: { not: cycle.id },
        userId: cycle.userId,
        creditCardId: cycle.creditCardId,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
      },
      select: { id: true },
    });
    if (existing) throw this.statementCycleConflict();
  }

  private statementCycleConflict() {
    return new ConflictException({
      code: STATEMENT_CYCLE_CONFLICT_CODE,
      message: STATEMENT_CYCLE_CONFLICT_MESSAGE,
    });
  }

  private assertAdjustmentJustified(row: {
    transactionDate?: Date | null;
    amount?: Prisma.Decimal | number;
    currency?: string;
    kind?: StatementRowKind;
    parsedTransactionDate?: Date | null;
    parsedAmount?: Prisma.Decimal | number;
    parsedCurrency?: string;
    parsedKind?: StatementRowKind;
    decisionNote?: string | null;
  }) {
    if (
      this.hasAccountingAdjustment(row) &&
      !this.normalizeDecisionNote(row.decisionNote)
    ) {
      throw new BadRequestException(
        "Every accounting adjustment requires a decision note",
      );
    }
  }

  private hasAccountingAdjustment(row: {
    transactionDate?: Date | null;
    amount?: Prisma.Decimal | number;
    currency?: string;
    kind?: StatementRowKind;
    parsedTransactionDate?: Date | null;
    parsedAmount?: Prisma.Decimal | number;
    parsedCurrency?: string;
    parsedKind?: StatementRowKind;
  }) {
    if (
      row.parsedAmount === undefined ||
      row.parsedCurrency === undefined ||
      row.parsedKind === undefined
    ) {
      return false;
    }
    const currentDate = row.transactionDate?.getTime() ?? null;
    const parsedDate = row.parsedTransactionDate?.getTime() ?? null;
    return (
      currentDate !== parsedDate ||
      !this.toPersistedMoney(row.amount ?? 0).equals(
        this.toPersistedMoney(row.parsedAmount),
      ) ||
      row.currency !== row.parsedCurrency ||
      row.kind !== row.parsedKind
    );
  }

  private toPersistedMoney(value: Prisma.Decimal | number) {
    return new Prisma.Decimal(value).toDecimalPlaces(2);
  }

  private normalizeDecisionNote(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private assertPremium(userId: string) {
    return this.entitlementsService.assertPremium(
      userId,
      STATEMENT_IMPORT_FEATURE,
    );
  }
}
