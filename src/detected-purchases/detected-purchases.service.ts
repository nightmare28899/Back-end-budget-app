import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  DetectedPurchase,
  DetectedPurchaseStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ExpensesService } from "../expenses/expenses.service";
import {
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
@Injectable()
export class DetectedPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpensesService,
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
