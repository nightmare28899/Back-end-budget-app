import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  StatementImportStatus,
  StatementPaymentSource,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { EntitlementsService } from "../common/entitlements/entitlements.service";
import { PrismaService } from "../prisma/prisma.service";
import { CorrectStatementPaymentDto } from "./dto/correct-statement-payment.dto";
import { CreateStatementPaymentDto } from "./dto/create-statement-payment.dto";
import { VoidStatementPaymentDto } from "./dto/void-statement-payment.dto";
import {
  calculateStatementPaymentSummary,
  type StatementPaymentSummary,
  type StatementSummaryInput,
} from "./statement-payment-summary";

const STATEMENT_IMPORT_FEATURE = "statement_imports";
const EARLIEST_PAYMENT_DATE = Date.UTC(2000, 0, 1);

const paymentContextInclude = {
  reconciliation: true,
  creditCard: { select: { currency: true } },
  paymentTargets: {
    orderBy: { position: "asc" as const },
    select: {
      kind: true,
      amount: true,
      currency: true,
      dueDate: true,
      position: true,
    },
  },
  payments: {
    orderBy: [{ paidAt: "desc" as const }, { createdAt: "desc" as const }],
  },
} satisfies Prisma.StatementImportInclude;

type PaymentContext = Prisma.StatementImportGetPayload<{
  include: typeof paymentContextInclude;
}>;

@Injectable()
export class StatementPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async create(
    userId: string,
    statementImportId: string,
    dto: CreateStatementPaymentDto,
  ) {
    await this.assertPremium(userId);
    const paidAt = this.parsePaidAt(dto.paidAt);

    try {
      return await this.prisma.$transaction((tx) =>
        this.createInTransaction(tx, userId, statementImportId, dto, paidAt),
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return this.resolveIdempotentRetry(
          userId,
          statementImportId,
          dto,
          paidAt,
        );
      }
      throw error;
    }
  }

  async correct(
    userId: string,
    paymentId: string,
    dto: CorrectStatementPaymentDto,
  ) {
    await this.assertPremium(userId);
    const paidAt = this.parsePaidAt(dto.paidAt);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const retry = await tx.statementPayment.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          select: {
            statementImportId: true,
            supersedesId: true,
            amount: true,
            currency: true,
            paidAt: true,
            note: true,
          },
        });
        if (retry) {
          if (
            retry.supersedesId !== paymentId ||
            !this.matchesWrite(retry, dto, paidAt)
          ) {
            throw new ConflictException("Idempotency key is already in use");
          }
          return this.buildResponse(tx, userId, retry.statementImportId);
        }

        const payment = await tx.statementPayment.findFirst({
          where: { id: paymentId, statementImport: { userId } },
          select: { statementImportId: true, voidedAt: true },
        });
        if (!payment)
          throw new NotFoundException("Statement payment not found");
        if (payment.voidedAt) {
          throw new ConflictException(
            "Only an active payment can be corrected",
          );
        }

        const context = await this.findOwnedContext(
          tx,
          userId,
          payment.statementImportId,
        );
        this.assertPaymentIntegrity(context, dto.currency);
        await this.claimVersion(tx, context, dto.expectedVersion);
        const voided = await tx.statementPayment.updateMany({
          where: { id: paymentId, voidedAt: null },
          data: { voidedAt: new Date(), voidReason: dto.reason },
        });
        if (voided.count !== 1) {
          throw new ConflictException("Statement payment changed concurrently");
        }
        await tx.statementPayment.create({
          data: {
            userId,
            statementImportId: payment.statementImportId,
            amount: this.toMoney(dto.amount),
            currency: dto.currency,
            paidAt,
            note: dto.note,
            source: StatementPaymentSource.CORRECTION,
            idempotencyKey: dto.idempotencyKey,
            supersedesId: paymentId,
          },
        });
        return this.recomputeAndRespond(tx, userId, payment.statementImportId);
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const replacement = await this.prisma.statementPayment.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          select: {
            statementImportId: true,
            supersedesId: true,
            amount: true,
            currency: true,
            paidAt: true,
            note: true,
          },
        });
        if (
          replacement?.supersedesId === paymentId &&
          this.matchesWrite(replacement, dto, paidAt)
        ) {
          return this.getResponse(userId, replacement.statementImportId);
        }
      }
      throw error;
    }
  }

  async void(userId: string, paymentId: string, dto: VoidStatementPaymentDto) {
    await this.assertPremium(userId);

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.statementPayment.findFirst({
        where: { id: paymentId, statementImport: { userId } },
        select: { statementImportId: true, voidedAt: true },
      });
      if (!payment) throw new NotFoundException("Statement payment not found");
      const context = await this.findOwnedContext(
        tx,
        userId,
        payment.statementImportId,
      );
      if (payment.voidedAt) {
        return this.buildResponse(tx, userId, payment.statementImportId);
      }
      await this.claimVersion(tx, context, dto.expectedVersion);
      const voided = await tx.statementPayment.updateMany({
        where: { id: paymentId, voidedAt: null },
        data: { voidedAt: new Date(), voidReason: dto.reason },
      });
      if (voided.count !== 1) {
        throw new ConflictException("Statement payment changed concurrently");
      }
      return this.recomputeAndRespond(tx, userId, payment.statementImportId);
    });
  }

  async createCompatibilityPayment(
    userId: string,
    statementImportId: string,
    input: { amount: number; expectedVersion: number; currency?: string },
  ) {
    const context = await this.prisma.statementImport.findFirst({
      where: { id: statementImportId, userId },
      include: paymentContextInclude,
    });
    if (!context) throw new NotFoundException("Statement import not found");
    const currency = input.currency ?? this.resolveCurrency(context);
    return this.create(userId, statementImportId, {
      amount: input.amount,
      currency,
      paidAt: new Date().toISOString(),
      expectedVersion: input.expectedVersion,
      idempotencyKey: randomUUID(),
    });
  }

  async clearCompatibilityStatus(userId: string, statementImportId: string) {
    await this.assertPremium(userId);
    await this.prisma.$transaction(async (tx) => {
      const context = await this.findOwnedContext(
        tx,
        userId,
        statementImportId,
      );
      if (context.payments.some((payment) => payment.voidedAt === null)) {
        throw new ConflictException(
          "Payment history cannot be erased; void active payments instead",
        );
      }
      const alreadyUnpaid =
        context.paymentStatus === "UNPAID" &&
        !context.isPaid &&
        context.paidAmount === null &&
        context.paidAt === null;
      if (alreadyUnpaid) return;

      await this.claimVersion(tx, context, context.paymentVersion);
      await tx.statementImport.update({
        where: { id: statementImportId },
        data: {
          paymentStatus: "UNPAID",
          isPaid: false,
          paidAmount: null,
          paidAt: null,
        },
      });
    });
  }

  summarize(context: StatementSummaryInput): StatementPaymentSummary {
    return calculateStatementPaymentSummary(context);
  }

  async getResponse(userId: string, statementImportId: string) {
    await this.assertPremium(userId);
    return this.prisma.$transaction((tx) =>
      this.buildResponse(tx, userId, statementImportId),
    );
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    statementImportId: string,
    dto: CreateStatementPaymentDto,
    paidAt: Date,
  ) {
    const retry = await tx.statementPayment.findUnique({
      where: {
        userId_idempotencyKey: {
          userId,
          idempotencyKey: dto.idempotencyKey,
        },
      },
      select: {
        statementImportId: true,
        supersedesId: true,
        amount: true,
        currency: true,
        paidAt: true,
        note: true,
      },
    });
    if (retry) {
      if (
        retry.supersedesId !== null ||
        retry.statementImportId !== statementImportId ||
        !this.matchesWrite(retry, dto, paidAt)
      ) {
        throw new ConflictException("Idempotency key is already in use");
      }
      return this.buildResponse(tx, userId, statementImportId);
    }

    const context = await this.findOwnedContext(tx, userId, statementImportId);
    this.assertPaymentIntegrity(context, dto.currency);
    await this.claimVersion(tx, context, dto.expectedVersion);
    await tx.statementPayment.create({
      data: {
        userId,
        statementImportId,
        amount: this.toMoney(dto.amount),
        currency: dto.currency,
        paidAt,
        note: dto.note,
        source: StatementPaymentSource.MANUAL,
        idempotencyKey: dto.idempotencyKey,
      },
    });
    return this.recomputeAndRespond(tx, userId, statementImportId);
  }

  private async claimVersion(
    tx: Prisma.TransactionClient,
    context: PaymentContext,
    expectedVersion: number,
  ) {
    const claimed = await tx.statementImport.updateMany({
      where: {
        id: context.id,
        userId: context.userId,
        paymentVersion: expectedVersion,
      },
      data: { paymentVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new ConflictException("Statement payment version is stale");
    }
  }

  private async recomputeAndRespond(
    tx: Prisma.TransactionClient,
    userId: string,
    statementImportId: string,
  ) {
    const context = await this.findOwnedContext(tx, userId, statementImportId);
    const summary = this.summarize(context);
    if (summary.integrityFlags.conflictingNoInterestTargets) {
      throw new ConflictException("Statement payment targets conflict");
    }
    const activeSameCurrencyPayments = context.payments.filter(
      (payment) =>
        payment.voidedAt === null && payment.currency === summary.currency,
    );
    const lastPaidAt = activeSameCurrencyPayments.reduce<Date | null>(
      (latest, payment) =>
        !latest || payment.paidAt > latest ? payment.paidAt : latest,
      null,
    );
    await tx.statementImport.update({
      where: { id: statementImportId },
      data: {
        paymentStatus: summary.paymentStatus,
        isPaid: summary.isPaid,
        paidAmount:
          summary.paidTotal > 0 ? this.toMoney(summary.paidTotal) : null,
        paidAt: lastPaidAt,
      },
    });
    return this.buildResponse(tx, userId, statementImportId);
  }

  private async buildResponse(
    tx: Prisma.TransactionClient,
    userId: string,
    statementImportId: string,
  ) {
    const context = await this.findOwnedContext(tx, userId, statementImportId);
    return {
      paymentVersion: context.paymentVersion,
      summary: this.summarize(context),
      history: context.payments,
    };
  }

  private async findOwnedContext(
    tx: Prisma.TransactionClient,
    userId: string,
    statementImportId: string,
  ) {
    const context = await tx.statementImport.findFirst({
      where: { id: statementImportId, userId },
      include: paymentContextInclude,
    });
    if (!context) throw new NotFoundException("Statement import not found");
    return context;
  }

  private assertPaymentIntegrity(context: PaymentContext, currency: string) {
    if (
      context.status !== StatementImportStatus.CONFIRMED ||
      !context.reconciliation
    ) {
      throw new ConflictException(
        "Payments require a confirmed statement with a reconciliation",
      );
    }
    const expectedCurrency = this.resolveCurrency(context);
    if (currency !== expectedCurrency) {
      throw new BadRequestException(
        "Payment currency does not match statement",
      );
    }
    const summary = this.summarize(context);
    if (summary.integrityFlags.conflictingNoInterestTargets) {
      throw new ConflictException("Statement payment targets conflict");
    }
  }

  private resolveCurrency(context: PaymentContext) {
    const currency = context.reconciliation?.currency;
    if (!currency) {
      throw new ConflictException("Statement currency basis is unavailable");
    }
    return currency;
  }

  private toMoney(value: number) {
    return new Prisma.Decimal(value).toDecimalPlaces(2);
  }

  private async resolveIdempotentRetry(
    userId: string,
    statementImportId: string,
    dto: CreateStatementPaymentDto,
    paidAt: Date,
  ) {
    const payment = await this.prisma.statementPayment.findUnique({
      where: {
        userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey },
      },
      select: {
        statementImportId: true,
        supersedesId: true,
        amount: true,
        currency: true,
        paidAt: true,
        note: true,
      },
    });
    if (
      !payment ||
      payment.supersedesId !== null ||
      payment.statementImportId !== statementImportId ||
      !this.matchesWrite(payment, dto, paidAt)
    ) {
      throw new ConflictException("Idempotency key is already in use");
    }
    return this.getResponse(userId, statementImportId);
  }

  private isUniqueConstraintError(error: unknown) {
    return error instanceof Error && "code" in error && error.code === "P2002";
  }

  private parsePaidAt(value: string) {
    const paidAt = new Date(value);
    const endOfToday = new Date();
    endOfToday.setUTCHours(23, 59, 59, 999);
    if (
      !Number.isFinite(paidAt.getTime()) ||
      paidAt.getTime() < EARLIEST_PAYMENT_DATE ||
      paidAt.getTime() > endOfToday.getTime()
    ) {
      throw new BadRequestException(
        "Payment date must be between 2000-01-01 and today",
      );
    }
    return paidAt;
  }

  private matchesWrite(
    payment: {
      amount: Prisma.Decimal | number | string;
      currency: string;
      paidAt: Date;
      note: string | null;
    },
    dto: CreateStatementPaymentDto,
    paidAt: Date,
  ) {
    return (
      new Prisma.Decimal(payment.amount).equals(this.toMoney(dto.amount)) &&
      payment.currency === dto.currency &&
      payment.paidAt.getTime() === paidAt.getTime() &&
      payment.note === (dto.note ?? null)
    );
  }

  private assertPremium(userId: string) {
    return this.entitlementsService.assertPremium(
      userId,
      STATEMENT_IMPORT_FEATURE,
    );
  }
}
