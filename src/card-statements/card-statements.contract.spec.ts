import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { StatementRowDecision, StatementRowKind } from "@prisma/client";
import { ConfirmStatementImportDto } from "./dto/confirm-statement-import.dto";
import { QueryStatementImportsDto } from "./dto/query-statement-imports.dto";
import { UpdateStatementRowsDto } from "./dto/update-statement-rows.dto";
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
        },
      ],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.rows[0].currency).toBe("MXN");
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

  it("bounds statement import pagination", async () => {
    const dto = plainToInstance(QueryStatementImportsDto, {
      page: "1",
      limit: "101",
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("uses a dedicated ten-megabyte, single-file upload limit", () => {
    const options = buildStatementUploadOptions();

    expect(options.limits).toMatchObject({
      fileSize: DEFAULT_MAX_STATEMENT_FILE_SIZE,
      files: 1,
    });
  });
});
