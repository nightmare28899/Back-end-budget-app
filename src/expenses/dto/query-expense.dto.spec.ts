import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  ExpensePaymentStatus,
  QueryExpenseDto,
} from "./query-expense.dto";

describe("QueryExpenseDto", () => {
  it.each([
    ExpensePaymentStatus.PAID,
    ExpensePaymentStatus.PARTIAL,
    ExpensePaymentStatus.UNPAID,
  ])(
    "accepts %s as a payment status",
    async (paymentStatus) => {
      const dto = plainToInstance(QueryExpenseDto, { paymentStatus });

      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it.each(["INVALID", "paid", "unpaid"])(
    "rejects %s as a payment status",
    async (paymentStatus) => {
      const dto = plainToInstance(QueryExpenseDto, { paymentStatus });

      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it("accepts a UUID creditCardId", async () => {
    const dto = plainToInstance(QueryExpenseDto, {
      creditCardId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("rejects a non-UUID creditCardId", async () => {
    const dto = plainToInstance(QueryExpenseDto, { creditCardId: "not-a-uuid" });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
