import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  StatementImportStatus,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
} from "@prisma/client";
import { CardStatementsService } from "./card-statements.service";
import type { ParsedStatementData } from "./card-statements.types";
import { StatementProcessingError } from "./parsers/statement-parser.interface";
import {
  calculateStatementPaymentSummary,
  type StatementSummaryInput,
} from "./statement-payment-summary";

describe("CardStatementsService", () => {
  type StatementRowCreateManyArg = {
    data: Array<{ occurrenceKey: string }>;
  };

  const statementImport = {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const expense = {
    count: jest.fn(),
  };
  const statementPayment = { count: jest.fn() };
  const tx = {
    statementImport: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    statementRow: {
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn<
        Promise<{ count: number }>,
        [StatementRowCreateManyArg]
      >(),
    },
    statementFinancingPlan: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    statementInstrumentSnapshot: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    statementPaymentTarget: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    statementReconciliation: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    expense: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    category: { count: jest.fn() },
    creditCard: { count: jest.fn() },
  };
  const prisma = {
    statementImport,
    expense,
    statementPayment,
    creditCard: { findFirst: jest.fn() },
    $transaction: jest.fn(async (input: unknown) => {
      if (typeof input === "function") {
        return (input as (client: typeof tx) => Promise<unknown>)(tx);
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  };
  const storage = {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
  };
  const processor = {
    process: jest.fn(),
  };
  const entitlements = {
    assertPremium: jest.fn<Promise<void>, [string, string]>(),
  };
  const statementPaymentsService = {
    summarize: jest.fn((context: Partial<StatementSummaryInput>) =>
      calculateStatementPaymentSummary({
        reconciliation: context.reconciliation ?? null,
        paymentTargets: context.paymentTargets ?? [],
        payments: context.payments ?? [],
      }),
    ),
    createCompatibilityPayment: jest.fn(),
    clearCompatibilityStatus: jest.fn(),
  };

  let service: CardStatementsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === "function") {
        return (input as (client: typeof tx) => Promise<unknown>)(tx);
      }
      return Promise.all(input as Promise<unknown>[]);
    });
    entitlements.assertPremium.mockResolvedValue(undefined);
    tx.expense.findMany.mockResolvedValue([]);
    service = new CardStatementsService(
      prisma as never,
      storage as never,
      processor as never,
      entitlements as never,
      statementPaymentsService as never,
    );
  });

  it("blocks every statement operation before side effects when Premium is missing", async () => {
    const premiumError = new ForbiddenException({
      code: "PREMIUM_REQUIRED",
      message: "Premium subscription required",
      feature: "statement_imports",
      isPremium: false,
    });
    entitlements.assertPremium.mockRejectedValue(premiumError);

    const operations: Array<() => Promise<unknown>> = [
      () =>
        service.createImport(
          "user-1",
          { creditCardId: "card-1" },
          buildFile("%PDF-test"),
        ),
      () => service.processStoredImport("user-1", "import-1"),
      () => service.findAll("user-1", {}),
      () => service.findOne("user-1", "import-1"),
      () =>
        service.updateRows("user-1", "import-1", {
          version: 1,
          rows: [],
        }),
      () => service.confirm("user-1", "import-1", { version: 1 }),
      () => service.revert("user-1", "import-1", { version: 1 }),
      () => service.resume("user-1", "import-1", { version: 1 }),
      () => service.setPaidStatus("user-1", "import-1", { isPaid: true }),
      () => service.remove("user-1", "import-1"),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toBe(premiumError);
    }

    expect(entitlements.assertPremium).toHaveBeenCalledTimes(operations.length);
    expect(entitlements.assertPremium).toHaveBeenCalledWith(
      "user-1",
      "statement_imports",
    );
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(statementImport.findFirst).not.toHaveBeenCalled();
    expect(statementImport.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("filters the import list by credit card when it belongs to the user", async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ id: "card-1" });
    statementImport.findMany.mockResolvedValue([]);
    statementImport.count.mockResolvedValue(0);

    await service.findAll("user-1", { creditCardId: "card-1" });

    expect(prisma.creditCard.findFirst).toHaveBeenCalledWith({
      where: { id: "card-1", userId: "user-1" },
      select: { id: true },
    });
    expect(statementImport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ creditCardId: "card-1" }) as unknown,
        select: expect.objectContaining({
          reconciliation: {
            select: { closingBalance: true, currency: true, status: true },
          },
        }) as unknown,
      }),
    );
  });

  it("rejects filtering by a credit card that does not belong to the user", async () => {
    prisma.creditCard.findFirst.mockResolvedValue(null);

    await expect(
      service.findAll("user-1", { creditCardId: "someone-elses-card" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(statementImport.findMany).not.toHaveBeenCalled();
  });

  it("exposes deterministic adjustment metadata without raw statement text", async () => {
    statementImport.findFirst.mockResolvedValue({
      ...baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
      sourceObjectKey: "object-key",
      reconciliation: null,
      paymentTargets: [],
      instruments: [],
      financingPlans: [],
      rows: [
        {
          id: "row-1",
          transactionDate: new Date("2026-08-10T12:00:00.000Z"),
          parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
          amount: 101,
          parsedAmount: 100,
          currency: "MXN",
          parsedCurrency: "MXN",
          kind: StatementRowKind.CHARGE,
          parsedKind: StatementRowKind.CHARGE,
          rawText: "sensitive source text",
        },
      ],
    });

    const result = await service.findOne("user-1", "import-1");

    expect(result.adjustmentCount).toBe(1);
    expect(result.rows[0]).toMatchObject({
      isAdjusted: true,
      parsedAmount: 100,
    });
    expect(result.rows[0]).not.toHaveProperty("rawText");
  });

  it("rejects a file whose bytes do not contain a PDF signature", async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ id: "card-1" });

    await expect(
      service.createImport(
        "user-1",
        { creditCardId: "card-1" },
        buildFile("not-a-pdf"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it("returns the existing import when the same source hash is uploaded again", async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ id: "card-1" });
    statementImport.findUnique.mockResolvedValue({
      id: "import-1",
      status: StatementImportStatus.UPLOADED,
      version: 1,
      warningCount: 0,
      failureCode: null,
    });

    await expect(
      service.createImport(
        "user-1",
        { creditCardId: "card-1" },
        buildFile("%PDF-same"),
      ),
    ).resolves.toEqual({
      id: "import-1",
      status: StatementImportStatus.UPLOADED,
      version: 1,
      warningCount: 0,
      failureCode: null,
      duplicate: true,
    });
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it("processes a newly stored PDF into review staging", async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ id: "card-1" });
    const parsed = parsedStatement([parsedRow("page-1:row-1", 0)]);
    statementImport.findUnique.mockResolvedValue(null);
    storage.uploadFile.mockResolvedValue("statements/user-1/object.pdf");
    statementImport.create.mockResolvedValue({
      id: "import-1",
      status: StatementImportStatus.UPLOADED,
      version: 1,
    });
    processor.process.mockResolvedValue(parsed);
    jest.spyOn(service, "stageParsedStatement").mockResolvedValue({
      id: "import-1",
      status: StatementImportStatus.NEEDS_REVIEW,
      version: 2,
      warningCount: 0,
      failureCode: null,
    } as never);

    await expect(
      service.createImport(
        "user-1",
        { creditCardId: "card-1" },
        buildFile("%PDF-new"),
      ),
    ).resolves.toMatchObject({
      id: "import-1",
      status: StatementImportStatus.NEEDS_REVIEW,
      duplicate: false,
    });
    expect(processor.process).toHaveBeenCalledWith(expect.any(Buffer));
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it("marks an import failed without exposing extractor internals", async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ id: "card-1" });
    statementImport.findUnique.mockResolvedValue(null);
    storage.uploadFile.mockResolvedValue("statements/user-1/object.pdf");
    statementImport.create.mockResolvedValue({
      id: "import-1",
      status: StatementImportStatus.UPLOADED,
      version: 1,
    });
    processor.process.mockRejectedValue(
      new StatementProcessingError(
        "BANAMEX_PERIOD_NOT_FOUND",
        "The Banamex statement period could not be identified",
      ),
    );
    statementImport.updateMany.mockResolvedValue({ count: 1 });
    statementImport.findFirst.mockResolvedValue({
      ...baseImport(StatementImportStatus.FAILED, 2, "object-key"),
      warningCount: 0,
      failureCode: "BANAMEX_PERIOD_NOT_FOUND",
      failureMessage: "The Banamex statement period could not be identified",
      reconciliation: null,
      paymentTargets: [],
      instruments: [],
      financingPlans: [],
      rows: [],
    });

    await expect(
      service.createImport(
        "user-1",
        { creditCardId: "card-1" },
        buildFile("%PDF-invalid-layout"),
      ),
    ).resolves.toMatchObject({
      id: "import-1",
      status: StatementImportStatus.FAILED,
      warningCount: 0,
      failureCode: "BANAMEX_PERIOD_NOT_FOUND",
      failureMessage: "The Banamex statement period could not be identified",
      duplicate: false,
    });
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it("logs and flattens an unexpected (non-parser) processing error", async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ id: "card-1" });
    statementImport.findUnique.mockResolvedValue(null);
    storage.uploadFile.mockResolvedValue("statements/user-1/object.pdf");
    statementImport.create.mockResolvedValue({
      id: "import-1",
      status: StatementImportStatus.UPLOADED,
      version: 1,
    });
    processor.process.mockRejectedValue(
      new Error("unexpected pdf-parse crash"),
    );
    statementImport.updateMany.mockResolvedValue({ count: 1 });
    statementImport.findFirst.mockResolvedValue({
      ...baseImport(StatementImportStatus.FAILED, 2, "object-key"),
      warningCount: 0,
      failureCode: "STATEMENT_PROCESSING_FAILED",
      failureMessage: "The statement could not be processed",
      reconciliation: null,
      paymentTargets: [],
      instruments: [],
      financingPlans: [],
      rows: [],
    });
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);

    await expect(
      service.createImport(
        "user-1",
        { creditCardId: "card-1" },
        buildFile("%PDF-crash"),
      ),
    ).resolves.toMatchObject({
      status: StatementImportStatus.FAILED,
      failureCode: "STATEMENT_PROCESSING_FAILED",
      failureMessage: "The statement could not be processed",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unexpected pdf-parse crash"),
    );

    errorSpy.mockRestore();
  });

  it("preserves repeated-looking rows when their occurrence keys differ", async () => {
    statementImport.findFirst
      .mockResolvedValueOnce(baseImport(StatementImportStatus.UPLOADED, 1))
      .mockResolvedValueOnce({
        ...baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
        reconciliation: {},
        paymentTargets: [],
        instruments: [],
        financingPlans: [],
        rows: [],
      });
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.creditCard.count.mockResolvedValue(1);
    tx.statementInstrumentSnapshot.create.mockResolvedValue({
      id: "instrument-1",
    });
    tx.statementReconciliation.create.mockResolvedValue({});
    tx.statementRow.createMany.mockResolvedValue({ count: 2 });

    const parsed = parsedStatement([
      parsedRow("page-2:row-1", 0),
      parsedRow("page-2:row-2", 1),
    ]);

    await service.stageParsedStatement("user-1", "import-1", parsed);

    const createCall = tx.statementRow.createMany.mock.calls[0]?.[0];
    expect(createCall?.data.map((row) => row.occurrenceKey)).toEqual([
      "page-2:row-1",
      "page-2:row-2",
    ]);
    expect(createCall?.data[0]).toMatchObject({
      parsedTransactionDate: parsed.rows[0].transactionDate,
      parsedAmount: parsed.rows[0].amount,
      parsedCurrency: parsed.rows[0].currency,
      parsedKind: parsed.rows[0].kind,
    });
    const reconciliationCalls = tx.statementReconciliation.create.mock
      .calls as Array<[{ data: { currency: string } }]>;
    const reconciliationCall = reconciliationCalls[0][0];
    expect(reconciliationCall.data.currency).toBe("MXN");
  });

  it("rejects another import for the same owned card cycle before replacing children", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.UPLOADED, 1),
    );
    tx.statementImport.findFirst.mockResolvedValue({ id: "existing-import" });

    await expectCycleConflict(
      service.stageParsedStatement(
        "user-1",
        "import-1",
        parsedStatement([parsedRow("row-1", 0)]),
      ),
    );
    expect(tx.statementRow.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    "statement_imports_user_card_period_key",
    ["periodEnd", "creditCardId", "userId", "periodStart"],
  ])(
    "translates a concurrent cycle unique violation for target %p",
    async (target) => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.UPLOADED, 1),
      );
      prisma.$transaction.mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint"), {
          code: "P2002",
          meta: { target },
        }),
      );

      await expectCycleConflict(
        service.stageParsedStatement(
          "user-1",
          "import-1",
          parsedStatement([parsedRow("row-1", 0)]),
        ),
      );
      expect(statementImport.delete).not.toHaveBeenCalled();
    },
  );

  it("rethrows an unrelated concurrent unique violation", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.UPLOADED, 1),
    );
    const uniqueError = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
      meta: { target: ["statementImportId", "occurrenceKey"] },
    });
    prisma.$transaction.mockRejectedValueOnce(uniqueError);

    await expect(
      service.stageParsedStatement(
        "user-1",
        "import-1",
        parsedStatement([parsedRow("row-1", 0)]),
      ),
    ).rejects.toBe(uniqueError);
  });

  it("rethrows a malformed cycle target with a duplicate and missing field", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.UPLOADED, 1),
    );
    const uniqueError = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
      meta: {
        target: ["userId", "creditCardId", "periodStart", "periodStart"],
      },
    });
    prisma.$transaction.mockRejectedValueOnce(uniqueError);

    await expect(
      service.stageParsedStatement(
        "user-1",
        "import-1",
        parsedStatement([parsedRow("row-1", 0)]),
      ),
    ).rejects.toBe(uniqueError);
  });

  it("rejects duplicate occurrence keys before persisting parsed rows", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.UPLOADED, 1),
    );
    const parsed = parsedStatement([
      parsedRow("duplicate", 0),
      parsedRow("duplicate", 1),
    ]);

    await expect(
      service.stageParsedStatement("user-1", "import-1", parsed),
    ).rejects.toThrow("occurrence keys must be non-empty and unique");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["amount", { amount: 101 }],
    ["date", { transactionDate: "2026-08-11T12:00:00.000Z" }],
    ["currency", { currency: "USD" }],
    ["kind", { kind: StatementRowKind.INTEREST }],
  ])(
    "detects a %s adjustment and accepts it with a trimmed reason",
    async (_field, patch) => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
      );
      const currentRow = {
        id: "row-1",
        transactionDate: new Date("2026-08-10T12:00:00.000Z"),
        parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
        amount: 100,
        parsedAmount: 100,
        currency: "MXN",
        parsedCurrency: "MXN",
        kind: StatementRowKind.CHARGE,
        parsedKind: StatementRowKind.CHARGE,
        decisionNote: null,
      };
      tx.statementRow.findMany
        .mockResolvedValueOnce([currentRow])
        .mockResolvedValueOnce([]);
      tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
      jest
        .spyOn(service, "findOne")
        .mockResolvedValue({ id: "import-1" } as never);

      await expect(
        service.updateRows("user-1", "import-1", {
          version: 2,
          rows: [
            {
              id: "row-1",
              ...patch,
              decisionNote: "  Verified correction  ",
            },
          ],
        }),
      ).resolves.toBeDefined();
      const updateCalls = tx.statementRow.update.mock.calls as Array<
        [{ data: { decisionNote: string } }]
      >;
      const updateCall = updateCalls[0][0];
      expect(updateCall.data.decisionNote).toBe("Verified correction");
    },
  );

  it("rejects clearing the reason while an accounting adjustment remains", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
    );
    tx.statementRow.findMany.mockResolvedValueOnce([
      {
        id: "row-1",
        transactionDate: new Date("2026-08-10T12:00:00.000Z"),
        parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
        amount: 101,
        parsedAmount: 100,
        currency: "MXN",
        parsedCurrency: "MXN",
        kind: StatementRowKind.CHARGE,
        parsedKind: StatementRowKind.CHARGE,
        decisionNote: "Verified correction",
      },
    ]);

    await expect(
      service.updateRows("user-1", "import-1", {
        version: 2,
        rows: [{ id: "row-1", decisionNote: null }],
      }),
    ).rejects.toThrow("Every accounting adjustment requires a decision note");
    expect(tx.statementRow.update).not.toHaveBeenCalled();
  });

  it("compares row amounts at persisted cent precision", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
    );
    tx.statementRow.findMany
      .mockResolvedValueOnce([
        {
          id: "row-1",
          transactionDate: new Date("2026-08-10T12:00:00.000Z"),
          parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
          amount: 100,
          parsedAmount: 100,
          currency: "MXN",
          parsedCurrency: "MXN",
          kind: StatementRowKind.CHARGE,
          parsedKind: StatementRowKind.CHARGE,
          decisionNote: null,
        },
      ])
      .mockResolvedValueOnce([]);
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    jest
      .spyOn(service, "findOne")
      .mockResolvedValue({ id: "import-1" } as never);

    await expect(
      service.updateRows("user-1", "import-1", {
        version: 2,
        rows: [{ id: "row-1", amount: 100.001 }],
      }),
    ).resolves.toBeDefined();
  });

  it("confirms reviewed expense rows in one database transaction", async () => {
    statementImport.findFirst
      .mockResolvedValueOnce(
        baseImport(StatementImportStatus.NEEDS_REVIEW, 2, "object-key"),
      )
      .mockResolvedValueOnce({
        ...baseImport(StatementImportStatus.CONFIRMED, 3, null),
        reconciliation: { status: StatementReconciliationStatus.PASSED },
        paymentTargets: [],
        instruments: [],
        financingPlans: [],
        rows: [],
      });
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementImport.findUnique.mockResolvedValue({
      ...baseImport(StatementImportStatus.NEEDS_REVIEW, 3, "object-key"),
      reconciliation: { status: StatementReconciliationStatus.PASSED },
      rows: [
        {
          id: "row-1",
          section: StatementSection.CURRENT_CHARGES,
          kind: StatementRowKind.CHARGE,
          transactionDate: new Date("2026-08-10T12:00:00.000Z"),
          description: "LOCAL PURCHASE",
          merchantName: "Local purchase",
          amount: 120,
          currency: "MXN",
          parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
          parsedAmount: 120,
          parsedCurrency: "MXN",
          parsedKind: StatementRowKind.CHARGE,
          decisionNote: null,
          categoryId: "category-1",
          linkedCreditCardId: "card-1",
          decision: StatementRowDecision.INCLUDE_EXPENSE,
        },
        {
          id: "row-2",
          decision: StatementRowDecision.INFO_ONLY,
        },
      ],
    });
    tx.category.count.mockResolvedValue(1);
    tx.creditCard.count.mockResolvedValue(1);
    tx.expense.createMany.mockResolvedValue({ count: 1 });
    tx.statementImport.update.mockResolvedValue({});
    storage.deleteFile.mockResolvedValue(undefined);
    statementImport.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.confirm("user-1", "import-1", { version: 2 });

    expect(tx.expense.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          statementRowId: "row-1",
          creditCardId: "card-1",
          cost: 120,
        }),
      ],
    });
    expect(result).toMatchObject({
      createdExpenseCount: 1,
      alreadyConfirmed: false,
      sourceDeletionPending: false,
    });
  });

  it("never confirms CFDI rows as expenses", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
    );
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementImport.findUnique.mockResolvedValue({
      ...baseImport(StatementImportStatus.NEEDS_REVIEW, 3),
      reconciliation: { status: StatementReconciliationStatus.PASSED },
      rows: [
        {
          id: "row-cfdi",
          section: StatementSection.CFDI,
          kind: StatementRowKind.CFDI,
          transactionDate: new Date(),
          description: "Fiscal appendix",
          merchantName: null,
          amount: 100,
          currency: "MXN",
          categoryId: "category-1",
          linkedCreditCardId: "card-1",
          decision: StatementRowDecision.INCLUDE_EXPENSE,
        },
      ],
    });

    await expect(
      service.confirm("user-1", "import-1", { version: 2 }),
    ).rejects.toThrow("cannot be included as an expense");
    expect(tx.expense.createMany).not.toHaveBeenCalled();
  });

  it("rechecks accounting adjustments inside confirmation and requires a reason", async () => {
    statementImport.findFirst.mockResolvedValue(
      baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
    );
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementImport.findUnique.mockResolvedValue({
      ...baseImport(StatementImportStatus.NEEDS_REVIEW, 3),
      reconciliation: { status: StatementReconciliationStatus.PASSED },
      rows: [
        {
          id: "row-adjusted",
          section: StatementSection.CURRENT_CHARGES,
          kind: StatementRowKind.CHARGE,
          parsedKind: StatementRowKind.CHARGE,
          transactionDate: new Date("2026-08-10T12:00:00.000Z"),
          parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
          description: "Adjusted purchase",
          merchantName: null,
          amount: 125,
          parsedAmount: 120,
          currency: "MXN",
          parsedCurrency: "MXN",
          categoryId: "category-1",
          linkedCreditCardId: "card-1",
          decision: StatementRowDecision.INCLUDE_EXPENSE,
          decisionNote: "   ",
        },
      ],
    });

    await expect(
      service.confirm("user-1", "import-1", { version: 2 }),
    ).rejects.toThrow("Every accounting adjustment requires a decision note");
    expect(tx.expense.createMany).not.toHaveBeenCalled();
  });

  describe("setPaidStatus", () => {
    it("marks an import paid, stamps paidAt, and stores the paid amount", async () => {
      statementImport.findFirst
        .mockResolvedValueOnce(baseImport(StatementImportStatus.CONFIRMED, 3))
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.CONFIRMED, 3),
          isPaid: true,
          paidAt: new Date("2026-08-15T00:00:00.000Z"),
          paidAmount: 4199.31,
          reconciliation: null,
          paymentTargets: [],
          instruments: [],
          financingPlans: [],
          rows: [],
        });
      statementImport.update.mockResolvedValue({});

      const result = await service.setPaidStatus("user-1", "import-1", {
        isPaid: true,
        amount: 4199.31,
      });

      expect(
        statementPaymentsService.createCompatibilityPayment,
      ).toHaveBeenCalledWith(
        "user-1",
        "import-1",
        expect.objectContaining({ amount: 4199.31 }),
      );
      expect(result).toMatchObject({ isPaid: true, paidAmount: 4199.31 });
      expect(result.paidAt).not.toBeNull();
    });

    it("marks an import unpaid, clears paidAt, and clears the paid amount", async () => {
      statementImport.findFirst
        .mockResolvedValueOnce(baseImport(StatementImportStatus.CONFIRMED, 3))
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.CONFIRMED, 3),
          isPaid: false,
          paidAt: null,
          paidAmount: null,
          reconciliation: null,
          paymentTargets: [],
          instruments: [],
          financingPlans: [],
          rows: [],
        });
      statementImport.update.mockResolvedValue({});

      const result = await service.setPaidStatus("user-1", "import-1", {
        isPaid: false,
      });

      expect(
        statementPaymentsService.clearCompatibilityStatus,
      ).toHaveBeenCalledWith("user-1", "import-1");
      expect(result).toMatchObject({
        isPaid: false,
        paidAt: null,
        paidAmount: null,
      });
    });

    it("throws NotFoundException for a nonexistent or unowned import", async () => {
      statementImport.findFirst.mockResolvedValue(null);

      await expect(
        service.setPaidStatus("user-1", "someone-elses-import", {
          isPaid: true,
          amount: 100,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(statementImport.update).not.toHaveBeenCalled();
    });
  });

  it("reverts imported expenses without erasing payment history", async () => {
    const paymentHistory = [
      {
        id: "payment-1",
        amount: 125,
        currency: "MXN",
        paidAt: new Date("2026-09-29T12:00:00.000Z"),
        voidedAt: null,
      },
    ];
    statementImport.findFirst
      .mockResolvedValueOnce(baseImport(StatementImportStatus.CONFIRMED, 3))
      .mockResolvedValueOnce({
        ...baseImport(StatementImportStatus.REVERTED, 4),
        reconciliation: null,
        paymentTargets: [],
        payments: paymentHistory,
        instruments: [],
        financingPlans: [],
        rows: [],
      });
    tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
    tx.statementRow.findMany.mockResolvedValue([{ id: "row-1" }]);
    tx.expense.deleteMany.mockResolvedValue({ count: 1 });
    tx.statementImport.update.mockResolvedValue({});

    const result = await service.revert("user-1", "import-1", { version: 3 });

    expect(result.import.paymentHistory).toEqual(paymentHistory);
    expect(result.deletedExpenseCount).toBe(1);
    expect(prisma.statementPayment).not.toHaveProperty("deleteMany");
  });

  describe("matching registered expenses", () => {
    function stageSetup() {
      statementImport.findFirst
        .mockResolvedValueOnce(baseImport(StatementImportStatus.UPLOADED, 1))
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
          reconciliation: {},
          paymentTargets: [],
          instruments: [],
          financingPlans: [],
          rows: [],
        });
      tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
      tx.creditCard.count.mockResolvedValue(1);
      tx.statementReconciliation.create.mockResolvedValue({});
      tx.statementRow.createMany.mockResolvedValue({ count: 2 });
    }

    const registered = {
      id: "expense-1",
      title: "Same installment",
      merchantName: null,
      cost: new Prisma.Decimal(100),
      currency: "MXN",
      date: new Date("2026-08-10T18:00:00.000Z"),
      isInstallment: false,
    };

    it("stages a matching row as INFO_ONLY with the expense id and a warning", async () => {
      stageSetup();
      tx.expense.findMany.mockResolvedValue([registered]);

      await service.stageParsedStatement(
        "user-1",
        "import-1",
        parsedStatement([parsedRow("r1", 0), parsedRow("r2", 1)]),
      );

      expect(tx.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-1",
            creditCardId: "card-1",
            statementRowId: null,
          }) as unknown,
        }),
      );
      const data = tx.statementRow.createMany.mock.calls[0][0].data as Array<{
        occurrenceKey: string;
        decision?: StatementRowDecision;
        matchedExpenseId?: string | null;
        warningCodes?: string[];
      }>;
      expect(data[0]).toMatchObject({
        occurrenceKey: "r1",
        decision: StatementRowDecision.INFO_ONLY,
        matchedExpenseId: "expense-1",
        warningCodes: ["MATCHES_REGISTERED_EXPENSE"],
      });
      expect(data[1].matchedExpenseId ?? null).toBeNull();
      expect(data[1].decision).toBe(StatementRowDecision.PENDING);
    });

    it("skips matching when the import has no credit card", async () => {
      stageSetup();
      statementImport.findFirst.mockReset();
      statementImport.findFirst
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.UPLOADED, 1),
          creditCardId: null,
        })
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
          reconciliation: {},
          paymentTargets: [],
          instruments: [],
          financingPlans: [],
          rows: [],
        });

      await service.stageParsedStatement(
        "user-1",
        "import-1",
        parsedStatement([parsedRow("r1", 0)]),
      );

      expect(tx.expense.findMany).not.toHaveBeenCalled();
    });

    it("links matched expenses on confirm without creating duplicates and counts skipped links", async () => {
      statementImport.findFirst
        .mockResolvedValueOnce(
          baseImport(StatementImportStatus.NEEDS_REVIEW, 2, null),
        )
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.CONFIRMED, 3, null),
          reconciliation: { status: StatementReconciliationStatus.PASSED },
          paymentTargets: [],
          instruments: [],
          financingPlans: [],
          rows: [],
        });
      tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
      const matchedRow = (id: string, expenseId: string) => ({
        id,
        decision: StatementRowDecision.INFO_ONLY,
        matchedExpenseId: expenseId,
        kind: StatementRowKind.CHARGE,
        transactionDate: new Date("2026-08-10T12:00:00.000Z"),
        parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
        amount: 100,
        parsedAmount: 100,
        currency: "MXN",
        parsedCurrency: "MXN",
        parsedKind: StatementRowKind.CHARGE,
        decisionNote: null,
      });
      tx.statementImport.findUnique.mockResolvedValue({
        ...baseImport(StatementImportStatus.NEEDS_REVIEW, 3, null),
        reconciliation: { status: StatementReconciliationStatus.PASSED },
        rows: [
          matchedRow("row-1", "expense-1"),
          matchedRow("row-2", "expense-2"),
        ],
      });
      tx.expense.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      tx.statementImport.update.mockResolvedValue({});
      statementImport.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.confirm("user-1", "import-1", {
        version: 2,
      });

      expect(tx.expense.createMany).not.toHaveBeenCalled();
      expect(tx.expense.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: "expense-1", userId: "user-1", statementRowId: null },
        data: { statementRowId: "row-1" },
      });
      expect(result).toMatchObject({
        createdExpenseCount: 0,
        linkedExpenseCount: 1,
        skippedMatchedExpenseCount: 1,
      });
    });

    it("unlinks matched expenses on revert and only deletes created ones", async () => {
      statementImport.findFirst
        .mockResolvedValueOnce(baseImport(StatementImportStatus.CONFIRMED, 3))
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.REVERTED, 4),
          reconciliation: null,
          paymentTargets: [],
          payments: [],
          instruments: [],
          financingPlans: [],
          rows: [],
        });
      tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
      tx.statementRow.findMany.mockResolvedValue([
        { id: "row-1", matchedExpenseId: "expense-1" },
        { id: "row-2", matchedExpenseId: null },
      ]);
      tx.expense.updateMany.mockResolvedValue({ count: 1 });
      tx.expense.deleteMany.mockResolvedValue({ count: 1 });
      tx.statementImport.update.mockResolvedValue({});

      const result = await service.revert("user-1", "import-1", {
        version: 3,
      });

      expect(tx.expense.updateMany).toHaveBeenCalledWith({
        where: {
          statementRowId: { in: ["row-1", "row-2"] },
          id: { in: ["expense-1"] },
        },
        data: { statementRowId: null },
      });
      expect(tx.expense.deleteMany).toHaveBeenCalledWith({
        where: {
          statementRowId: { in: ["row-1", "row-2"] },
          id: { notIn: ["expense-1"] },
        },
      });
      expect(result).toMatchObject({
        deletedExpenseCount: 1,
        unlinkedExpenseCount: 1,
      });
    });

    it.each([
      [StatementRowDecision.INCLUDE_EXPENSE],
      [StatementRowDecision.EXCLUDE],
    ])("clears the match when the decision becomes %s", async (decision) => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
      );
      tx.statementRow.findMany
        .mockResolvedValueOnce([
          {
            id: "row-1",
            transactionDate: new Date("2026-08-10T12:00:00.000Z"),
            parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
            amount: 100,
            parsedAmount: 100,
            currency: "MXN",
            parsedCurrency: "MXN",
            kind: StatementRowKind.CHARGE,
            parsedKind: StatementRowKind.CHARGE,
            decisionNote: null,
            matchedExpenseId: "expense-1",
            warningCodes: ["MATCHES_REGISTERED_EXPENSE", "OTHER"],
          },
        ])
        .mockResolvedValueOnce([]);
      tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
      jest
        .spyOn(service, "findOne")
        .mockResolvedValue({ id: "import-1" } as never);

      await service.updateRows("user-1", "import-1", {
        version: 2,
        rows: [{ id: "row-1", decision }],
      });

      expect(tx.statementRow.update).toHaveBeenCalledWith({
        where: { id: "row-1" },
        data: expect.objectContaining({
          decision,
          matchedExpenseId: null,
          warningCodes: ["OTHER"],
        }) as unknown,
      });
    });

    it("keeps the match when the decision stays INFO_ONLY", async () => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.NEEDS_REVIEW, 2),
      );
      tx.statementRow.findMany
        .mockResolvedValueOnce([
          {
            id: "row-1",
            transactionDate: new Date("2026-08-10T12:00:00.000Z"),
            parsedTransactionDate: new Date("2026-08-10T12:00:00.000Z"),
            amount: 100,
            parsedAmount: 100,
            currency: "MXN",
            parsedCurrency: "MXN",
            kind: StatementRowKind.CHARGE,
            parsedKind: StatementRowKind.CHARGE,
            decisionNote: null,
            matchedExpenseId: "expense-1",
            warningCodes: ["MATCHES_REGISTERED_EXPENSE"],
          },
        ])
        .mockResolvedValueOnce([]);
      tx.statementImport.updateMany.mockResolvedValue({ count: 1 });
      jest
        .spyOn(service, "findOne")
        .mockResolvedValue({ id: "import-1" } as never);

      await service.updateRows("user-1", "import-1", {
        version: 2,
        rows: [{ id: "row-1", decision: StatementRowDecision.INFO_ONLY }],
      });

      const calls = tx.statementRow.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      expect(calls[0][0].data).not.toHaveProperty("matchedExpenseId");
    });
  });

  describe("resume", () => {
    it("moves a reverted import back to NEEDS_REVIEW so it becomes editable again", async () => {
      statementImport.findFirst
        .mockResolvedValueOnce(baseImport(StatementImportStatus.REVERTED, 3))
        .mockResolvedValueOnce({
          ...baseImport(StatementImportStatus.NEEDS_REVIEW, 4),
          reconciliation: null,
          paymentTargets: [],
          instruments: [],
          financingPlans: [],
          rows: [],
        });
      statementImport.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.resume("user-1", "import-1", {
        version: 3,
      });

      expect(statementImport.updateMany).toHaveBeenCalledWith({
        where: {
          id: "import-1",
          userId: "user-1",
          version: 3,
          status: StatementImportStatus.REVERTED,
        },
        data: {
          status: StatementImportStatus.NEEDS_REVIEW,
          revertedAt: null,
          version: { increment: 1 },
        },
      });
      expect(result).toMatchObject({
        status: StatementImportStatus.NEEDS_REVIEW,
      });
    });

    it("rejects resuming an import that isn't reverted", async () => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.CONFIRMED, 1),
      );

      await expect(
        service.resume("user-1", "import-1", { version: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(statementImport.updateMany).not.toHaveBeenCalled();
    });

    it("rejects a stale version before touching the database", async () => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.REVERTED, 3),
      );

      await expect(
        service.resume("user-1", "import-1", { version: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(statementImport.updateMany).not.toHaveBeenCalled();
    });

    it("throws ConflictException on a concurrent update race", async () => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.REVERTED, 3),
      );
      statementImport.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resume("user-1", "import-1", { version: 3 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("throws NotFoundException for a nonexistent or unowned import", async () => {
      statementImport.findFirst.mockResolvedValue(null);

      await expect(
        service.resume("user-1", "someone-elses-import", { version: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(statementImport.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deletes a non-confirmed import and cleans up its stored PDF", async () => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.NEEDS_REVIEW, 2, "object-key"),
      );
      storage.deleteFile.mockResolvedValue(undefined);
      statementImport.updateMany.mockResolvedValue({ count: 1 });
      statementImport.delete.mockResolvedValue({});

      const result = await service.remove("user-1", "import-1");

      expect(storage.deleteFile).toHaveBeenCalledWith("object-key");
      expect(statementImport.delete).toHaveBeenCalledWith({
        where: { id: "import-1" },
      });
      expect(result).toMatchObject({ message: expect.any(String) as unknown });
    });

    it("throws NotFoundException for a nonexistent or unowned import", async () => {
      statementImport.findFirst.mockResolvedValue(null);

      await expect(
        service.remove("user-1", "someone-elses-import"),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(statementImport.delete).not.toHaveBeenCalled();
    });

    it("blocks deletion of a confirmed import", async () => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.CONFIRMED, 3, "object-key"),
      );

      await expect(service.remove("user-1", "import-1")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(statementImport.delete).not.toHaveBeenCalled();
    });

    it("blocks deletion when any payment history exists", async () => {
      statementImport.findFirst.mockResolvedValue(
        baseImport(StatementImportStatus.REVERTED, 4, "object-key"),
      );
      statementPayment.count.mockResolvedValue(1);

      await expect(service.remove("user-1", "import-1")).rejects.toThrow(
        "Statements with payment history cannot be deleted",
      );
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(statementImport.delete).not.toHaveBeenCalled();
    });

    it("rejects a non-premium user before any lookup", async () => {
      const premiumError = new ForbiddenException({
        code: "PREMIUM_REQUIRED",
        message: "Premium subscription required",
        feature: "statement_imports",
        isPremium: false,
      });
      entitlements.assertPremium.mockRejectedValue(premiumError);

      await expect(service.remove("user-1", "import-1")).rejects.toBe(
        premiumError,
      );
      expect(statementImport.findFirst).not.toHaveBeenCalled();
    });
  });

  function buildFile(contents: string): Express.Multer.File {
    const buffer = Buffer.from(contents);
    return {
      fieldname: "file",
      originalname: "statement.pdf",
      encoding: "7bit",
      mimetype: "application/pdf",
      size: buffer.byteLength,
      destination: "",
      filename: "",
      path: "",
      buffer,
      stream: undefined as never,
    };
  }

  async function expectCycleConflict(operation: Promise<unknown>) {
    try {
      await operation;
      throw new Error("Expected a statement cycle conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse() as {
        code: string;
      };
      expect(response.code).toBe("STATEMENT_CYCLE_CONFLICT");
    }
  }

  function baseImport(
    status: StatementImportStatus,
    version: number,
    sourceObjectKey: string | null = null,
  ) {
    return {
      id: "import-1",
      userId: "user-1",
      creditCardId: "card-1",
      status,
      version,
      paymentVersion: 0,
      sourceObjectKey,
    };
  }

  function parsedRow(occurrenceKey: string, position: number) {
    return {
      occurrenceKey,
      section: StatementSection.CURRENT_CHARGES,
      position,
      transactionDate: new Date("2026-08-10T12:00:00.000Z"),
      description: "SAME INSTALLMENT",
      amount: 100,
      currency: "MXN",
      kind: StatementRowKind.CHARGE,
    };
  }

  function parsedStatement(
    rows: ReturnType<typeof parsedRow>[],
  ): ParsedStatementData {
    return {
      parserVersion: "banamex-v1",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T23:59:59.999Z"),
      warningCount: 0,
      reconciliation: {
        currency: "MXN",
        openingBalance: 0,
        chargesTotal: 200,
        paymentsTotal: 0,
        creditsTotal: 0,
        closingBalance: 200,
        difference: 0,
        status: StatementReconciliationStatus.PASSED,
      },
      instruments: [],
      financingPlans: [],
      paymentTargets: [],
      rows,
    };
  }
});
