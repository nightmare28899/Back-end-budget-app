import {
  buildInstallmentSchedule,
  splitAmountAcrossInstallments,
} from "./expense-installments.util";

describe("expense-installments.util", () => {
  it("splits an evenly divisible total into equal monthly installments", () => {
    expect(splitAmountAcrossInstallments(1200, 4)).toEqual([
      300, 300, 300, 300,
    ]);
  });

  it("applies the rounding remainder to the final installment", () => {
    expect(splitAmountAcrossInstallments(1000, 3)).toEqual([
      333.33, 333.33, 333.34,
    ]);
  });

  it("builds a monthly schedule and clamps end-of-month dates safely", () => {
    const schedule = buildInstallmentSchedule({
      totalAmount: 1200,
      installmentCount: 4,
      firstPaymentDate: new Date("2026-01-31T12:00:00.000Z"),
    });

    expect(schedule).toHaveLength(4);
    expect(schedule[0]).toMatchObject({
      installmentIndex: 1,
      amount: 300,
    });
    expect(schedule[1].paymentDate.toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    expect(schedule[3].paymentDate.toISOString()).toBe(
      "2026-04-30T12:00:00.000Z",
    );
  });
});
