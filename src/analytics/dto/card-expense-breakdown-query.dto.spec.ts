import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CardExpenseBreakdownQueryDto } from "./card-expense-breakdown-query.dto";

describe("CardExpenseBreakdownQueryDto", () => {
  it("accepts a required inclusive ISO date-only range", async () => {
    const dto = plainToInstance(CardExpenseBreakdownQueryDto, {
      from: "2026-04-01",
      to: "2026-04-30",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [{ from: "2026-04-01" }],
    [{ from: "2026-04-01T00:00:00.000Z", to: "2026-04-30" }],
    [{ from: "2026-02-30", to: "2026-03-01" }],
    [{ from: "2026-04-30", to: "2026-04-01" }],
  ])("rejects an invalid range: %o", async (input) => {
    const dto = plainToInstance(CardExpenseBreakdownQueryDto, input);

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
