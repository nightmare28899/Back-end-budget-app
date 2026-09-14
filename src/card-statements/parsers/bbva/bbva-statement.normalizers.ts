import type { ExtractedStatementText } from "../statement-parser.interface";

const MONTHS: Record<string, number> = {
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

export const BBVA_DATE_PATTERN = "\\d{2}-[A-Z]{3}-\\d{4}";
const BBVA_MONEY_PATTERN = "[+-]?\\s*\\$?\\s*[\\d,]+\\.\\d{2}";

export const BBVA_TRANSACTION_PATTERN = new RegExp(
  `^(${BBVA_DATE_PATTERN})\\s+(${BBVA_DATE_PATTERN})\\s+(.+?)\\s+([+-]\\s*\\$?\\s*[\\d,]+\\.\\d{2})$`,
  "i",
);

export const BBVA_FINANCING_PLAN_PATTERN = new RegExp(
  `^(${BBVA_DATE_PATTERN})\\s+(.+?)\\s+(${BBVA_MONEY_PATTERN})\\s+(${BBVA_MONEY_PATTERN})\\s+(${BBVA_MONEY_PATTERN})\\s+(\\d{1,2})\\s+DE\\s+(\\d{1,2})\\s+[\\d.]+%$`,
  "i",
);

const BBVA_MONEY_AT_END_PATTERN = new RegExp(`(${BBVA_MONEY_PATTERN})$`, "i");

export interface BbvaSourceLine {
  page: number;
  line: number;
  text: string;
  fold: string;
}

export function foldBbvaText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function toBbvaSourceLines(
  input: ExtractedStatementText,
): BbvaSourceLine[] {
  const pages =
    input.pages.length > 0 ? input.pages : [{ number: 1, text: input.text }];

  return pages.flatMap((page) =>
    page.text
      .split(/\r?\n/)
      .map((text, index) => ({
        page: page.number,
        line: index + 1,
        text: text.trim().replace(/\s+/g, " "),
        fold: foldBbvaText(text),
      }))
      .filter((line) => line.text.length > 0),
  );
}

export function parseBbvaDate(value: string) {
  const match = value.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = MONTHS[match[2].toUpperCase()];
  const year = Number(match[3]);
  if (!month) {
    return null;
  }

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

export function parseBbvaMoney(value: string) {
  if (!new RegExp(`^${BBVA_MONEY_PATTERN}$`, "i").test(value.trim())) {
    return null;
  }

  const negative = value.trim().startsWith("-");
  const amount = Number(value.replace(/[+$,\s-]/g, ""));
  if (!Number.isFinite(amount)) {
    return null;
  }
  return negative ? -amount : amount;
}

export function extractBbvaTrailingMoney(value: string) {
  const match = value.match(BBVA_MONEY_AT_END_PATTERN);
  return match ? parseBbvaMoney(match[1]) : null;
}

export function normalizeBbvaMerchant(value: string) {
  return value
    .replace(/\s*;\s*TARJETA (?:DIGITAL|TITULAR).*$/i, "")
    .replace(/^\d{1,2}\s+DE\s+\d{1,2}\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function roundBbvaMoney(value: number) {
  return Math.round(value * 100) / 100;
}
