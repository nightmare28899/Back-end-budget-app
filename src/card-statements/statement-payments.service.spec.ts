import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  StatementImportStatus,
  StatementPaymentSource,
  StatementPaymentStatus,
  StatementReconciliationStatus,
} from "@prisma/client";
import { StatementPaymentsService } from "./statement-payments.service";

const objectContaining = (value: object): unknown =>
  expect.objectContaining(value);
const anyOf = (constructor: unknown): unknown =>
  expect.any(constructor as new (...args: never[]) => unknown);

describe("StatementPaymentsService", () => {
  const tx = {
    statementImport: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    statementPayment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    statementImport: { findFirst: jest.fn(), update: jest.fn() },
    statementPayment: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const entitlements = { assertPremium: jest.fn() };
  let service: StatementPaymentsService;

  beforeEach(() => {
    jest.resetAllMocks();
    entitlements.assertPremium.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    service = new StatementPaymentsService(
      prisma as never,
      entitlements as never,
    );
  });

  it("creates a payment, claims the expected version, and recomputes caches from active rows", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst
      .mockResolvedValueOnce(context())
      .mockResolvedValueOnce(context({ paymentVersion: 1, paidTotal: 125 }))
      .mockResolvedValueOnce(context({ paymentVersion: 1, paidTotal: 125 }));
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementPayment.create.mockResolvedValue({ id: "payment-1" });
    tx.statementImport.update.mockResolvedValue({});

    const result = await service.create("user-1", "import-1", paymentDto());

    expect(tx.statementImport.updateMany).toHaveBeenCalledWith(
      objectContaining({
        where: objectContaining({ paymentVersion: 0 }),
        data: { paymentVersion: { increment: 1 } },
      }),
    );
    expect(tx.statementPayment.create).toHaveBeenCalledWith({
      data: objectContaining({
        amount: objectContaining({}),
        source: StatementPaymentSource.MANUAL,
        idempotencyKey: paymentDto().idempotencyKey,
      }),
    });
    expect(tx.statementImport.update).toHaveBeenCalledWith({
      where: { id: "import-1" },
      data: objectContaining({
        paymentStatus: StatementPaymentStatus.PARTIAL,
        isPaid: false,
        paidAt: new Date("2026-09-29T12:00:00.000Z"),
      }),
    });
    expect(result.summary.paidTotal).toBe(125);
  });

  it("returns the current summary for an idempotent retry without another write", async () => {
    tx.statementPayment.findUnique.mockResolvedValue({
      statementImportId: "import-1",
      supersedesId: null,
      amount: 125,
      currency: "MXN",
      paidAt: new Date("2026-09-29T12:00:00.000Z"),
      note: null,
    });
    tx.statementImport.findFirst.mockResolvedValue(
      context({ paymentVersion: 1, paidTotal: 125 }),
    );

    const result = await service.create("user-1", "import-1", paymentDto());

    expect(result.summary.paidTotal).toBe(125);
    expect(tx.statementPayment.create).not.toHaveBeenCalled();
    expect(tx.statementImport.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale expected version before inserting", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst.mockResolvedValue(
      context({ paymentVersion: 2 }),
    );
    tx.statementImport.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.create("user-1", "import-1", paymentDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementPayment.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    tx.statementPayment.findUnique.mockResolvedValue({
      statementImportId: "import-1",
      amount: 124,
      currency: "MXN",
      paidAt: new Date("2026-09-29T12:00:00.000Z"),
      note: null,
    });

    await expect(
      service.create("user-1", "import-1", paymentDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementImport.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign statement id", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst.mockResolvedValue(null);

    await expect(
      service.create("user-1", "foreign-import", paymentDto()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a payment whose currency differs from the owned statement", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst.mockResolvedValue(context());

    await expect(
      service.create("user-1", "import-1", {
        ...paymentDto(),
        currency: "USD",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.statementImport.updateMany).not.toHaveBeenCalled();
  });

  it("corrects by voiding the original and appending a replacement", async () => {
    const original = payment({ amount: 125 });
    const replacement = payment({
      id: "payment-2",
      amount: 150,
      source: StatementPaymentSource.CORRECTION,
      supersedesId: "payment-1",
      idempotencyKey: "22ea9a93-337a-4f88-9bdf-e477247a6a23",
    });
    const voidedOriginal = {
      ...original,
      voidedAt: new Date("2026-09-29T13:00:00.000Z"),
      voidReason: "Incorrect amount",
    };
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementPayment.findFirst.mockResolvedValue({
      statementImportId: "import-1",
      voidedAt: null,
    });
    tx.statementImport.findFirst
      .mockResolvedValueOnce(
        context({ paymentVersion: 1, payments: [original] }),
      )
      .mockResolvedValueOnce(
        context({
          paymentVersion: 2,
          payments: [replacement, voidedOriginal],
        }),
      )
      .mockResolvedValueOnce(
        context({
          paymentVersion: 2,
          payments: [replacement, voidedOriginal],
        }),
      );
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementPayment.updateMany.mockResolvedValue({ count: 1 });
    tx.statementPayment.create.mockResolvedValue(replacement);
    tx.statementImport.update.mockResolvedValue({});

    const result = await service.correct("user-1", "payment-1", {
      ...paymentDto(),
      amount: 150,
      expectedVersion: 1,
      idempotencyKey: replacement.idempotencyKey,
      reason: "Incorrect amount",
    });

    expect(tx.statementPayment.updateMany).toHaveBeenCalledWith({
      where: { id: "payment-1", voidedAt: null },
      data: { voidedAt: anyOf(Date), voidReason: "Incorrect amount" },
    });
    expect(tx.statementPayment.create).toHaveBeenCalledWith({
      data: objectContaining({
        amount: objectContaining({}),
        source: StatementPaymentSource.CORRECTION,
        supersedesId: "payment-1",
      }),
    });
    expect(result.summary.paidTotal).toBe(150);
    expect(result.history).toHaveLength(2);
  });

  it("returns 404 when correcting a foreign payment", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementPayment.findFirst.mockResolvedValue(null);

    await expect(
      service.correct("user-1", "foreign-payment", {
        ...paymentDto(),
        reason: "Incorrect amount",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns 404 when voiding a foreign payment", async () => {
    tx.statementPayment.findFirst.mockResolvedValue(null);

    await expect(
      service.void("user-1", "foreign-payment", {
        expectedVersion: 0,
        reason: "Duplicate bank record",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects payment dates outside the supported range", async () => {
    await expect(
      service.create("user-1", "import-1", {
        ...paymentDto(),
        paidAt: "1999-12-31T23:59:59.999Z",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("voids an active payment and preserves it in history", async () => {
    tx.statementPayment.findFirst.mockResolvedValue({
      statementImportId: "import-1",
      voidedAt: null,
    });
    tx.statementImport.findFirst
      .mockResolvedValueOnce(context({ paymentVersion: 1, paidTotal: 125 }))
      .mockResolvedValueOnce(
        context({ paymentVersion: 2, voidedPaidTotal: 125 }),
      )
      .mockResolvedValueOnce(
        context({ paymentVersion: 2, voidedPaidTotal: 125 }),
      );
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementPayment.updateMany.mockResolvedValue({ count: 1 });
    tx.statementImport.update.mockResolvedValue({});

    const result = await service.void("user-1", "payment-1", {
      expectedVersion: 1,
      reason: "Duplicate bank record",
    });

    expect(result.summary).toMatchObject({
      paidTotal: 0,
      paymentStatus: StatementPaymentStatus.UNPAID,
    });
    expect(result.history).toHaveLength(1);
    expect(tx.statementPayment.updateMany).toHaveBeenCalledWith({
      where: { id: "payment-1", voidedAt: null },
      data: { voidedAt: anyOf(Date), voidReason: "Duplicate bank record" },
    });
  });

  it("recomputes the cache from the full active same-currency sum", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst
      .mockResolvedValueOnce(context())
      .mockResolvedValueOnce(
        context({
          paymentVersion: 1,
          payments: [
            payment({ id: "payment-1", amount: 75 }),
            payment({ id: "payment-2", amount: 50 }),
            payment({ id: "payment-3", amount: 25, voidedAt: new Date() }),
            payment({ id: "payment-4", amount: 40, currency: "USD" }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        context({
          paymentVersion: 1,
          payments: [
            payment({ id: "payment-1", amount: 75 }),
            payment({ id: "payment-2", amount: 50 }),
          ],
        }),
      );
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementPayment.create.mockResolvedValue({ id: "payment-2" });
    tx.statementImport.update.mockResolvedValue({});

    await service.create("user-1", "import-1", paymentDto());

    expect(tx.statementImport.update).toHaveBeenCalledWith({
      where: { id: "import-1" },
      data: objectContaining({
        paidAmount: objectContaining({}),
        paymentStatus: StatementPaymentStatus.PARTIAL,
      }),
    });
    const [update] = tx.statementImport.update.mock.calls[0] as [
      { data: { paidAmount: Prisma.Decimal } },
    ];
    expect(Number(update.data.paidAmount)).toBe(125);
  });

  it("blocks the legacy clear shim while an active payment exists", async () => {
    tx.statementImport.findFirst.mockResolvedValue(
      context({ payments: [payment()] }),
    );

    await expect(
      service.clearCompatibilityStatus("user-1", "import-1"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementImport.update).not.toHaveBeenCalled();
  });

  it("treats the legacy clear shim as a no-op when only voided payments exist", async () => {
    tx.statementImport.findFirst.mockResolvedValue(
      context({
        payments: [
          payment({
            voidedAt: new Date("2026-09-29T13:00:00.000Z"),
            voidReason: "Duplicate bank record",
          }),
        ],
      }),
    );

    await expect(
      service.clearCompatibilityStatus("user-1", "import-1"),
    ).resolves.toBeUndefined();
    expect(tx.statementImport.updateMany).not.toHaveBeenCalled();
    expect(tx.statementImport.update).not.toHaveBeenCalled();
  });

  it("rejects a payment for a statement that is not confirmed", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst.mockResolvedValue(
      context({ status: StatementImportStatus.NEEDS_REVIEW }),
    );

    await expect(
      service.create("user-1", "import-1", paymentDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementImport.updateMany).not.toHaveBeenCalled();
    expect(tx.statementPayment.create).not.toHaveBeenCalled();
  });

  it("rejects a new payment once the statement is fully paid", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst.mockResolvedValue(context({ paidTotal: 500 }));

    await expect(
      service.create("user-1", "import-1", paymentDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementImport.updateMany).not.toHaveBeenCalled();
    expect(tx.statementPayment.create).not.toHaveBeenCalled();
  });

  it("rejects a payment when the statement has no reconciliation", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementImport.findFirst.mockResolvedValue(
      context({ reconciliation: null }),
    );

    await expect(
      service.create("user-1", "import-1", paymentDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementPayment.create).not.toHaveBeenCalled();
  });

  it("rejects correcting a payment on an unconfirmed statement", async () => {
    tx.statementPayment.findUnique.mockResolvedValue(null);
    tx.statementPayment.findFirst.mockResolvedValue({
      statementImportId: "import-1",
      voidedAt: null,
    });
    tx.statementImport.findFirst.mockResolvedValue(
      context({ status: StatementImportStatus.NEEDS_REVIEW }),
    );

    await expect(
      service.correct("user-1", "payment-1", {
        ...paymentDto(),
        reason: "Wrong amount",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementPayment.updateMany).not.toHaveBeenCalled();
  });

  it("does not accept a correction row's key as a create replay", async () => {
    tx.statementPayment.findUnique.mockResolvedValue({
      statementImportId: "import-1",
      supersedesId: "payment-0",
      amount: 125,
      currency: "MXN",
      paidAt: new Date("2026-09-29T12:00:00.000Z"),
      note: null,
    });

    await expect(
      service.create("user-1", "import-1", paymentDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.statementPayment.create).not.toHaveBeenCalled();
  });

  function paymentDto() {
    return {
      amount: 125,
      currency: "MXN",
      paidAt: "2026-09-29T12:00:00.000Z",
      expectedVersion: 0,
      idempotencyKey: "e1e8c9f0-c84d-4fe1-9a70-99fd9067df4c",
    };
  }

  function context(
    options: {
      paymentVersion?: number;
      paidTotal?: number;
      voidedPaidTotal?: number;
      payments?: ReturnType<typeof payment>[];
      status?: StatementImportStatus;
      reconciliation?: null;
    } = {},
  ) {
    const payments = [
      ...(options.paidTotal ? [payment({ amount: options.paidTotal })] : []),
      ...(options.voidedPaidTotal
        ? [
            payment({
              amount: options.voidedPaidTotal,
              voidedAt: new Date("2026-09-29T13:00:00.000Z"),
              voidReason: "Duplicate bank record",
            }),
          ]
        : []),
    ];

    return {
      id: "import-1",
      userId: "user-1",
      status: options.status ?? StatementImportStatus.CONFIRMED,
      paymentStatus: StatementPaymentStatus.UNPAID,
      isPaid: false,
      paidAmount: null,
      paidAt: null,
      paymentVersion: options.paymentVersion ?? 0,
      reconciliation:
        options.reconciliation === null
          ? null
          : {
              closingBalance: 500,
              currency: "MXN",
              status: StatementReconciliationStatus.PASSED,
            },
      creditCard: { currency: "MXN" },
      paymentTargets: [],
      payments: options.payments ?? payments,
    };
  }

  function payment(
    overrides: Partial<{
      id: string;
      amount: number;
      currency: string;
      source: StatementPaymentSource;
      idempotencyKey: string;
      supersedesId: string | null;
      voidedAt: Date | null;
      voidReason: string | null;
    }> = {},
  ) {
    return {
      id: overrides.id ?? "payment-1",
      userId: "user-1",
      statementImportId: "import-1",
      amount: overrides.amount ?? 125,
      currency: overrides.currency ?? "MXN",
      paidAt: new Date("2026-09-29T12:00:00.000Z"),
      note: null,
      source: overrides.source ?? StatementPaymentSource.MANUAL,
      idempotencyKey: overrides.idempotencyKey ?? paymentDto().idempotencyKey,
      supersedesId: overrides.supersedesId ?? null,
      voidedAt: overrides.voidedAt ?? null,
      voidReason: overrides.voidReason ?? null,
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
      updatedAt: new Date("2026-09-29T12:00:00.000Z"),
    };
  }
});
