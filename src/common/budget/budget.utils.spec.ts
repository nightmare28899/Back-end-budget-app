import {
  formatDateOnly,
  normalizeBudgetPeriod,
  resolveBudgetWindow,
} from "./budget.utils";

describe("budget.utils", () => {
  const now = new Date("2026-03-03T10:30:00.000Z");

  it("normalizes unsupported period to daily", () => {
    expect(normalizeBudgetPeriod("invalid-value")).toBe("daily");
  });

  it("resolves a daily budget window", () => {
    const window = resolveBudgetWindow(
      { budgetAmount: 100, budgetPeriod: "daily" },
      now,
    );

    expect(window.period).toBe("daily");
    expect(window.amount).toBe(100);
    expect(formatDateOnly(window.start)).toBe("2026-03-03");
    expect(formatDateOnly(window.end)).toBe("2026-03-03");
    expect(window.totalDays).toBe(1);
  });

  it("resolves a weekly budget window from monday to sunday", () => {
    const window = resolveBudgetWindow(
      { budgetAmount: 700, budgetPeriod: "weekly" },
      now,
    );

    expect(window.period).toBe("weekly");
    expect(formatDateOnly(window.start)).toBe("2026-03-02");
    expect(formatDateOnly(window.end)).toBe("2026-03-08");
    expect(window.totalDays).toBe(7);
  });

  it("resolves a monthly budget window", () => {
    const window = resolveBudgetWindow(
      { budgetAmount: 3000, budgetPeriod: "monthly" },
      now,
    );

    expect(window.period).toBe("monthly");
    expect(formatDateOnly(window.start)).toBe("2026-03-01");
    expect(formatDateOnly(window.end)).toBe("2026-03-31");
    expect(window.totalDays).toBe(31);
  });

  it("resolves an annual budget window", () => {
    const window = resolveBudgetWindow(
      { budgetAmount: 36000, budgetPeriod: "annual" },
      now,
    );

    expect(window.period).toBe("annual");
    expect(formatDateOnly(window.start)).toBe("2026-01-01");
    expect(formatDateOnly(window.end)).toBe("2026-12-31");
    expect(window.totalDays).toBe(365);
  });

  it("resolves a custom period budget window", () => {
    const window = resolveBudgetWindow(
      {
        budgetAmount: 1200,
        budgetPeriod: "period",
        budgetPeriodStart: "2026-03-01",
        budgetPeriodEnd: "2026-03-15",
      },
      now,
    );

    expect(window.period).toBe("period");
    expect(formatDateOnly(window.start)).toBe("2026-03-01");
    expect(formatDateOnly(window.end)).toBe("2026-03-15");
    expect(window.totalDays).toBe(15);
  });
});
