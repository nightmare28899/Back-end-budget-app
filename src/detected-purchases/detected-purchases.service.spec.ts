import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { DetectedPurchasesService } from "./detected-purchases.service";
import {
  PAYMENT_CURRENCY_MISMATCH_MESSAGE,
  STATEMENT_ALREADY_PAID_MESSAGE,
} from "../card-statements/statement-payments.service";
const row = {
  id: "purchase-id",
  userId: "owner",
  fingerprint: "fp",
  sourcePackage: "bank",
  amountCents: 123n,
  currency: "MXN",
  merchant: null,
  occurredAtMillis: 100n,
  confidence: "HIGH",
  possibleDuplicateOf: null,
  mayBeRegistered: false,
  status: "PENDING",
  expenseId: null,
  statementPaymentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
describe("DetectedPurchasesService", () => {
  const tx = {
    detectedPurchase: {
      findUniqueOrThrow: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    creditCard: { findFirst: jest.fn() },
    statementImport: { findFirst: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    detectedPurchase: { findMany: jest.fn(), count: jest.fn() },
  };
  const expenses = { createInTransaction: jest.fn() };
  const payments = {
    assertPremium: jest.fn(),
    registerWithin: jest.fn(),
  };
  const service = new DetectedPurchasesService(
    prisma as never,
    expenses as never,
    payments as never,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (action: (client: unknown) => unknown) => action(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ ...row }]);
    tx.detectedPurchase.findUniqueOrThrow.mockResolvedValue({ ...row });
    tx.detectedPurchase.update.mockResolvedValue({
      ...row,
      status: "CONFIRMED",
      expenseId: "expense-id",
    });
    expenses.createInTransaction.mockResolvedValue({ id: "expense-id" });
    payments.assertPremium.mockResolvedValue(undefined);
    tx.creditCard.findFirst.mockResolvedValue({ id: "card-1" });
    tx.statementImport.findFirst.mockResolvedValue({
      id: "import-1",
      paymentVersion: 3,
    });
    payments.registerWithin.mockImplementation(
      (
        _tx: unknown,
        _user: string,
        _import: string,
        dto: { idempotencyKey: string },
      ) =>
        Promise.resolve({
          history: [{ id: "payment-1", idempotencyKey: dto.idempotencyKey }],
        }),
    );
  });
  it("deduplicates per owner/fingerprint without changing terminal rows", async () => {
    tx.detectedPurchase.findUniqueOrThrow.mockResolvedValue({
      ...row,
      status: "DISCARDED",
    });
    const {
      userId: _owner,
      status: _status,
      expenseId: _expense,
      createdAt: _created,
      updatedAt: _updated,
      ...purchase
    } = row;
    void [_owner, _status, _expense, _created, _updated];
    const result = await service.sync("owner", {
      purchases: [{ ...purchase, amountCents: 123, occurredAtMillis: 100 }],
    } as never);
    expect(tx.detectedPurchase.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.detectedPurchase.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { userId_fingerprint: { userId: "owner", fingerprint: "fp" } },
    });
    expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
    expect(result.purchases[0]).toMatchObject({
      id: row.id,
      status: "DISCARDED",
      amountCents: 123,
      occurredAtMillis: 100,
    });
    expect(result.purchases[0]).not.toHaveProperty("userId");
  });
  it("does not reuse another owner's client ID", async () => {
    await service.sync("owner", {
      purchases: [{ ...row, amountCents: 123, occurredAtMillis: 100 }],
    } as never);
    const calls = tx.detectedPurchase.createMany.mock.calls as [
      { data: { id: string }[] },
    ][];
    const call = calls[0][0];
    expect(call.data[0].id).not.toBe(row.id);
  });
  it("rejects unbounded or empty sync batches", async () => {
    await expect(service.sync("owner", { purchases: [] })).rejects.toThrow();
    await expect(
      service.sync("owner", {
        purchases: Array.from({ length: 101 }, () => ({
          ...row,
          amountCents: 123,
          occurredAtMillis: 100,
          confidence: "HIGH" as const,
        })),
      }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("scopes paginated list to authenticated owner and pending by default", async () => {
    prisma.detectedPurchase.findMany.mockResolvedValue([row]);
    prisma.detectedPurchase.count.mockResolvedValue(21);
    const result = await service.list("owner", {});
    expect(prisma.detectedPurchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "owner", status: "PENDING" },
        take: 20,
        skip: 0,
      }),
    );
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      totalCount: 21,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
  });
  it("locks only the owned row before writing an expense on the SAME client", async () => {
    await service.confirm("owner", row.id, {
      expense: { title: "Coffee", cost: 1.23, categoryId: "category" },
    });
    const [sql, id, owner] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
      string,
    ];
    expect(sql.join("?")).toContain('AND "userId" = ? FOR UPDATE');
    expect([id, owner]).toEqual([row.id, "owner"]);
    expect(expenses.createInTransaction).toHaveBeenCalledWith(
      "owner",
      expect.any(Object),
      tx,
    );
    expect(tx.detectedPurchase.update).toHaveBeenCalledWith({
      where: { id: row.id },
      data: { status: "CONFIRMED", expenseId: "expense-id" },
    });
  });
  it("is idempotent on confirmation retry", async () => {
    tx.$queryRaw.mockResolvedValue([
      { ...row, status: "CONFIRMED", expenseId: "prior" },
    ]);
    await expect(
      service.confirm("owner", row.id, { expense: {} } as never),
    ).resolves.toMatchObject({ expenseId: "prior" });
    expect(expenses.createInTransaction).not.toHaveBeenCalled();
    expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
  });
  it("returns 404 for missing/cross-owner confirmation and discard", async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.confirm("other", row.id, { expense: {} } as never),
    ).rejects.toThrow(NotFoundException);
    await expect(service.discard("other", row.id)).rejects.toThrow(
      NotFoundException,
    );
    expect(expenses.createInTransaction).not.toHaveBeenCalled();
  });
  it("does not confirm discarded rows or discard confirmed rows", async () => {
    tx.$queryRaw.mockResolvedValue([{ ...row, status: "DISCARDED" }]);
    await expect(
      service.confirm("owner", row.id, { expense: {} } as never),
    ).rejects.toThrow(ConflictException);
    await expect(service.discard("owner", row.id)).resolves.toMatchObject({
      status: "DISCARDED",
    });
    tx.$queryRaw.mockResolvedValue([{ ...row, status: "CONFIRMED" }]);
    await expect(service.discard("owner", row.id)).rejects.toThrow(
      ConflictException,
    );
    expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
  });
  it("does not finalize when expense creation fails", async () => {
    expenses.createInTransaction.mockRejectedValue(
      new Error("invalid category"),
    );
    await expect(
      service.confirm("owner", row.id, { expense: { cost: 1 } } as never),
    ).rejects.toThrow("invalid category");
    expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
  });
  it("bounds confirmation amounts and installment work", async () => {
    for (const expense of [
      { cost: Infinity },
      { cost: 100000000 },
      { cost: 1, installmentCount: 361 },
    ]) {
      await expect(
        service.confirm("owner", row.id, { expense } as never),
      ).rejects.toThrow();
    }
    expect(expenses.createInTransaction).not.toHaveBeenCalled();
  });

  describe("confirmAsPayment", () => {
    const dto = {
      cardId: "card-1",
      amount: 1.23,
      paidAt: "2026-10-19T12:00:00.000Z",
      note: "from notification",
    };
    const errorCode = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return (
          (error as { getResponse(): { code?: string } }).getResponse().code ??
          null
        );
      }
      return "NO_ERROR";
    };

    it("locks the row, reuses the statement payment service on the SAME client and links the payment", async () => {
      tx.detectedPurchase.update.mockResolvedValue({
        ...row,
        status: "CONFIRMED",
        statementPaymentId: "payment-1",
      });
      const result = await service.confirmAsPayment("owner", row.id, dto);
      expect(payments.assertPremium).toHaveBeenCalledWith("owner");
      expect(tx.$queryRaw.mock.calls[0]).toBeDefined();
      expect(tx.creditCard.findFirst).toHaveBeenCalledWith({
        where: { id: "card-1", userId: "owner" },
        select: { id: true },
      });
      expect(tx.statementImport.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: "owner",
            creditCardId: "card-1",
            status: "CONFIRMED",
            reconciliation: { isNot: null },
          },
        }),
      );
      expect(payments.registerWithin).toHaveBeenCalledWith(
        tx,
        "owner",
        "import-1",
        expect.objectContaining({
          amount: 1.23,
          currency: "MXN",
          paidAt: dto.paidAt,
          note: "from notification",
          expectedVersion: 3,
          idempotencyKey: expect.any(String) as string,
        }),
      );
      expect(tx.detectedPurchase.update).toHaveBeenCalledWith({
        where: { id: row.id },
        data: { status: "CONFIRMED", statementPaymentId: "payment-1" },
      });
      expect(result).toMatchObject({ statementPaymentId: "payment-1" });
      expect(expenses.createInTransaction).not.toHaveBeenCalled();
    });

    it("derives a stable idempotency key per purchase", async () => {
      await service.confirmAsPayment("owner", row.id, dto);
      await service.confirmAsPayment("owner", row.id, dto);
      const keys = payments.registerWithin.mock.calls.map(
        (call: unknown[]) =>
          (call[3] as { idempotencyKey: string }).idempotencyKey,
      );
      expect(keys[0]).toBe(keys[1]);
    });

    it("is idempotent when already confirmed as payment", async () => {
      tx.$queryRaw.mockResolvedValue([
        { ...row, status: "CONFIRMED", statementPaymentId: "payment-1" },
      ]);
      await expect(
        service.confirmAsPayment("owner", row.id, dto),
      ).resolves.toMatchObject({ statementPaymentId: "payment-1" });
      expect(payments.registerWithin).not.toHaveBeenCalled();
      expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
    });

    it("rejects purchases already confirmed as expense or discarded", async () => {
      tx.$queryRaw.mockResolvedValue([
        { ...row, status: "CONFIRMED", expenseId: "e" },
      ]);
      await expect(
        service.confirmAsPayment("owner", row.id, dto),
      ).rejects.toThrow(ConflictException);
      tx.$queryRaw.mockResolvedValue([{ ...row, status: "DISCARDED" }]);
      await expect(
        service.confirmAsPayment("owner", row.id, dto),
      ).rejects.toThrow(ConflictException);
      expect(payments.registerWithin).not.toHaveBeenCalled();
    });

    it("404s for missing or cross-owner purchase and card", async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.confirmAsPayment("other", row.id, dto),
      ).rejects.toThrow(NotFoundException);
      tx.$queryRaw.mockResolvedValue([{ ...row }]);
      tx.creditCard.findFirst.mockResolvedValue(null);
      expect(
        await errorCode(service.confirmAsPayment("owner", row.id, dto)),
      ).toBe("CARD_NOT_FOUND");
      expect(payments.registerWithin).not.toHaveBeenCalled();
    });

    it("returns STATEMENT_REQUIRED and leaves the purchase pending without a confirmed statement", async () => {
      tx.statementImport.findFirst.mockResolvedValue(null);
      expect(
        await errorCode(service.confirmAsPayment("owner", row.id, dto)),
      ).toBe("STATEMENT_REQUIRED");
      expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
      expect(payments.registerWithin).not.toHaveBeenCalled();
    });

    it("maps a fully paid statement to STATEMENT_ALREADY_PAID without finalizing", async () => {
      payments.registerWithin.mockRejectedValue(
        new ConflictException(STATEMENT_ALREADY_PAID_MESSAGE),
      );
      expect(
        await errorCode(service.confirmAsPayment("owner", row.id, dto)),
      ).toBe("STATEMENT_ALREADY_PAID");
      expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
    });

    it("maps currency mismatch to PAYMENT_CURRENCY_MISMATCH and passes other errors through", async () => {
      payments.registerWithin.mockRejectedValue(
        new BadRequestException(PAYMENT_CURRENCY_MISMATCH_MESSAGE),
      );
      expect(
        await errorCode(service.confirmAsPayment("owner", row.id, dto)),
      ).toBe("PAYMENT_CURRENCY_MISMATCH");
      payments.registerWithin.mockRejectedValue(
        new ConflictException("Statement payment version is stale"),
      );
      await expect(
        service.confirmAsPayment("owner", row.id, dto),
      ).rejects.toThrow("Statement payment version is stale");
      expect(tx.detectedPurchase.update).not.toHaveBeenCalled();
    });

    it("does not touch the DB when premium is missing", async () => {
      payments.assertPremium.mockRejectedValue(new Error("PREMIUM_REQUIRED"));
      await expect(
        service.confirmAsPayment("owner", row.id, dto),
      ).rejects.toThrow("PREMIUM_REQUIRED");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
