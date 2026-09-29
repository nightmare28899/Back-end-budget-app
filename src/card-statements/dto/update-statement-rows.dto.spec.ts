import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateStatementRowDto } from "./update-statement-rows.dto";

describe("UpdateStatementRowDto", () => {
  it("accepts an amount with at most two decimal places", async () => {
    const dto = plainToInstance(UpdateStatementRowDto, {
      id: "5fc03087-d265-11e7-b8c6-83e29cd24f4c",
      amount: 100.01,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("rejects an amount with more than two decimal places", async () => {
    const dto = plainToInstance(UpdateStatementRowDto, {
      id: "5fc03087-d265-11e7-b8c6-83e29cd24f4c",
      amount: 100.001,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
