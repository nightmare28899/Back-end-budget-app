import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  DetectedPurchase,
  DetectedPurchaseStatus,
  Prisma,
  StatementImportStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateStatementPaymentDto } from "../card-statements/dto/create-statement-payment.dto";
import { ExpensesService } from "../expenses/expenses.service";
import {
  PAYMENT_CURRENCY_MISMATCH_MESSAGE,
  STATEMENT_ALREADY_PAID_MESSAGE,
  StatementPaymentsService,
} from "../card-statements/statement-payments.service";
import {
  ConfirmDetectedPurchaseAsPaymentDto,
  ConfirmDetectedPurchaseDto,
  QueryDetectedPurchasesDto,
  SyncDetectedPurchasesDto,
} from "./dto/detected-purchase.dto";
function serialize(row: DetectedPurchase) {
  const { userId: _userId, ...purchase } = row;
  void _userId;
  return {
    ...purchase,
    amountCents: Number(row.amountCents),
    occurredAtMillis: Number(row.occurredAtMillis),
  };
}
// Stable per purchase so a retried confirmation can never create a second payment.
function paymentKeyFor(purchaseId: string) {
  const hex = createHash("sha256")
    .update(`detected-purchase-payment:${purchaseId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
@Injectable()
export class DetectedPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpensesService,
    private readonly payments: StatementPaymentsService,
  ) {}
  async sync(userId: string, dto: SyncDetectedPurchasesDto) {
    if (!dto.purchases.length || dto.purchases.length > 100)
      throw new BadRequestException("Sync requires 1 to 100 purchases");
    const purchases = await this.prisma.$transaction(async (tx) => {
      // Native ON CONFLICT makes concurrent device uploads idempotent without touching terminal rows.
      await tx.detectedPurchase.createMany({
        data: [...dto.purchases]
          .sort((left, right) =>
            left.fingerprint.localeCompare(right.fingerprint),
          )
          .map((purchase) => ({
            id: randomUUID(),
            userId,
            fingerprint: purchase.fingerprint,
            sourcePackage: purchase.sourcePackage,
            amountCents: BigInt(purchase.amountCents),
            currency: purchase.currency,
            merchant: purchase.merchant,
            occurredAtMillis: BigInt(purchase.occurredAtMillis),
            confidence: purchase.confidence,
            possibleDuplicateOf: purchase.possibleDuplicateOf,
            mayBeRegistered: purchase.mayBeRegistered,
          })),
        skipDuplicates: true,
      });
      const rows: DetectedPurchase[] = [];
      for (const purchase of dto.purchases) {
        rows.push(
          await tx.detectedPurchase.findUniqueOrThrow({
            where: {
              userId_fingerprint: { userId, fingerprint: purchase.fingerprint },
            },
          }),
        );
      }
      return rows;
    });
    return { purchases: purchases.map(serialize) };
  }
  async list(userId: string, query: QueryDetectedPurchasesDto) {
    const page = query.page ?? 1,
      limit = query.limit ?? 20;
    const where = {
      userId,
      status: query.status ?? DetectedPurchaseStatus.PENDING,
    };
    const [rows, totalCount] = await Promise.all([
      this.prisma.detectedPurchase.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ occurredAtMillis: "desc" }, { id: "asc" }],
      }),
      this.prisma.detectedPurchase.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    return {
      purchases: rows.map(serialize),
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
  async confirm(userId: string, id: string, dto: ConfirmDetectedPurchaseDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockOwned(tx, { userId, id });
      if (row.status === DetectedPurchaseStatus.CONFIRMED)
        return serialize(row);
      if (row.status === DetectedPurchaseStatus.DISCARDED)
        throw new ConflictException("Purchase was discarded");
      if (
        !Number.isFinite(dto.expense.cost) ||
        dto.expense.cost < 0.01 ||
        dto.expense.cost > 99999999.99
      )
        throw new BadRequestException(
          "Expense amount is outside supported bounds",
        );
      if (dto.expense.installmentCount && dto.expense.installmentCount > 360)
        throw new BadRequestException("At most 360 installments are supported");
      const expense = await this.expenses.createInTransaction(
        userId,
        dto.expense,
        tx,
      );
      return serialize(
        await tx.detectedPurchase.update({
          where: { id },
          data: {
            status: DetectedPurchaseStatus.CONFIRMED,
            expenseId: expense.id,
          },
        }),
      );
    });
  }
  async confirmAsPayment(
    userId: string,
    id: string,
    dto: ConfirmDetectedPurchaseAsPaymentDto,
  ) {
    await this.payments.assertPremium(userId);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockOwned(tx, { userId, id });
      if (row.status === DetectedPurchaseStatus.CONFIRMED) {
        if (row.statementPaymentId) return serialize(row);
        throw new ConflictException({
          code: "PURCHASE_ALREADY_CONFIRMED",
          message: "Purchase was confirmed as an expense",
        });
      }
      if (row.status === DetectedPurchaseStatus.DISCARDED)
        throw new ConflictException("Purchase was discarded");
      const card = await tx.creditCard.findFirst({
        where: { id: dto.cardId, userId },
        select: { id: true },
      });
      if (!card)
        throw new NotFoundException({
          code: "CARD_NOT_FOUND",
          message: "Credit card not found",
        });
      const statement = await tx.statementImport.findFirst({
        where: {
          userId,
          creditCardId: card.id,
          status: StatementImportStatus.CONFIRMED,
          reconciliation: { isNot: null },
        },
        orderBy: [{ periodEnd: "desc" }, { confirmedAt: "desc" }],
        select: { id: true, paymentVersion: true, periodEnd: true },
      });
      if (!statement)
        throw new ConflictException({
          code: "STATEMENT_REQUIRED",
          message: "A confirmed statement is required to register payments",
        });
      const idempotencyKey = paymentKeyFor(row.id);
      const result = await this.registerPayment(
        tx,
        userId,
        statement.id,
        {
          amount: dto.amount,
          currency: row.currency,
          paidAt: dto.paidAt,
          note: dto.note,
          expectedVersion: statement.paymentVersion,
          idempotencyKey,
        },
        statement.periodEnd,
      );
      const payment = result.history.find(
        (item) => item.idempotencyKey === idempotencyKey,
      );
      if (!payment)
        throw new ConflictException("Statement payment was not recorded");
      return serialize(
        await tx.detectedPurchase.update({
          where: { id },
          data: {
            status: DetectedPurchaseStatus.CONFIRMED,
            statementPaymentId: payment.id,
          },
        }),
      );
    });
  }

  private async registerPayment(
    tx: Prisma.TransactionClient,
    userId: string,
    statementId: string,
    dto: CreateStatementPaymentDto,
    periodEnd: Date | null,
  ) {
    try {
      return await this.payments.registerWithin(tx, userId, statementId, dto);
    } catch (error) {
      if (
        error instanceof ConflictException &&
        error.message === STATEMENT_ALREADY_PAID_MESSAGE
      ) {
        // The latest statement is paid but the payment is dated after its
        // cycle: it belongs to a newer statement that is not uploaded yet.
        if (isAfterPeriodEnd(dto.paidAt, periodEnd))
          throw new ConflictException({
            code: "STATEMENT_REQUIRED",
            message: "A confirmed statement is required to register payments",
          });
        throw new ConflictException({
          code: "STATEMENT_ALREADY_PAID",
          message: STATEMENT_ALREADY_PAID_MESSAGE,
        });
      }
      if (
        error instanceof BadRequestException &&
        error.message === PAYMENT_CURRENCY_MISMATCH_MESSAGE
      )
        throw new UnprocessableEntityException({
          code: "PAYMENT_CURRENCY_MISMATCH",
          message: PAYMENT_CURRENCY_MISMATCH_MESSAGE,
        });
      throw error;
    }
  }

  async discard(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockOwned(tx, { userId, id });
      if (row.status === DetectedPurchaseStatus.CONFIRMED)
        throw new ConflictException("Purchase was confirmed");
      if (row.status === DetectedPurchaseStatus.DISCARDED)
        return serialize(row);
      return serialize(
        await tx.detectedPurchase.update({
          where: { id },
          data: { status: DetectedPurchaseStatus.DISCARDED },
        }),
      );
    });
  }
  private async lockOwned(
    tx: Prisma.TransactionClient,
    owner: { userId: string; id: string },
  ) {
    // The row lock serializes confirm/discard across devices, including expense writes.
    const rows = await tx.$queryRaw<
      DetectedPurchase[]
    >`SELECT * FROM "detected_purchases" WHERE "id" = ${owner.id} AND "userId" = ${owner.userId} FOR UPDATE`;
    if (!rows.length)
      throw new NotFoundException("Detected purchase not found");
    return rows[0];
  }
}

function isAfterPeriodEnd(paidAt: string, periodEnd: Date | null): boolean {
  if (!periodEnd) return false;
  const paid = new Date(paidAt);
  if (Number.isNaN(paid.getTime())) return false;
  // Compare calendar days (UTC): a payment on the cut date still belongs to it.
  return paid.toISOString().slice(0, 10) > periodEnd.toISOString().slice(0, 10);
}
