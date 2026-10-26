import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ReorderCreditCardsDto } from "./reorder-credit-cards.dto";

const errorsFor = (ids: unknown) =>
  validate(plainToInstance(ReorderCreditCardsDto, { ids }));

describe("ReorderCreditCardsDto", () => {
  it("accepts a unique list of non-empty strings", async () => {
    expect(await errorsFor(["a", "b"])).toHaveLength(0);
  });

  it.each([
    ["empty array", []],
    ["duplicates", ["a", "a"]],
    ["empty string", ["a", ""]],
    ["non-string", ["a", 1]],
    ["more than 200", Array.from({ length: 201 }, (_, i) => `id-${i}`)],
    ["not an array", "a"],
  ])("rejects %s", async (_label, ids) => {
    expect(await errorsFor(ids)).not.toHaveLength(0);
  });
});
