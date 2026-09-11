import { BadRequestException, ForbiddenException, Logger } from "@nestjs/common";
import {
  StatementImportStatus,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
} from "@prisma/client";
import { CardStatementsService } from "./card-statements.service";
import type { ParsedStatementData } from "./card-statements.types";
import { StatementProcessingError } from "./parsers/statement-parser.interface";

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
  };
  const expense = {
    count: jest.fn(),
  };
  const tx = {
    statementImport: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
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
    },
    category: { count: jest.fn() },
    creditCard: { count: jest.fn() },
  };
  const prisma = {
    statementImport,
    expense,
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
    service = new CardStatementsService(
      prisma as never,
      storage as never,
      processor as never,
      entitlements as never,
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
      () => service.createImport("user-1", {}, buildFile("%PDF-test")),
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
        where: expect.objectContaining({ creditCardId: "card-1" }),
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

  it("rejects a file whose bytes do not contain a PDF signature", async () => {
    await expect(
      service.createImport("user-1", {}, buildFile("not-a-pdf")),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  it("returns the existing import when the same source hash is uploaded again", async () => {
    statementImport.findUnique.mockResolvedValue({
      id: "import-1",
      status: StatementImportStatus.UPLOADED,
      version: 1,
      warningCount: 0,
      failureCode: null,
    });

    await expect(
      service.createImport("user-1", {}, buildFile("%PDF-same")),
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
      service.createImport("user-1", {}, buildFile("%PDF-new")),
    ).resolves.toMatchObject({
      id: "import-1",
      status: StatementImportStatus.NEEDS_REVIEW,
      duplicate: false,
    });
    expect(processor.process).toHaveBeenCalledWith(expect.any(Buffer));
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it("marks an import failed without exposing extractor internals", async () => {
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
      service.createImport("user-1", {}, buildFile("%PDF-invalid-layout")),
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
    statementImport.findUnique.mockResolvedValue(null);
    storage.uploadFile.mockResolvedValue("statements/user-1/object.pdf");
    statementImport.create.mockResolvedValue({
      id: "import-1",
      status: StatementImportStatus.UPLOADED,
      version: 1,
    });
    processor.process.mockRejectedValue(new Error("unexpected pdf-parse crash"));
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
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await expect(
      service.createImport("user-1", {}, buildFile("%PDF-crash")),
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
