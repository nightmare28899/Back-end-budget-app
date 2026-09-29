import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { StatementRowDecision, StatementRowKind } from "@prisma/client";
import { ConfirmStatementImportDto } from "./dto/confirm-statement-import.dto";
import { CreateStatementImportDto } from "./dto/create-statement-import.dto";
import { MarkStatementPaidDto } from "./dto/mark-statement-paid.dto";
import { QueryStatementImportsDto } from "./dto/query-statement-imports.dto";
import { UpdateStatementRowsDto } from "./dto/update-statement-rows.dto";
import { CreateStatementPaymentDto } from "./dto/create-statement-payment.dto";
import { CorrectStatementPaymentDto } from "./dto/correct-statement-payment.dto";
import { VoidStatementPaymentDto } from "./dto/void-statement-payment.dto";
import {
  buildStatementUploadOptions,
  DEFAULT_MAX_STATEMENT_FILE_SIZE,
} from "../common/upload/statement-upload.config";

describe("statement import contracts", () => {
  it("accepts a complete reviewed-row update", async () => {
    const dto = plainToInstance(UpdateStatementRowsDto, {
      version: 2,
      rows: [
        {
          id: "7d33044b-d8b3-4f04-aa50-5eeed503e685",
          decision: StatementRowDecision.INCLUDE_EXPENSE,
          kind: StatementRowKind.CHARGE,
          transactionDate: "2026-08-10T12:00:00.000Z",
          description: "Local purchase",
          merchantName: "Store",
          amount: 120.5,
          currency: "mxn",
          categoryId: "1c9f6c1e-42dd-4fc4-a078-8f4a67dd8106",
          linkedCreditCardId: "c6eb109b-a916-42f3-a312-c796086be90e",
          decisionNote: "  Corrected from receipt  ",
        },
      ],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.rows[0].currency).toBe("MXN");
    expect(dto.rows[0].decisionNote).toBe("Corrected from receipt");
  });

  it("rejects an empty reviewed-row update", async () => {
    const dto = plainToInstance(UpdateStatementRowsDto, {
      version: 1,
      rows: [],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("requires a positive integer version for confirmation", async () => {
    const dto = plainToInstance(ConfirmStatementImportDto, { version: 0 });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("accepts a paid-status update with an amount", async () => {
    const dto = plainToInstance(MarkStatementPaidDto, {
      isPaid: true,
      amount: 4199.31,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("accepts an unpaid update without an amount", async () => {
    const dto = plainToInstance(MarkStatementPaidDto, { isPaid: false });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("rejects a non-boolean paid-status update", async () => {
    const dto = plainToInstance(MarkStatementPaidDto, { isPaid: "yes" });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("rejects marking paid without an amount", async () => {
    const dto = plainToInstance(MarkStatementPaidDto, { isPaid: true });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("rejects a non-positive amount", async () => {
    const dto = plainToInstance(MarkStatementPaidDto, {
      isPaid: true,
      amount: 0,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("accepts a normalized append-only payment payload", async () => {
    const dto = plainToInstance(CreateStatementPaymentDto, {
      amount: 125.5,
      currency: " mxn ",
      paidAt: "2026-09-29T12:00:00.000Z",
      note: "  First installment  ",
      expectedVersion: 0,
      idempotencyKey: "e1e8c9f0-c84d-4fe1-9a70-99fd9067df4c",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toMatchObject({ currency: "MXN", note: "First installment" });
  });

  it("normalizes a blank optional payment note away", async () => {
    const dto = plainToInstance(CreateStatementPaymentDto, {
      amount: 125.5,
      currency: "MXN",
      paidAt: "2026-09-29T12:00:00.000Z",
      note: "   ",
      expectedVersion: 0,
      idempotencyKey: "e1e8c9f0-c84d-4fe1-9a70-99fd9067df4c",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.note).toBeUndefined();
  });

  it.each([0, -1, 1.001])("rejects invalid payment amount %s", async (amount) => {
    const dto = plainToInstance(CreateStatementPaymentDto, {
      amount,
      currency: "MXN",
      paidAt: "2026-09-29T12:00:00.000Z",
      expectedVersion: 0,
      idempotencyKey: "e1e8c9f0-c84d-4fe1-9a70-99fd9067df4c",
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("requires a non-empty correction reason", async () => {
    const dto = plainToInstance(CorrectStatementPaymentDto, {
      amount: 100,
      currency: "MXN",
      paidAt: "2026-09-29T12:00:00.000Z",
      expectedVersion: 1,
      idempotencyKey: "e1e8c9f0-c84d-4fe1-9a70-99fd9067df4c",
      reason: "   ",
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("requires a non-empty void reason", async () => {
    const dto = plainToInstance(VoidStatementPaymentDto, {
      expectedVersion: 1,
      reason: "   ",
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("bounds statement import pagination", async () => {
    const dto = plainToInstance(QueryStatementImportsDto, {
      page: "1",
      limit: "101",
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("requires a credit card when creating a statement import", async () => {
    const dto = plainToInstance(CreateStatementImportDto, {});

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("accepts a statement import create request with a credit card", async () => {
    const dto = plainToInstance(CreateStatementImportDto, {
      creditCardId: "c6eb109b-a916-42f3-a312-c796086be90e",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("uses a dedicated ten-megabyte, single-file upload limit", () => {
    const options = buildStatementUploadOptions();

    expect(options.limits).toMatchObject({
      fileSize: DEFAULT_MAX_STATEMENT_FILE_SIZE,
      files: 1,
    });
  });
});
