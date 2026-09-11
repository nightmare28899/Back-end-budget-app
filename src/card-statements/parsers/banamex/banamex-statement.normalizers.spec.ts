import { parseStatementDate } from "./banamex-statement.normalizers";

describe("parseStatementDate", () => {
  it("parses DD/MM/YYYY", () => {
    expect(parseStatementDate("31/08/2026")?.toISOString()).toBe(
      "2026-08-31T12:00:00.000Z",
    );
  });

  it("parses DD/MM/YY, expanding the year to 20YY", () => {
    expect(parseStatementDate("31/08/26")?.toISOString()).toBe(
      "2026-08-31T12:00:00.000Z",
    );
  });

  it("parses DD-MMM-YYYY with a Spanish month abbreviation", () => {
    expect(parseStatementDate("22-jul-2026")?.toISOString()).toBe(
      "2026-07-22T12:00:00.000Z",
    );
    expect(parseStatementDate("10-SEP-2026")?.toISOString()).toBe(
      "2026-09-10T12:00:00.000Z",
    );
  });

  it("rejects an unknown month abbreviation", () => {
    expect(parseStatementDate("10-XYZ-2026")).toBeNull();
  });

  it("rejects a calendar-invalid date", () => {
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("31-FEB-2026")).toBeNull();
  });

  it("rejects an unrecognized format", () => {
    expect(parseStatementDate("2026-08-31")).toBeNull();
    expect(parseStatementDate("not a date")).toBeNull();
  });
});
