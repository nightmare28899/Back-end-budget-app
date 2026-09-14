import type { ExtractedStatementText } from "../statement-parser.interface";

// The header/period lines print DD-MMM-YYYY ("16-jul-2026"), but the actual
// transaction rows in the real Banorte-issued RappiCard template print plain
// numeric YYYY-MM-DD dates instead ("2026-07-18") — accept both wherever a
// date can appear so either layout parses correctly.
const RAPPICARD_ALPHA_DATE_PATTERN = "\\d{2}-[A-Z]{3}-\\d{4}";
const RAPPICARD_NUMERIC_DATE_PATTERN = "\\d{4}-\\d{2}-\\d{2}";
export const RAPPICARD_DATE_PATTERN = `(?:${RAPPICARD_ALPHA_DATE_PATTERN}|${RAPPICARD_NUMERIC_DATE_PATTERN})`;
// Real statement amounts print as "+$1,250.00"/"-$1,000.00" with no currency
// suffix — the " MXN" suffix assumed by the original implementation never
// appears on any real transaction, summary, or payment-target line, so it
// must be optional rather than required.
const RAPPICARD_MONEY_PATTERN = "[+-]?\\s*\\$?\\s*[\\d,]+\\.\\d{2}(?:\\s*MXN)?";

export const RAPPICARD_TRANSACTION_PATTERN = new RegExp(
  `^(${RAPPICARD_DATE_PATTERN})\\s+(${RAPPICARD_DATE_PATTERN})\\s+(.+?)\\s+(${RAPPICARD_MONEY_PATTERN})$`,
  "i",
);

const RAPPICARD_MONEY_AT_END_PATTERN = new RegExp(
  `(${RAPPICARD_MONEY_PATTERN})$`,
  "i",
);

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

export interface RappiCardSourceLine {
  page: number;
  line: number;
  text: string;
  fold: string;
}

export function foldRappiCardText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function toRappiCardSourceLines(
  input: ExtractedStatementText,
): RappiCardSourceLine[] {
  const pages =
    input.pages.length > 0 ? input.pages : [{ number: 1, text: input.text }];

  return pages.flatMap((page) =>
    page.text
      .split(/\r?\n/)
      .map((text, index) => ({
        page: page.number,
        line: index + 1,
        text: text.trim().replace(/\s+/g, " "),
        fold: foldRappiCardText(text),
      }))
      .filter((line) => line.text.length > 0),
  );
}

export function parseRappiCardDate(value: string) {
  const trimmed = value.trim();

  const alpha = trimmed.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (alpha) {
    const day = Number(alpha[1]);
    const month = MONTHS[alpha[2].toUpperCase()];
    const year = Number(alpha[3]);
    if (!month) {
      return null;
    }
    return buildValidatedRappiCardDate(year, month, day);
  }

  const numeric = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (numeric) {
    const year = Number(numeric[1]);
    const month = Number(numeric[2]);
    const day = Number(numeric[3]);
    return buildValidatedRappiCardDate(year, month, day);
  }

  return null;
}

function buildValidatedRappiCardDate(year: number, month: number, day: number) {
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

export function parseRappiCardMoney(value: string) {
  if (!new RegExp(`^${RAPPICARD_MONEY_PATTERN}$`, "i").test(value.trim())) {
    return null;
  }

  const negative = value.trim().startsWith("-");
  const normalized = value.replace(/[+$,\s-]|MXN/gi, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    return null;
  }
  return negative ? -amount : amount;
}

export function extractRappiCardTrailingMoney(value: string) {
  const match = value.match(RAPPICARD_MONEY_AT_END_PATTERN);
  return match ? parseRappiCardMoney(match[1]) : null;
}

export function normalizeRappiCardMerchant(value: string) {
  return value
    .replace(/\b\d{1,2}\s+DE\s+\d{1,2}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function roundRappiCardMoney(value: number) {
  return Math.round(value * 100) / 100;
}
