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
  BBVA_DATE_PATTERN,
  BBVA_MONEY_AT_END_PATTERN,
  BBVA_PLAN_AMOUNTS_PATTERN,
  BBVA_PLAN_ENTRY_PATTERN,
  BBVA_PLAN_MONEY_TOKEN,
  BBVA_PLAN_START_PATTERN,
  BBVA_TRANSACTION_PATTERN,
  type BbvaSourceLine,
  extractBbvaTrailingMoney,
  foldBbvaText,
  normalizeBbvaMerchant,
  parseBbvaDate,
  parseBbvaMoney,
  roundBbvaMoney,
  toBbvaSourceLines,
} from "./bbva-statement.normalizers";

const PARSER_VERSION = "bbva-text-v1";

const PLAN_MAX_DESCRIPTION_LINES = 4;
const INSTALLMENT_ROW_PATTERN = /^\d{1,2}\s+DE\s+\d{1,2}\b/i;
// Informational classification, not an anomaly: excluded from warningCount.
const INSTALLMENT_WARNING_CODE = "DEBT_AMORTIZATION_NOT_EXPENSE";

interface PendingPlanEntry {
  date: Date;
  descriptionParts: string[];
  sourceRowNumber: number;
}

interface SummaryValues {
  openingBalance: number | null;
  chargesTotal: number | null;
  paymentsTotal: number | null;
  creditsTotal: number;
  closingBalance: number | null;
}

@Injectable()
export class BbvaStatementParser implements StatementParser {
  canParse(input: ExtractedStatementText): boolean {
    const text = foldBbvaText(input.text);
    return (
      /\bBBVA MEXICO\b/.test(text) &&
      /\bTU PAGO REQUERIDO ESTE PERIODO\b/.test(text) &&
      /\bDESGLOSE DE MOVIMIENTOS\b/.test(text)
    );
  }

  parse(input: ExtractedStatementText): ParsedStatementData {
    if (!this.canParse(input)) {
      throw new StatementProcessingError(
        "UNSUPPORTED_STATEMENT_ISSUER",
        "The PDF is not a supported BBVA statement",
      );
    }

    const lines = toBbvaSourceLines(input);
    const period = this.extractPeriod(lines);
    if (!period) {
      throw new StatementProcessingError(
        "BBVA_PERIOD_NOT_FOUND",
        "The BBVA statement period could not be identified",
      );
    }

    const rows = this.extractRows(lines);
    if (rows.length === 0) {
      throw new StatementProcessingError(
        "BBVA_TRANSACTIONS_NOT_FOUND",
        "No BBVA statement transactions could be identified",
      );
    }

    const dueDate = this.extractDueDate(lines);
    const paymentTargets = this.extractPaymentTargets(lines, dueDate);
    const reconciliation = this.buildReconciliation(this.extractSummary(lines));
    const financingPlans = this.extractFinancingPlans(lines);
    const warningCount =
      rows.reduce(
        (total, row) =>
          total +
          (row.warningCodes ?? []).filter(
            (code) => code !== INSTALLMENT_WARNING_CODE,
          ).length,
        0,
      ) +
      (paymentTargets.length === 0 ? 1 : 0) +
      (this.hasPlansBalanceMismatch(lines, financingPlans) ? 1 : 0) +
      (reconciliation.status === StatementReconciliationStatus.PASSED ? 0 : 1);

    return {
      parserVersion: PARSER_VERSION,
      periodStart: period.start,
      periodEnd: period.end,
      warningCount,
      reconciliation: { ...reconciliation, currency: "MXN" },
      instruments: [],
      financingPlans,
      paymentTargets,
      rows,
    };
  }

  private extractPeriod(lines: BbvaSourceLine[]) {
    const pattern = new RegExp(
      `PERIODO\\s*:?\\s*(${BBVA_DATE_PATTERN})\\s+(?:AL|A)\\s+(${BBVA_DATE_PATTERN})`,
      "i",
    );
    for (const line of lines) {
      const match = line.text.match(pattern);
      if (!match) {
        continue;
      }
      const start = parseBbvaDate(match[1]);
      const end = parseBbvaDate(match[2]);
      if (start && end && end >= start) {
        return { start, end };
      }
    }
    return null;
  }

  private extractDueDate(lines: BbvaSourceLine[]) {
    // Printed as "Fecha límite de pago:1 lunes, 05-oct-2026": accent, footnote
    // digit and weekday name all have to be tolerated, so match on the fold.
    const pattern = new RegExp(
      `FECHA LIMITE DE PAGO\\s*:?\\s*\\d*\\s*(?:[A-Z]+,\\s*)?(${BBVA_DATE_PATTERN})`,
    );
    for (const line of lines) {
      const match = line.fold.match(pattern);
      if (match) {
        return parseBbvaDate(match[1]);
      }
    }
    return null;
  }

  private extractPaymentTargets(
    lines: BbvaSourceLine[],
    dueDate: Date | null,
  ): ParsedStatementPaymentTarget[] {
    const definitions = [
      {
        kind: StatementPaymentTargetKind.MINIMUM_PLUS_INSTALLMENTS,
        label: "Minimum payment plus installments",
        pattern: /^PAGO MINIMO \+ COMPRAS Y CARGO[S]? DIFERIDOS A MESES\d*\b/,
      },
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
    const capturedKinds = new Set<StatementPaymentTargetKind>();

    for (const line of lines) {
      const definition = definitions.find(
        (candidate) =>
          !capturedKinds.has(candidate.kind) &&
          candidate.pattern.test(line.fold),
      );
      if (!definition) {
        continue;
      }
      const amount = extractBbvaTrailingMoney(line.text);
      if (amount === null) {
        continue;
      }
      capturedKinds.add(definition.kind);
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

  private extractRows(lines: BbvaSourceLine[]): ParsedStatementRow[] {
    const rows: ParsedStatementRow[] = [];
    let inCurrentCharges = false;

    for (const line of lines) {
      if (/^CARGOS,?COMPRAS Y ABONOS REGULARES/.test(line.fold)) {
        inCurrentCharges = true;
        continue;
      }
      if (
        /^(?:TOTAL CARGOS|ATENCION DE QUEJAS|NOTAS ACLARATORIAS|GLOSARIO)/.test(
          line.fold,
        )
      ) {
        inCurrentCharges = false;
        continue;
      }
      if (!inCurrentCharges) {
        continue;
      }

      const match = line.text.match(BBVA_TRANSACTION_PATTERN);
      if (!match) {
        continue;
      }
      const transactionDate = parseBbvaDate(match[1]);
      const amount = parseBbvaMoney(match[4]);
      const description = match[3].trim();
      if (!transactionDate || amount === null || !description) {
        continue;
      }

      const installment = INSTALLMENT_ROW_PATTERN.test(description);
      const kind = installment
        ? StatementRowKind.REFINANCED_PRINCIPAL
        : this.classifyRow(description, amount);
      const section = installment
        ? StatementSection.FINANCING_PLAN
        : StatementSection.CURRENT_CHARGES;
      rows.push({
        occurrenceKey: `page-${line.page}:line-${line.line}`,
        section,
        sourceRowNumber: line.line,
        position: rows.length,
        transactionDate,
        description,
        merchantName: normalizeBbvaMerchant(description),
        amount: Math.abs(amount),
        currency: "MXN",
        kind,
        decision: this.defaultDecision(kind),
        warningCodes:
          kind === StatementRowKind.REFINANCED_PRINCIPAL
            ? [INSTALLMENT_WARNING_CODE]
            : [],
        rawText: line.text,
      });
    }

    this.markRepeatedOccurrences(rows);
    return rows;
  }

  private classifyRow(description: string, amount: number) {
    const folded = foldBbvaText(description);
    if (/ALTA PARA MESES|ABONO FINANC\./.test(folded)) {
      return StatementRowKind.REFINANCED_PRINCIPAL;
    }
    if (amount >= 0) {
      return StatementRowKind.CHARGE;
    }
    if (/\bPAGO\b|\bABONO\b/.test(folded)) {
      return StatementRowKind.PAYMENT;
    }
    return StatementRowKind.CREDIT;
  }

  private defaultDecision(kind: StatementRowKind) {
    return kind === StatementRowKind.CHARGE
      ? StatementRowDecision.PENDING
      : StatementRowDecision.INFO_ONLY;
  }

  private extractFinancingPlans(
    lines: BbvaSourceLine[],
  ): ParsedStatementFinancingPlan[] {
    const plans: ParsedStatementFinancingPlan[] = [];
    let financingType: StatementFinancingType | null = null;
    let pending: PendingPlanEntry | null = null;

    for (const line of lines) {
      const sectionType = this.detectPlanSection(line);
      if (sectionType !== undefined) {
        financingType = sectionType;
        pending = null;
        continue;
      }
      if (!financingType) {
        continue;
      }

      const step = this.stepPlanEntry(
        line,
        pending,
        financingType,
        plans.length,
      );
      pending = step.pending;
      if (step.plan) {
        plans.push(step.plan);
      }
    }

    return plans;
  }

  // Returns the financing type a header opens, null when the line closes the
  // plan tables, or undefined when the line is not a section header at all.
  private detectPlanSection(
    line: BbvaSourceLine,
  ): StatementFinancingType | null | undefined {
    if (/^CARGOS,?\s*COMPRAS Y ABONOS REGULARES/.test(line.fold)) {
      return null;
    }
    if (
      /^(?:TOTAL CARGOS|ATENCION DE QUEJAS|NOTAS ACLARATORIAS|GLOSARIO)/.test(
        line.fold,
      )
    ) {
      return null;
    }
    // Headers start the line; numbered footnotes and prose that merely
    // mention the same words never open a plan table.
    if (/^COMPRAS.*MESES.*SIN INTERESES/.test(line.fold)) {
      return StatementFinancingType.NO_INTEREST;
    }
    if (/^COMPRAS.*MESES.*CON INTERESES/.test(line.fold)) {
      return StatementFinancingType.INTEREST_BEARING;
    }
    return undefined;
  }

  private stepPlanEntry(
    line: BbvaSourceLine,
    pending: PendingPlanEntry | null,
    type: StatementFinancingType,
    position: number,
  ): {
    pending: PendingPlanEntry | null;
    plan: ParsedStatementFinancingPlan | null;
  } {
    const single = line.text.match(BBVA_PLAN_ENTRY_PATTERN);
    if (single) {
      const date = parseBbvaDate(single[1]);
      return {
        pending: null,
        plan: date
          ? this.buildPlan(
              position,
              type,
              date,
              single[2],
              single[3],
              single[4],
              single[5],
              line.line,
            )
          : null,
      };
    }

    const start = line.text.match(BBVA_PLAN_START_PATTERN);
    if (start) {
      const date = parseBbvaDate(start[1]);
      const hasMoney = BBVA_MONEY_AT_END_PATTERN.test(line.text);
      return {
        pending:
          date && !hasMoney
            ? {
                date,
                descriptionParts: [start[2]],
                sourceRowNumber: line.line,
              }
            : null,
        plan: null,
      };
    }
    if (!pending) {
      return { pending: null, plan: null };
    }

    const amounts = line.text.match(BBVA_PLAN_AMOUNTS_PATTERN);
    if (amounts) {
      return {
        pending: null,
        plan: this.buildPlan(
          position,
          type,
          pending.date,
          pending.descriptionParts.join(" "),
          amounts[1],
          amounts[2],
          amounts[3],
          pending.sourceRowNumber,
        ),
      };
    }

    // Any other line with money is not part of a description: abandon the entry.
    if (
      BBVA_MONEY_AT_END_PATTERN.test(line.text) ||
      pending.descriptionParts.length >= PLAN_MAX_DESCRIPTION_LINES
    ) {
      return { pending: null, plan: null };
    }
    return {
      pending: {
        ...pending,
        descriptionParts: [...pending.descriptionParts, line.text],
      },
      plan: null,
    };
  }

  private buildPlan(
    position: number,
    type: StatementFinancingType,
    purchaseDate: Date,
    description: string,
    amountsText: string,
    installmentNumber: string,
    installmentCount: string,
    sourceRowNumber: number,
  ): ParsedStatementFinancingPlan | null {
    // "<original> <remaining> [<interest> <VAT>] <required>"
    const values = Array.from(
      amountsText.matchAll(new RegExp(BBVA_PLAN_MONEY_TOKEN, "g")),
      (match) => parseBbvaMoney(match[0]),
    );
    const originalAmount = values[0];
    const remainingAmount = values[1];
    const installmentAmount = values[values.length - 1];
    if (
      originalAmount === null ||
      remainingAmount === null ||
      installmentAmount === null
    ) {
      return null;
    }
    return {
      position,
      type,
      merchantName: normalizeBbvaMerchant(description),
      purchaseDate,
      originalAmount: Math.abs(originalAmount),
      remainingAmount: Math.abs(remainingAmount),
      installmentAmount: Math.abs(installmentAmount),
      installmentNumber: Number(installmentNumber),
      installmentCount: Number(installmentCount),
      currency: "MXN",
      sourceRowNumber,
    };
  }

  // Page 2 prints the total still owed on every installment plan ("Saldo
  // cargo a meses"), excluding the installment due this period. When the
  // parsed plans do not add up to it, some plan was missed or misread.
  private hasPlansBalanceMismatch(
    lines: BbvaSourceLine[],
    plans: ParsedStatementFinancingPlan[],
  ) {
    const statedTotal = this.findLabeledAmount(
      lines,
      /^SALDO CARGOS? A MESES\b/,
    );
    if (statedTotal === null) {
      return false;
    }
    const parsedTotal = roundBbvaMoney(
      plans.reduce((total, plan) => total + (plan.remainingAmount ?? 0), 0),
    );
    return Math.abs(parsedTotal - statedTotal) > 0.01;
  }

  private extractSummary(lines: BbvaSourceLine[]): SummaryValues {
    const openingBalance = this.findLabeledAmount(
      lines,
      /^ADEUDO DEL PERIODO ANTERIOR\b/,
    );
    const chargesTotal = this.sumLabeledAmounts(lines, [
      /^CARGOS REGULARES(?:\s*\([^)]*\))?\d*\s*\+/,
      /^CARGOS COMPRAS A MESES \(CAPITAL\)\d*\s*\+/,
      /^MONTO DE INTERESES\d*\s*\+/,
      /^MONTO DE COMISIONES\d*\s*\+/,
      /^IVA DE INTERESES Y COMISIONES\d*\s*\+/,
    ]);
    const paymentsTotal = this.findLabeledAmount(lines, /^PAGOS Y ABONOS\b/);
    const closingBalance =
      openingBalance !== null && chargesTotal !== null && paymentsTotal !== null
        ? roundBbvaMoney(openingBalance + chargesTotal - paymentsTotal)
        : null;

    return {
      openingBalance,
      chargesTotal,
      paymentsTotal,
      creditsTotal: 0,
      closingBalance,
    };
  }

  private findLabeledAmount(lines: BbvaSourceLine[], label: RegExp) {
    for (const line of lines) {
      if (!label.test(line.fold)) {
        continue;
      }
      const amount = extractBbvaTrailingMoney(line.text);
      if (amount !== null) {
        return Math.abs(amount);
      }
    }
    return null;
  }

  private sumLabeledAmounts(lines: BbvaSourceLine[], labels: RegExp[]) {
    let total = 0;
    let found = false;
    for (const line of lines) {
      if (!labels.some((label) => label.test(line.fold))) {
        continue;
      }
      const amount = extractBbvaTrailingMoney(line.text);
      if (amount !== null) {
        total += Math.abs(amount);
        found = true;
      }
    }
    return found ? roundBbvaMoney(total) : null;
  }

  private buildReconciliation(summary: SummaryValues) {
    const complete = Object.values(summary).every((value) => value !== null);
    const openingBalance = summary.openingBalance ?? 0;
    const chargesTotal = summary.chargesTotal ?? 0;
    const paymentsTotal = summary.paymentsTotal ?? 0;
    const closingBalance = summary.closingBalance ?? 0;
    const difference = complete
      ? roundBbvaMoney(
          openingBalance + chargesTotal - paymentsTotal - closingBalance,
        )
      : 0;
    const passed = complete && Math.abs(difference) <= 0.01;

    return {
      openingBalance,
      chargesTotal,
      paymentsTotal,
      creditsTotal: summary.creditsTotal,
      closingBalance,
      difference,
      status: passed
        ? StatementReconciliationStatus.PASSED
        : StatementReconciliationStatus.FAILED,
      message: !complete
        ? "BBVA statement reconciliation labels could not be safely aligned"
        : passed
          ? null
          : "BBVA statement reconciliation totals do not balance",
    };
  }

  private markRepeatedOccurrences(rows: ParsedStatementRow[]) {
    const fingerprints = new Map<string, ParsedStatementRow[]>();
    for (const row of rows) {
      const fingerprint = [
        row.transactionDate?.toISOString(),
        foldBbvaText(row.description),
        row.amount.toFixed(2),
      ].join("|");
      const matches = fingerprints.get(fingerprint) ?? [];
      matches.push(row);
      fingerprints.set(fingerprint, matches);
    }

    for (const matches of fingerprints.values()) {
      if (matches.length < 2) {
        continue;
      }
      for (const row of matches) {
        row.warningCodes = ["REPEATED_LOOKING_OCCURRENCE"];
      }
    }
  }
}
