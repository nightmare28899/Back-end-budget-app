import { StatementRowDecision, StatementRowKind } from "@prisma/client";
import {
  matchStatementRowsToExpenses,
  MATCHES_REGISTERED_EXPENSE_CODE,
  type MatchableExpense,
  type MatchableStatementRow,
} from "./statement-expense-matcher";

describe("matchStatementRowsToExpenses", () => {
  const period = {
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
  };

  function row(
    key: string,
    overrides: Partial<MatchableStatementRow> = {},
  ): MatchableStatementRow {
    return {
      key,
      kind: StatementRowKind.CHARGE,
      decision: StatementRowDecision.PENDING,
      transactionDate: new Date("2026-08-10T12:00:00.000Z"),
      description: "UBER EATS MEXICO",
      merchantName: null,
      amount: 120.5,
      currency: "MXN",
      ...overrides,
    };
  }

  function expense(
    id: string,
    overrides: Partial<MatchableExpense> = {},
  ): MatchableExpense {
    return {
      id,
      title: "Uber Eats",
      merchantName: null,
      cost: 120.5,
      currency: "MXN",
      date: new Date("2026-08-10T18:00:00.000Z"),
      isInstallment: false,
      ...overrides,
    };
  }

  const run = (rows: MatchableStatementRow[], expenses: MatchableExpense[]) =>
    matchStatementRowsToExpenses({ rows, expenses, ...period });

  it("exports the warning code", () => {
    expect(MATCHES_REGISTERED_EXPENSE_CODE).toBe("MATCHES_REGISTERED_EXPENSE");
  });

  it("matches a regular expense with the same amount and date", () => {
    expect(run([row("r1")], [expense("e1")])).toEqual(new Map([["r1", "e1"]]));
  });

  it("compares amounts to the cent, tolerating float noise", () => {
    expect(
      run([row("r1", { amount: 0.1 + 0.2 })], [expense("e1", { cost: 0.3 })]),
    ).toEqual(new Map([["r1", "e1"]]));
    expect(run([row("r1")], [expense("e1", { cost: 120.51 })]).size).toBe(0);
  });

  it("accepts up to 3 days of date distance and rejects 4", () => {
    const within = expense("e1", {
      date: new Date("2026-08-13T01:00:00.000Z"),
    });
    const outside = expense("e2", {
      date: new Date("2026-08-14T01:00:00.000Z"),
    });
    expect(run([row("r1")], [within]).get("r1")).toBe("e1");
    expect(run([row("r1")], [outside]).size).toBe(0);
  });

  it("requires the same currency", () => {
    expect(run([row("r1")], [expense("e1", { currency: "USD" })]).size).toBe(0);
  });

  it("prefers the closest date", () => {
    const far = expense("e1", { date: new Date("2026-08-12T12:00:00.000Z") });
    const near = expense("e2", { date: new Date("2026-08-10T12:00:00.000Z") });
    expect(run([row("r1")], [far, near]).get("r1")).toBe("e2");
  });

  it("breaks date ties by merchant similarity", () => {
    const other = expense("e1", { title: "Netflix" });
    const similar = expense("e2", { title: "Uber Eats" });
    expect(run([row("r1")], [other, similar]).get("r1")).toBe("e2");
  });

  it("breaks remaining ties by expense id for determinism", () => {
    const a = expense("e-b", { title: "Uber Eats" });
    const b = expense("e-a", { title: "Uber Eats" });
    expect(run([row("r1")], [a, b]).get("r1")).toBe("e-a");
  });

  it("matches each expense at most once", () => {
    const result = run([row("r1"), row("r2")], [expense("e1")]);
    expect(result.size).toBe(1);
    expect(result.get("r1")).toBe("e1");
  });

  it("gives each of two identical rows its own expense", () => {
    const result = run([row("r1"), row("r2")], [expense("e1"), expense("e2")]);
    expect(new Set(result.values())).toEqual(new Set(["e1", "e2"]));
  });

  it("matches an installment expense anywhere inside the statement period", () => {
    const installment = expense("e1", {
      isInstallment: true,
      title: "Laptop 3/12",
      date: new Date("2026-08-31T15:00:00.000Z"),
    });
    expect(
      run([row("r1", { description: "LAPTOP MSI" })], [installment]),
    ).toEqual(new Map([["r1", "e1"]]));
  });

  it("rejects an installment expense outside the statement period", () => {
    const early = expense("e1", {
      isInstallment: true,
      date: new Date("2026-07-31T23:00:00.000Z"),
    });
    const late = expense("e2", {
      isInstallment: true,
      date: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(run([row("r1")], [early, late]).size).toBe(0);
  });

  it("includes the whole last day of the period", () => {
    const lastDay = expense("e1", {
      isInstallment: true,
      date: new Date("2026-08-31T23:59:00.000Z"),
    });
    expect(run([row("r1")], [lastDay]).get("r1")).toBe("e1");
  });

  it("does not apply the 3-day window to a regular expense outside it even inside the period", () => {
    const e = expense("e1", { date: new Date("2026-08-25T12:00:00.000Z") });
    expect(run([row("r1")], [e]).size).toBe(0);
  });

  it("prefers a regular match over an installment match for the same row", () => {
    const installment = expense("e1", {
      isInstallment: true,
      date: new Date("2026-08-10T12:00:00.000Z"),
    });
    const regular = expense("e2", {
      date: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(run([row("r1")], [installment, regular]).get("r1")).toBe("e2");
  });

  it("skips rows that are not plain pending or include charges", () => {
    const e = [expense("e1")];
    expect(run([row("r1", { kind: StatementRowKind.TAX })], e).size).toBe(0);
    expect(run([row("r1", { kind: StatementRowKind.PAYMENT })], e).size).toBe(
      0,
    );
    expect(
      run([row("r1", { decision: StatementRowDecision.INFO_ONLY })], e).size,
    ).toBe(0);
    expect(
      run([row("r1", { decision: StatementRowDecision.EXCLUDE })], e).size,
    ).toBe(0);
    expect(
      run([row("r1", { decision: StatementRowDecision.INCLUDE_EXPENSE })], e)
        .size,
    ).toBe(1);
  });

  it("skips rows without a transaction date", () => {
    expect(
      run([row("r1", { transactionDate: null })], [expense("e1")]).size,
    ).toBe(0);
  });
});
