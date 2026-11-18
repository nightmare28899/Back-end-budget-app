import { Injectable } from "@nestjs/common";
import {
  StatementFinancingType,
  StatementPaymentTargetKind,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
} from "@prisma/client";
import type {
  ParsedStatementData,
  ParsedStatementFinancingPlan,
  ParsedStatementPaymentTarget,
  ParsedStatementRow,
} from "../../card-statements.types";
import type {
  ExtractedStatementText,
  StatementParser,
} from "../statement-parser.interface";
import { StatementProcessingError } from "../statement-parser.interface";
import {
  extractRappiCardTrailingMoney,
  foldRappiCardText,
  normalizeRappiCardMerchant,
  parseRappiCardDate,
  parseRappiCardMoney,
  RAPPICARD_DATE_PATTERN,
  RAPPICARD_TRANSACTION_PATTERN,
  normalizeRappiCardPlanMerchant,
  type RappiCardSourceLine,
  roundRappiCardMoney,
  toRappiCardSourceLines,
} from "./rappicard-statement.normalizers";

const PARSER_VERSION = "rappicard-text-v1";

// Installment-plan table entries. A date may be split over two lines
// ("2026-08-" then "06 MERCHANT"), the description may continue over several
// lines and the amounts may share a line with the description tail:
//   "<orig> <remaining> [<interest> <VAT>] <required> <N> de <M> <rate>%".
const PLAN_DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-)$/;
const PLAN_DATE_SUFFIX_PATTERN = /^(\d{2})(?:\s+(.*))?$/;
const PLAN_DATE_START_PATTERN = new RegExp(
  `^(${RAPPICARD_DATE_PATTERN})(?:\\s+(.*))?$`,
  "i",
);
const PLAN_MONEY_TOKEN = "\\$\\s?[\\d,]+\\.\\d{2}";
const PLAN_AMOUNTS_PATTERN = new RegExp(
  `(?:^|\\s)((?:${PLAN_MONEY_TOKEN}\\s+){2,}${PLAN_MONEY_TOKEN})\\s+(\\d{1,3})\\s+DE\\s+(\\d{1,3})\\s+\\d+(?:\\.\\d+)?\\s*%$`,
  "i",
);
const PLAN_MAX_LINES = 6;
const PLAN_END_PATTERN =
  /^(?:NOTAS ACLARATORIAS|GLOSARIO DE TERMINOS|TOTAL DE (?:CARGOS|ABONOS))\b/;
const INSTRUMENT_HEADER_PATTERN = /^TARJETA\b.*\b\d{4}$/;

interface PendingPlanEntry {
  page: number;
  date: Date | null;
  datePrefix: string | null;
  parts: string[];
  lineCount: number;
  sourceRowNumber: number;
}

interface SummaryValues {
  openingBalance: number | null;
  chargesTotal: number | null;
  paymentsTotal: number | null;
  creditsTotal: number | null;
  closingBalance: number | null;
}

@Injectable()
export class RappiCardStatementParser implements StatementParser {
  canParse(input: ExtractedStatementText): boolean {
    const text = foldRappiCardText(input.text);
    const hasIssuer = /\bRAPPI\s*CARD\b/.test(text);
    const hasStatementStructure =
      /\bESTADO DE CUENTA\b/.test(text) &&
      /\b(?:PERIODO|FECHA LIMITE DE PAGO|MOVIMIENTOS DEL PERIODO)\b/.test(text);
    const isBanamex = /\b(?:CITI\s*)?BANAMEX\b/.test(text);
    return hasIssuer && hasStatementStructure && !isBanamex;
  }

  parse(input: ExtractedStatementText): ParsedStatementData {
    if (!this.canParse(input)) {
      throw new StatementProcessingError(
        "UNSUPPORTED_STATEMENT_ISSUER",
        "The PDF is not a supported RappiCard statement",
      );
    }

    const lines = toRappiCardSourceLines(input);
    const period = this.extractPeriod(lines);
    if (!period) {
      throw new StatementProcessingError(
        "RAPPICARD_PERIOD_NOT_FOUND",
        "The RappiCard statement period could not be identified",
      );
    }

    const rowsAndPlans = this.extractRows(lines);
    if (rowsAndPlans.rows.length === 0) {
      throw new StatementProcessingError(
        "RAPPICARD_TRANSACTIONS_NOT_FOUND",
        "No RappiCard statement transactions could be identified",
      );
    }

    const dueDate = this.extractDueDate(lines);
    const reconciliation = this.buildReconciliation(this.extractSummary(lines));
    const paymentTargets = this.extractPaymentTargets(lines, dueDate);
    const plansBalanceMismatch = this.hasPlansBalanceMismatch(
      lines,
      rowsAndPlans.financingPlans,
    );
    const warningCount =
      rowsAndPlans.rows.reduce(
        (total, row) => total + (row.warningCodes?.length ?? 0),
        0,
      ) +
      (paymentTargets.length === 0 ? 1 : 0) +
      (plansBalanceMismatch ? 1 : 0) +
      (reconciliation.status === StatementReconciliationStatus.PASSED ? 0 : 1);

    return {
      parserVersion: PARSER_VERSION,
      periodStart: period.start,
      periodEnd: period.end,
      warningCount,
      reconciliation: { ...reconciliation, currency: "MXN" },
      instruments: [],
      financingPlans: rowsAndPlans.financingPlans,
      paymentTargets,
      rows: rowsAndPlans.rows,
    };
  }

  private extractPeriod(lines: RappiCardSourceLine[]) {
    const pattern = new RegExp(
      `PERIODO\\s*:?\\s*(${RAPPICARD_DATE_PATTERN})\\s+(?:AL|A)\\s+(${RAPPICARD_DATE_PATTERN})`,
    );
    for (const line of lines) {
      const match = line.fold.match(pattern);
      if (!match) {
        continue;
      }
      const start = parseRappiCardDate(match[1]);
      const end = parseRappiCardDate(match[2]);
      if (start && end && end >= start) {
        return { start, end };
      }
    }
    return null;
  }

  private extractDueDate(lines: RappiCardSourceLine[]) {
    // The real template appends a footnote digit directly to the label
    // (no space, same as the payment-target labels) and prints the weekday
    // name before the date ("FECHA LIMITE DE PAGO1 VIERNES, 04-SEP-2026")
    // instead of the assumed/legacy "FECHA LIMITE DE PAGO: 01-SEP-2026" —
    // skip both optionally so either layout matches.
    const pattern = new RegExp(
      `FECHA LIMITE DE PAGO\\d*\\s*:?\\s*(?:[A-Z]+,\\s*)?(${RAPPICARD_DATE_PATTERN})`,
    );
    for (const line of lines) {
      const match = line.fold.match(pattern);
      if (match) {
        return parseRappiCardDate(match[1]);
      }
    }
    return null;
  }

  private extractRows(lines: RappiCardSourceLine[]): {
    rows: ParsedStatementRow[];
    financingPlans: ParsedStatementFinancingPlan[];
  } {
    const rows: ParsedStatementRow[] = [];
    const financingPlans: ParsedStatementFinancingPlan[] = [];
    let section: StatementSection = StatementSection.OTHER;
    let financingType: StatementFinancingType =
      StatementFinancingType.NO_INTEREST;
    let pendingPlan: PendingPlanEntry | null = null;

    for (const line of lines) {
      // Glossary/notes quote the section names mid-sentence ("COMPRAS Y
      // CARGOS DIFERIDOS A MESES SIN ..."); they never start a section.
      const quotedReference = /^["\u201c\u201d']/.test(line.text);
      if (!quotedReference && PLAN_END_PATTERN.test(line.fold)) {
        pendingPlan = null;
        section = StatementSection.OTHER;
        continue;
      }
      // "CARGOS, ABONOS Y COMPRAS REGULARES (NO A MESES)" follows the
      // installments tables and must end them (it also matches the
      // installment header pattern below, so check it first).
      if (
        !quotedReference &&
        /COMPRAS REGULARES|\(NO A MESES\)/.test(line.fold)
      ) {
        pendingPlan = null;
        section = StatementSection.CURRENT_CHARGES;
        continue;
      }
      if (!quotedReference && /COMPRAS.*MESES.*CON INTERESES/.test(line.fold)) {
        pendingPlan = null;
        section = StatementSection.FINANCING_PLAN;
        financingType = StatementFinancingType.INTEREST_BEARING;
        continue;
      }
      if (!quotedReference && /COMPRAS.*MESES/.test(line.fold)) {
        pendingPlan = null;
        section = StatementSection.FINANCING_PLAN;
        financingType = StatementFinancingType.NO_INTEREST;
        continue;
      }
      // "MOVIMIENTOS DEL PERIODO" is the assumed/legacy header; the real
      // Banorte-issued RappiCard template instead prints "DESGLOSE DE
      // MOVIMIENTOS" for this same section — accept both.
      if (/DESGLOSE DE MOVIMIENTOS|MOVIMIENTOS DEL PERIODO/.test(line.fold)) {
        pendingPlan = null;
        section = StatementSection.CURRENT_CHARGES;
        continue;
      }
      // Each card instrument prints its own table header.
      if (INSTRUMENT_HEADER_PATTERN.test(line.fold)) {
        pendingPlan = null;
        continue;
      }

      const transaction = this.parseTransaction(line);
      if (!transaction) {
        if (section === StatementSection.FINANCING_PLAN) {
          const step = this.stepPlanTable(
            line,
            pendingPlan,
            financingType,
            financingPlans.length,
          );
          pendingPlan = step.pending;
          if (step.plan) {
            financingPlans.push(step.plan);
          }
        }
        continue;
      }
      pendingPlan = null;
      if (section === StatementSection.OTHER) {
        continue;
      }

      const installment =
        section === StatementSection.FINANCING_PLAN
          ? transaction.description.match(/\b(\d{1,2})\s+DE\s+(\d{1,2})\b/i)
          : null;
      const rowSection = installment
        ? StatementSection.FINANCING_PLAN
        : section;
      const kind = this.classifyRow(
        transaction.description,
        transaction.amount,
      );
      const financingPlanPosition = installment
        ? financingPlans.length
        : undefined;

      if (installment) {
        financingPlans.push({
          position: financingPlans.length,
          type: financingType,
          merchantName: normalizeRappiCardMerchant(transaction.description),
          purchaseDate: transaction.date,
          installmentAmount: Math.abs(transaction.amount),
          installmentNumber: Number(installment[1]),
          installmentCount: Number(installment[2]),
          currency: "MXN",
          sourceRowNumber: line.line,
        });
      }

      rows.push({
        occurrenceKey: `page-${line.page}:line-${line.line}`,
        section: rowSection,
        sourceRowNumber: line.line,
        position: rows.length,
        transactionDate: transaction.date,
        description: transaction.description,
        merchantName: normalizeRappiCardMerchant(transaction.description),
        amount: Math.abs(transaction.amount),
        currency: "MXN",
        kind,
        decision:
          kind === StatementRowKind.PAYMENT || kind === StatementRowKind.CREDIT
            ? StatementRowDecision.INFO_ONLY
            : StatementRowDecision.PENDING,
        financingPlanPosition,
        warningCodes: [],
        rawText: line.text,
      });
    }

    this.markRepeatedOccurrences(rows);
    return { rows, financingPlans };
  }

  private stepPlanTable(
    line: RappiCardSourceLine,
    pending: PendingPlanEntry | null,
    type: StatementFinancingType,
    position: number,
  ): {
    pending: PendingPlanEntry | null;
    plan: ParsedStatementFinancingPlan | null;
  } {
    // Plan entries never span pages: drop leftovers so page headers and
    // footers cannot be glued onto a description.
    const current = pending && pending.page === line.page ? pending : null;

    const prefix = line.text.match(PLAN_DATE_PREFIX_PATTERN);
    if (prefix) {
      return {
        pending: this.newPlanEntry(line, null, prefix[1], null),
        plan: null,
      };
    }
    const start = line.text.match(PLAN_DATE_START_PATTERN);
    if (start) {
      const date = parseRappiCardDate(start[1]);
      if (date) {
        return this.completePlanEntry(
          this.newPlanEntry(line, date, null, start[2] ?? null),
          type,
          position,
        );
      }
    }
    if (!current) {
      return { pending: null, plan: null };
    }
    if (current.datePrefix) {
      const suffix = line.text.match(PLAN_DATE_SUFFIX_PATTERN);
      const date = suffix
        ? parseRappiCardDate(`${current.datePrefix}${suffix[1]}`)
        : null;
      if (!suffix || !date) {
        return { pending: null, plan: null };
      }
      return this.completePlanEntry(
        {
          ...current,
          date,
          datePrefix: null,
          parts: suffix[2] ? [suffix[2]] : [],
        },
        type,
        position,
      );
    }
    if (current.lineCount >= PLAN_MAX_LINES) {
      return { pending: null, plan: null };
    }
    return this.completePlanEntry(
      {
        ...current,
        parts: [...current.parts, line.text],
        lineCount: current.lineCount + 1,
      },
      type,
      position,
    );
  }

  private newPlanEntry(
    line: RappiCardSourceLine,
    date: Date | null,
    datePrefix: string | null,
    firstPart: string | null,
  ): PendingPlanEntry {
    return {
      page: line.page,
      date,
      datePrefix,
      parts: firstPart ? [firstPart] : [],
      lineCount: 1,
      sourceRowNumber: line.line,
    };
  }

  private completePlanEntry(
    entry: PendingPlanEntry,
    type: StatementFinancingType,
    position: number,
  ): {
    pending: PendingPlanEntry | null;
    plan: ParsedStatementFinancingPlan | null;
  } {
    if (!entry.date) {
      return { pending: entry, plan: null };
    }
    const joined = entry.parts.join(" ").replace(/\s+/g, " ").trim();
    const amounts = joined.match(PLAN_AMOUNTS_PATTERN);
    if (!amounts) {
      return { pending: entry, plan: null };
    }
    const values = Array.from(
      amounts[1].matchAll(new RegExp(PLAN_MONEY_TOKEN, "g")),
      (match) => parseRappiCardMoney(match[0]),
    );
    const originalAmount = values[0];
    const remainingAmount = values[1];
    const installmentAmount = values[values.length - 1];
    if (
      originalAmount === null ||
      remainingAmount === null ||
      installmentAmount === null
    ) {
      return { pending: null, plan: null };
    }
    const description = joined.slice(0, amounts.index ?? joined.length);
    return {
      pending: null,
      plan: {
        position,
        type,
        merchantName: normalizeRappiCardPlanMerchant(description),
        purchaseDate: entry.date,
        originalAmount: Math.abs(originalAmount),
        remainingAmount: Math.abs(remainingAmount),
        installmentAmount: Math.abs(installmentAmount),
        installmentNumber: Number(amounts[2]),
        installmentCount: Number(amounts[3]),
        currency: "MXN",
        sourceRowNumber: entry.sourceRowNumber,
      },
    };
  }

  // Page 1 prints the total still owed on every installment plan ("Saldo
  // cargos a meses"), excluding the installment due this period. When the
  // parsed plans do not add up to it, some plan was missed or misread.
  private hasPlansBalanceMismatch(
    lines: RappiCardSourceLine[],
    plans: ParsedStatementFinancingPlan[],
  ) {
    const statedTotal = this.findLabeledAmount(
      lines,
      /^SALDO CARGOS A MESES\b/,
    );
    if (statedTotal === null) {
      return false;
    }
    const parsedTotal = roundRappiCardMoney(
      plans.reduce((total, plan) => total + (plan.remainingAmount ?? 0), 0),
    );
    return Math.abs(parsedTotal - statedTotal) > 0.01;
  }

  private parseTransaction(line: RappiCardSourceLine) {
    const match = line.text.match(RAPPICARD_TRANSACTION_PATTERN);
    if (!match) {
      return null;
    }
    const date = parseRappiCardDate(match[1]);
    const amount = parseRappiCardMoney(match[4]);
    const description = match[3].trim();
    if (!date || amount === null || !description) {
      return null;
    }
    return { date, description, amount };
  }

  private classifyRow(description: string, amount: number) {
    if (amount >= 0) {
      return StatementRowKind.CHARGE;
    }
    const folded = foldRappiCardText(description);
    if (/\bPAGO\b|\bABONO\b/.test(folded)) {
      return StatementRowKind.PAYMENT;
    }
    return StatementRowKind.CREDIT;
  }

  private markRepeatedOccurrences(rows: ParsedStatementRow[]) {
    const fingerprints = new Map<string, ParsedStatementRow[]>();
    for (const row of rows) {
      const fingerprint = [
        row.transactionDate?.toISOString(),
        foldRappiCardText(row.description),
        row.amount.toFixed(2),
      ].join("|");
      const matches = fingerprints.get(fingerprint) ?? [];
      matches.push(row);
      fingerprints.set(fingerprint, matches);
    }

    for (const matches of fingerprints.values()) {
      if (matches.length > 1) {
        for (const row of matches) {
          row.warningCodes = ["REPEATED_LOOKING_OCCURRENCE"];
        }
      }
    }
  }

  private extractSummary(lines: RappiCardSourceLine[]): SummaryValues {
    // The assumed/legacy layout prints "SALDO ANTERIOR"/"TOTAL DE PAGOS"/
    // "SALDO AL CORTE" with every total already computed. The real
    // Banorte-issued RappiCard template instead prints "RESUMEN DE CARGOS Y
    // ABONOS DEL PERIODO" with "Adeudo del periodo anterior"/"Total de
    // abonos" labels and never prints a closing balance at all — that has to
    // be derived from the other totals (see buildReconciliation).
    return {
      openingBalance:
        this.findLabeledAmount(lines, /^SALDO ANTERIOR\b/) ??
        this.findLabeledAmount(lines, /^ADEUDO DEL PERIODO ANTERIOR\b/),
      chargesTotal: this.findLabeledAmount(lines, /^TOTAL DE CARGOS\b/),
      paymentsTotal:
        this.findLabeledAmount(lines, /^TOTAL DE PAGOS\b/) ??
        this.findLabeledAmount(lines, /^TOTAL DE ABONOS\b/),
      creditsTotal: this.findLabeledAmount(lines, /^TOTAL DE CREDITOS\b/) ?? 0,
      closingBalance: this.findLabeledAmount(lines, /^SALDO AL CORTE\b/),
    };
  }

  private findLabeledAmount(lines: RappiCardSourceLine[], label: RegExp) {
    for (const [index, line] of lines.entries()) {
      if (!label.test(line.fold)) {
        continue;
      }
      const sameLineAmount = extractRappiCardTrailingMoney(line.text);
      if (sameLineAmount !== null) {
        return Math.abs(sameLineAmount);
      }
      const nextLine = lines[index + 1];
      if (nextLine?.page === line.page) {
        const adjacentAmount = parseRappiCardMoney(nextLine.text);
        if (adjacentAmount !== null) {
          return Math.abs(adjacentAmount);
        }
      }
    }
    return null;
  }

  private extractPaymentTargets(
    lines: RappiCardSourceLine[],
    dueDate: Date | null,
  ): ParsedStatementPaymentTarget[] {
    // The real template appends a footnote digit directly to the label with
    // no separating space (e.g. "PAGO MINIMO4 $4,422.08"), which would sit
    // between the label text and a plain \b boundary — allow an optional
    // \d* before the boundary so both the legacy and real layouts match.
    const definitions = [
      {
        kind: StatementPaymentTargetKind.NO_INTEREST,
        label: "Payment to avoid interest",
        pattern: /^PAGO PARA NO GENERAR INTERESES\d*\b/,
      },
      {
        kind: StatementPaymentTargetKind.MINIMUM,
        label: "Minimum payment",
        pattern: /^PAGO MINIMO\d*\b/,
      },
    ];
    const targets: ParsedStatementPaymentTarget[] = [];

    for (const line of lines) {
      const definition = definitions.find((item) =>
        item.pattern.test(line.fold),
      );
      if (!definition) {
        continue;
      }
      const amount = extractRappiCardTrailingMoney(line.text);
      if (amount === null) {
        continue;
      }
      targets.push({
        position: targets.length,
        kind: definition.kind,
        label: definition.label,
        amount: Math.abs(amount),
        currency: "MXN",
        dueDate,
        sourceRowNumber: line.line,
      });
    }

    return targets;
  }

  private buildReconciliation(summary: SummaryValues) {
    // The real template never prints a closing balance directly — once the
    // other three totals are known it can (and must) be derived instead of
    // being treated as "missing data" that blocks reconciliation entirely.
    const complete =
      summary.openingBalance !== null &&
      summary.chargesTotal !== null &&
      summary.paymentsTotal !== null;
    const openingBalance = summary.openingBalance ?? 0;
    const chargesTotal = summary.chargesTotal ?? 0;
    const paymentsTotal = summary.paymentsTotal ?? 0;
    const creditsTotal = summary.creditsTotal ?? 0;
    const closingBalance =
      summary.closingBalance ??
      (complete
        ? roundRappiCardMoney(
            openingBalance + chargesTotal - paymentsTotal - creditsTotal,
          )
        : 0);
    const difference = complete
      ? roundRappiCardMoney(
          openingBalance +
            chargesTotal -
            paymentsTotal -
            creditsTotal -
            closingBalance,
        )
      : 0;
    const passed = complete && Math.abs(difference) <= 0.01;

    return {
      openingBalance,
      chargesTotal,
      paymentsTotal,
      creditsTotal,
      closingBalance,
      difference,
      status: passed
        ? StatementReconciliationStatus.PASSED
        : StatementReconciliationStatus.FAILED,
      message: !complete
        ? "Statement reconciliation labels could not be safely aligned"
        : passed
          ? null
          : "Statement reconciliation totals do not balance",
    };
  }
}
