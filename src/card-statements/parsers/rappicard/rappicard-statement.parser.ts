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
  type RappiCardSourceLine,
  roundRappiCardMoney,
  toRappiCardSourceLines,
} from "./rappicard-statement.normalizers";

const PARSER_VERSION = "rappicard-text-v1";

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
    const warningCount =
      rowsAndPlans.rows.reduce(
        (total, row) => total + (row.warningCodes?.length ?? 0),
        0,
      ) +
      (paymentTargets.length === 0 ? 1 : 0) +
      (reconciliation.status === StatementReconciliationStatus.PASSED ? 0 : 1);

    return {
      parserVersion: PARSER_VERSION,
      periodStart: period.start,
      periodEnd: period.end,
      warningCount,
      reconciliation,
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
    const pattern = new RegExp(
      `FECHA LIMITE DE PAGO\\s*:?\\s*(${RAPPICARD_DATE_PATTERN})`,
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
    let financingType: StatementFinancingType = StatementFinancingType.NO_INTEREST;

    for (const line of lines) {
      if (/COMPRAS.*MESES.*CON INTERESES/.test(line.fold)) {
        section = StatementSection.FINANCING_PLAN;
        financingType = StatementFinancingType.INTEREST_BEARING;
        continue;
      }
      if (/COMPRAS.*MESES/.test(line.fold)) {
        section = StatementSection.FINANCING_PLAN;
        financingType = StatementFinancingType.NO_INTEREST;
        continue;
      }
      // "MOVIMIENTOS DEL PERIODO" is the assumed/legacy header; the real
      // Banorte-issued RappiCard template instead prints "DESGLOSE DE
      // MOVIMIENTOS" for this same section — accept both.
      if (/DESGLOSE DE MOVIMIENTOS|MOVIMIENTOS DEL PERIODO/.test(line.fold)) {
        section = StatementSection.CURRENT_CHARGES;
        continue;
      }

      const transaction = this.parseTransaction(line);
      if (!transaction || section === StatementSection.OTHER) {
        continue;
      }

      const installment = transaction.description.match(
        /\b(\d{1,2})\s+DE\s+(\d{1,2})\b/i,
      );
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
          openingBalance + chargesTotal - paymentsTotal - creditsTotal - closingBalance,
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
