import {
  parseRappiCardDate,
  parseRappiCardMoney,
} from "./rappicard-statement.normalizers";

describe("RappiCard statement normalizers", () => {
  describe("parseRappiCardDate", () => {
    it.each([
      ["01-ENE-2026", "2026-01-01T12:00:00.000Z"],
      ["29-feb-2024", "2024-02-29T12:00:00.000Z"],
      ["31-DIC-2026", "2026-12-31T12:00:00.000Z"],
      // Real transaction rows print plain numeric YYYY-MM-DD dates, distinct
      // from the DD-MMM-YYYY header/period format above — both must parse.
      ["2026-01-01", "2026-01-01T12:00:00.000Z"],
      ["2026-12-31", "2026-12-31T12:00:00.000Z"],
    ])("accepts %s", (value, expected) => {
      expect(parseRappiCardDate(value)?.toISOString()).toBe(expected);
    });

    it.each([
      "31-ABR-2026",
      "29-FEB-2025",
      "1-ENE-2026",
      "01-XYZ-2026",
      "2026-13-01",
      "2026-02-30",
    ])("rejects impossible or malformed date %s", (value) => {
      expect(parseRappiCardDate(value)).toBeNull();
    });
  });

  describe("parseRappiCardMoney", () => {
    it.each([
      ["+$1,234.56 MXN", 1234.56],
      ["-$ 500.00 MXN", -500],
      ["$0.00 MXN", 0],
      ["+125.40 MXN", 125.4],
      // Real transaction/summary lines never print the "MXN" suffix at all.
      ["+$1,250.00", 1250],
      ["-$1,000.00", -1000],
    ])("accepts %s", (value, expected) => {
      expect(parseRappiCardMoney(value)).toBe(expected);
    });

    it.each([
      "$1,234 MXN",
      "$12.345 MXN",
      "MXN 50.00",
      "$NaN MXN",
      "",
      "$10.00 USD",
    ])("rejects invalid amount %s", (value) => {
      expect(parseRappiCardMoney(value)).toBeNull();
    });
  });
});
