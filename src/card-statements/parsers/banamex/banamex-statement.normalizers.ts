import type { ExtractedStatementText } from "../statement-parser.interface";

// Most Banamex statements print DD/MM/YYYY, but the Costco co-branded
// template (a distinct layout, not just a different card design) uses
// DD-MMM-YYYY with a Spanish three-letter month abbreviation instead —
// e.g. "22-jul-2026" rather than "22/07/2026". Accept either everywhere a
// statement date can appear.
// \d{2,4} (a quantifier, greedy) tries 4 digits before falling back to 2 —
// unlike an alternation `(?:\d{2}|\d{4})`, which tries the first branch and
// accepts it as soon as the rest of a larger pattern can still match,
// silently truncating a 4-digit year to 2 digits.
const NUMERIC_DATE_PATTERN = "\\d{2}/\\d{2}/\\d{2,4}";
const ABBREVIATED_DATE_PATTERN = "\\d{2}-[A-Z]{3}-\\d{4}";
export const DATE_PATTERN = `(?:${NUMERIC_DATE_PATTERN}|${ABBREVIATED_DATE_PATTERN})`;
const MONEY_PATTERN = "\\(?-?\\$?\\s*[\\d,]+\\.\\d{2}\\)?";

const SPANISH_MONTH_ABBREVIATIONS: Record<string, number> = {
  ENE: 1,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  SEP: 9,
  SET: 9,
  OCT: 10,
  NOV: 11,
  DIC: 12,
};

export const BANAMEX_TRANSACTION_PATTERN = new RegExp(
  `^(${DATE_PATTERN})\\s+(?:(${DATE_PATTERN})\\s+)?(.+?)\\s+(${MONEY_PATTERN})$`,
  "i",
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

function buildValidatedStatementDate(year: number, month: number, day: number) {
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

export function parseStatementDate(value: string) {
  const numeric = value.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const yearRaw = numeric[3];
    const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    return buildValidatedStatementDate(year, month, day);
  }

  const abbreviated = value.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (abbreviated) {
    const day = Number(abbreviated[1]);
    const month = SPANISH_MONTH_ABBREVIATIONS[abbreviated[2].toUpperCase()];
    if (!month) return null;
    return buildValidatedStatementDate(Number(abbreviated[3]), month, day);
  }

  return null;
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
