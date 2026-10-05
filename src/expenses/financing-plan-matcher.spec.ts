import {
  FinancingPlanCandidate,
  MatchableExpense,
  findBestFinancingPlan,
  merchantsMatch,
  normalizeMerchant,
} from "./financing-plan-matcher";

const plan = (
  overrides: Partial<FinancingPlanCandidate> = {},
): FinancingPlanCandidate => ({
  type: "NO_INTEREST",
  merchantName: "AMAZON A MESES",
  purchaseDate: new Date("2026-03-09T00:00:00.000Z"),
  originalAmount: 12999,
  installmentAmount: 1083.25,
  installmentNumber: 7,
  installmentCount: 12,
  remainingAmount: null,
  creditCardId: "card-1",
  statementPeriodEnd: new Date("2026-09-30T00:00:00.000Z"),
  statementCreatedAt: new Date("2026-10-01T00:00:00.000Z"),
  ...overrides,
});

const expense = (
  overrides: Partial<MatchableExpense> = {},
): MatchableExpense => ({
  cost: "12999.00",
  date: new Date("2026-03-10T12:00:00.000Z"),
  paymentMethod: "CREDIT_CARD",
  creditCardId: "card-1",
  merchantName: "Amazon",
  title: "Compra",
  ...overrides,
});

describe("financing plan matcher", () => {
  it("normalizes accents, punctuation and card-processor prefixes", () => {
    expect(normalizeMerchant("MERPAGO*MercadoLibre")).toBe("MERCADOLIBRE");
    expect(normalizeMerchant("  Cént.  de  Serv-LTH ")).toBe(
      "CENT DE SERV LTH",
    );
    expect(normalizeMerchant("MERCADOPAGO*Tienda")).toBe("TIENDA");
  });

  it("matches merchants by shared token or containment", () => {
    expect(merchantsMatch("MERPAGO*MERCADOLIBRE", ["Mercadolibre MX"])).toBe(
      true,
    );
    expect(merchantsMatch("AMAZON A MESES", ["Amazon"])).toBe(true);
    expect(merchantsMatch("AMAZON A MESES", ["Liverpool"])).toBe(false);
    expect(merchantsMatch("AMAZON A MESES", ["Spotify A MESES"])).toBe(false);
  });

  it("matches within the 0.01 amount tolerance only", () => {
    expect(
      findBestFinancingPlan(expense({ cost: "12999.01" }), [plan()]),
    ).not.toBeNull();
    expect(
      findBestFinancingPlan(expense({ cost: "12999.02" }), [plan()]),
    ).toBeNull();
  });

  it("matches purchase dates within 3 days and rejects beyond", () => {
    const near = expense({ date: new Date("2026-03-12T23:00:00.000Z") });
    const far = expense({ date: new Date("2026-03-13T01:00:00.000Z") });
    expect(findBestFinancingPlan(near, [plan()])).not.toBeNull();
    expect(findBestFinancingPlan(far, [plan()])).toBeNull();
  });

  it("returns the public shape with date-only purchaseDate", () => {
    expect(findBestFinancingPlan(expense(), [plan()])).toEqual({
      type: "NO_INTEREST",
      installmentNumber: 7,
      installmentCount: 12,
      installmentAmount: 1083.25,
      originalAmount: 12999,
      remainingAmount: null,
      purchaseDate: "2026-03-09",
    });
  });

  it("rejects a plan from a different credit card but allows unknown cards", () => {
    expect(
      findBestFinancingPlan(expense({ creditCardId: "card-2" }), [plan()]),
    ).toBeNull();
    expect(
      findBestFinancingPlan(expense({ creditCardId: null }), [plan()]),
    ).not.toBeNull();
    expect(
      findBestFinancingPlan(expense(), [plan({ creditCardId: null })]),
    ).not.toBeNull();
  });

  it("ignores non credit-card expenses", () => {
    expect(
      findBestFinancingPlan(expense({ paymentMethod: "CASH" }), [plan()]),
    ).toBeNull();
  });

  it("prefers highest installmentNumber, then latest statement", () => {
    const result = findBestFinancingPlan(expense(), [
      plan({ installmentNumber: 5 }),
      plan({ installmentNumber: 7 }),
      plan({ installmentNumber: 6 }),
    ]);
    expect(result?.installmentNumber).toBe(7);

    const tie = findBestFinancingPlan(expense(), [
      plan({
        installmentAmount: 1,
        statementPeriodEnd: new Date("2026-08-31T00:00:00.000Z"),
      }),
      plan({ installmentAmount: 2 }),
    ]);
    expect(tie?.installmentAmount).toBe(2);
  });

  it("handles null originalAmount by requiring date and merchant", () => {
    const nullAmount = plan({ originalAmount: null });
    expect(
      findBestFinancingPlan(expense({ cost: "1" }), [nullAmount]),
    ).not.toBeNull();
    expect(
      findBestFinancingPlan(
        expense({ cost: "1", merchantName: "Liverpool", title: "Ropa" }),
        [nullAmount],
      ),
    ).toBeNull();
    expect(
      findBestFinancingPlan(expense(), [
        plan({ originalAmount: null, purchaseDate: null }),
      ]),
    ).toBeNull();
  });

  it("requires amount and merchant when purchaseDate is null", () => {
    const undated = plan({ purchaseDate: null });
    expect(findBestFinancingPlan(expense(), [undated])).not.toBeNull();
    expect(
      findBestFinancingPlan(expense({ merchantName: "Uber", title: "Uber" }), [
        undated,
      ]),
    ).toBeNull();
    expect(findBestFinancingPlan(expense({ cost: "5" }), [undated])).toBeNull();
  });
});
