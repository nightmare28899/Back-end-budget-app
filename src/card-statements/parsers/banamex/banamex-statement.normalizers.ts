import type { ExtractedStatementText } from "../statement-parser.interface";

const DATE_PATTERN = "\\d{2}/\\d{2}/(?:\\d{2}|\\d{4})";
const MONEY_PATTERN = "\\(?-?\\$?\\s*[\\d,]+\\.\\d{2}\\)?";

export const BANAMEX_TRANSACTION_PATTERN = new RegExp(
  `^(${DATE_PATTERN})\\s+(?:(${DATE_PATTERN})\\s+)?(.+?)\\s+(${MONEY_PATTERN})$`,
);
export const BANAMEX_MONEY_AT_END_PATTERN = new RegExp(`(${MONEY_PATTERN})$`);

export interface BanamexSourceLine {
  page: number;
  line: number;
  text: string;
  fold: string;
}

export function toBanamexSourceLines(
  input: ExtractedStatementText,
): BanamexSourceLine[] {
  const pages =
    input.pages.length > 0 ? input.pages : [{ number: 1, text: input.text }];

  return pages.flatMap((page) =>
    page.text
      .split(/\r?\n/)
      .map((text, index) => ({
        page: page.number,
        line: index + 1,
        text: text.trim().replace(/\s+/g, " "),
        fold: foldStatementText(text),
      }))
      .filter((line) => line.text.length > 0),
  );
}

export function foldStatementText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStatementDate(value: string) {
  const [dayRaw, monthRaw, yearRaw] = value.split("/");
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const shortYear = Number(yearRaw);
  const year = yearRaw.length === 2 ? 2000 + shortYear : shortYear;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseStatementMoney(value: string) {
  const negative = value.includes("-") || /^\s*\(/.test(value);
  const normalized = value.replace(/[$,()\s-]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return negative ? -parsed : parsed;
}

export function extractTrailingMoney(value: string) {
  const match = value.match(BANAMEX_MONEY_AT_END_PATTERN);
  return match ? parseStatementMoney(match[1]) : null;
}

export function normalizeStatementMerchant(description: string) {
  return description
    .replace(/\b\d{1,2}\s*(?:DE|\/)\s*\d{1,2}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function roundStatementMoney(value: number) {
  return Math.round(value * 100) / 100;
}
