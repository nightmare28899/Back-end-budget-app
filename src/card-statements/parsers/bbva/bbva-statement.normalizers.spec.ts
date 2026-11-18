import {
  normalizeBbvaMerchant,
  parseBbvaDate,
  parseBbvaMoney,
} from "./bbva-statement.normalizers";

describe("BBVA statement normalizers", () => {
  it.each([
    ["01-ene-2026", "2026-01-01T12:00:00.000Z"],
    ["29-FEB-2024", "2024-02-29T12:00:00.000Z"],
    ["31-dic-2026", "2026-12-31T12:00:00.000Z"],
  ])("parses valid BBVA date %s", (value, expected) => {
    expect(parseBbvaDate(value)?.toISOString()).toBe(expected);
  });

  it.each(["31-abr-2026", "29-feb-2025", "01-xyz-2026", "2026-08-14"])(
    "rejects invalid BBVA date %s",
    (value) => {
      expect(parseBbvaDate(value)).toBeNull();
    },
  );

  it.each([
    ["+ $1,234.56", 1234.56],
    ["-$4,582.06", -4582.06],
    ["$0.00", 0],
  ])("parses BBVA amount %s", (value, expected) => {
    expect(parseBbvaMoney(value)).toBe(expected);
  });

  it("removes installment and instrument metadata from merchant names", () => {
    expect(
      normalizeBbvaMerchant("15 DE 18 MERCADO PAGO ; Tarjeta Digital ***7931"),
    ).toBe("MERCADO PAGO");
  });
});
