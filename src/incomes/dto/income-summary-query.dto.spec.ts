import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { IncomeSummaryQueryDto } from "./income-summary-query.dto";

describe("IncomeSummaryQueryDto", () => {
  it("accepts an empty query (legacy clients)", async () => {
    const dto = plainToInstance(IncomeSummaryQueryDto, {});
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.currency).toBeUndefined();
  });

  it("normalizes currency to uppercase", async () => {
    const dto = plainToInstance(IncomeSummaryQueryDto, { currency: " usd " });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.currency).toBe("USD");
  });

  it.each([
    { currency: "US" },
    { currency: "USDX" },
    { currency: "12$" },
    { currency: "" },
  ])("rejects %j", async (input) => {
    const dto = plainToInstance(IncomeSummaryQueryDto, input);
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
