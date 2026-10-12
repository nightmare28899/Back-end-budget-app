import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { QueryIncomeDto } from "./query-income.dto";

describe("QueryIncomeDto", () => {
  it("accepts an empty query (legacy clients)", async () => {
    const dto = plainToInstance(QueryIncomeDto, {});
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("coerces page and limit from strings", async () => {
    const dto = plainToInstance(QueryIncomeDto, { page: "2", limit: "50" });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it.each([
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "abc" },
    { limit: "0" },
    { limit: "101" },
  ])("rejects %j", async (input) => {
    const dto = plainToInstance(QueryIncomeDto, input);
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
