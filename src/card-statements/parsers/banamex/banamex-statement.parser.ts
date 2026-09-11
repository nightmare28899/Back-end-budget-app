import { Injectable } from "@nestjs/common";
import {
  StatementFinancingType,
  StatementInstrumentKind,
  StatementPaymentTargetKind,
  StatementReconciliationStatus,
  StatementRowDecision,
  StatementRowKind,
  StatementSection,
} from "@prisma/client";
import type {
  ParsedStatementData,
  ParsedStatementFinancingPlan,
  ParsedStatementInstrument,
  ParsedStatementPaymentTarget,
  ParsedStatementRow,
} from "../../card-statements.types";
import type {
  ExtractedStatementText,
  StatementParser,
} from "../statement-parser.interface";
import { StatementProcessingError } from "../statement-parser.interface";
import {
  BANAMEX_MONEY_AT_END_PATTERN,
  BANAMEX_TRANSACTION_PATTERN,
  type BanamexSourceLine,
  extractTrailingMoney,
  foldStatementText,
  normalizeStatementMerchant,
  parseStatementDate,
  parseStatementMoney,
  roundStatementMoney,
  toBanamexSourceLines,
} from "./banamex-statement.normalizers";

const PARSER_VERSION = "banamex-text-v1";

interface SummaryValues {
  openingBalance: number | null;
  chargesTotal: number | null;
  paymentsTotal: number | null;
  creditsTotal: number | null;
  closingBalance: number | null;
}

@Injectable()
export class BanamexStatementParser implements StatementParser {
  canParse(input: ExtractedStatementText): boolean {
    return /\b(?:CITI\s*)?BANAMEX\b/.test(foldStatementText(input.text));
  }

  parse(input: ExtractedStatementText): ParsedStatementData {
    if (!this.canParse(input)) {
      throw new StatementProcessingError(
        "UNSUPPORTED_STATEMENT_ISSUER",
        "The PDF is not a supported Banamex statement",
      );
    }

    const lines = toBanamexSourceLines(input);
    const period = this.extractPeriod(lines);
    if (!period) {
      throw new StatementProcessingError(
        "BANAMEX_PERIOD_NOT_FOUND",
        "The Banamex statement period could not be identified",
      );
    }

    const dueDate = this.extractDueDate(lines);
    const summary = this.extractSummary(lines);
    const paymentTargets = this.extractPaymentTargets(lines, dueDate);
    const parsedSections = this.extractSections(lines);
    if (parsedSections.rows.length === 0) {
      throw new StatementProcessingError(
        "BANAMEX_TRANSACTIONS_NOT_FOUND",
        "No Banamex statement transactions could be identified",
      );
    }

    const reconciliation = this.buildReconciliation(summary);
    let warningCount = parsedSections.warningCount;
    if (paymentTargets.length === 0) {
      warningCount += 1;
    }
    if (reconciliation.status !== StatementReconciliationStatus.PASSED) {
      warningCount += 1;
    }

    return {
      parserVersion: PARSER_VERSION,
      periodStart: period.start,
      periodEnd: period.end,
      warningCount,
      reconciliation,
      instruments: parsedSections.instruments,
      financingPlans: parsedSections.financingPlans,
      paymentTargets,
      rows: parsedSections.rows,
    };
  }

  private extractPeriod(lines: BanamexSourceLine[]) {
    for (const line of lines) {
      const match = line.fold.match(
        /PERIODO(?:\s+DEL)?\s+(\d{2}\/\d{2}\/\d{2,4})\s+(?:AL|A)\s+(\d{2}\/\d{2}\/\d{2,4})/,
      );
      if (match) {
        const start = parseStatementDate(match[1]);
        const end = parseStatementDate(match[2]);
        if (start && end && end >= start) {
          return { start, end };
        }
      }
    }
    return null;
  }

  private extractDueDate(lines: BanamexSourceLine[]) {
    for (const line of lines) {
      const match = line.fold.match(
        /FECHA LIMITE DE PAGO\s+(\d{2}\/\d{2}\/\d{2,4})/,
      );
      if (match) {
        return parseStatementDate(match[1]);
      }
    }
    return null;
  }

  private extractSummary(lines: BanamexSourceLine[]): SummaryValues {
    return {
      openingBalance: this.findLabeledAmount(lines, [/^SALDO ANTERIOR\b/]),
      chargesTotal: this.findLabeledAmount(lines, [
        /^COMPRAS Y (?:OTROS )?CARGOS\b/,
        /^CARGOS DEL PERIODO\b/,
      ]),
      paymentsTotal: this.findLabeledAmount(lines, [
        /^PAGOS Y ABONOS\b/,
        /^PAGOS DEL PERIODO\b/,
      ]),
      creditsTotal:
        this.findLabeledAmount(lines, [/^CREDITOS\b/, /^BONIFICACIONES\b/]) ??
        0,
      closingBalance: this.findLabeledAmount(lines, [
        /^SALDO NUEVO\b/,
        /^SALDO AL CORTE\b/,
      ]),
    };
  }

  private findLabeledAmount(lines: BanamexSourceLine[], labels: RegExp[]) {
    for (const line of lines) {
      if (!labels.some((label) => label.test(line.fold))) {
        continue;
      }
      const amount = extractTrailingMoney(line.text);
      if (amount !== null) {
        return Math.abs(amount);
      }
    }
    return null;
  }

  private extractPaymentTargets(
    lines: BanamexSourceLine[],
    dueDate: Date | null,
  ): ParsedStatementPaymentTarget[] {
    const definitions: Array<{
      kind: StatementPaymentTargetKind;
      label: string;
      pattern: RegExp;
    }> = [
      {
        kind: StatementPaymentTargetKind.MINIMUM_PLUS_INSTALLMENTS,
        label: "Minimum payment plus installments",
        pattern: /^PAGO MINIMO MAS .*MESES.*INTERESES/,
      },
      {
        kind: StatementPaymentTargetKind.NO_INTEREST,
        label: "Payment to avoid interest",
        pattern: /^PAGO PARA NO GENERAR INTERESES/,
      },
      {
        kind: StatementPaymentTargetKind.MINIMUM,
        label: "Minimum payment",
        pattern: /^PAGO MINIMO\b/,
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
      const amount = extractTrailingMoney(line.text);
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

  private extractSections(lines: BanamexSourceLine[]) {
    const rows: ParsedStatementRow[] = [];
    const instruments: ParsedStatementInstrument[] = [];
    const financingPlans: ParsedStatementFinancingPlan[] = [];
    const instrumentPositions = new Map<string, number>();
    let section: StatementSection = StatementSection.OTHER;
    let financingType: StatementFinancingType =
      StatementFinancingType.NO_INTEREST;
    let currentInstrumentPosition: number | null = null;

    for (const line of lines) {
      const nextSection = this.detectSection(line);
      if (nextSection) {
        section = nextSection.section;
        financingType = nextSection.financingType ?? financingType;
        continue;
      }

      const instrument = this.parseInstrument(line);
      if (instrument) {
        const key = `${instrument.kind}:${instrument.last4 ?? instrument.label}`;
        const existingPosition = instrumentPositions.get(key);
        if (existingPosition !== undefined) {
          currentInstrumentPosition = existingPosition;
        } else {
          instrument.position = instruments.length;
          instruments.push(instrument);
          instrumentPositions.set(key, instrument.position);
          currentInstrumentPosition = instrument.position;
        }
        continue;
      }

      if (
        section !== StatementSection.CURRENT_CHARGES &&
        section !== StatementSection.FINANCING_PLAN &&
        section !== StatementSection.CFDI
      ) {
        continue;
      }

      const transaction = this.parseTransaction(line);
      if (!transaction) {
        continue;
      }

      const kind = this.classifyRow(transaction.description, section);
      const financingPlan =
        section === StatementSection.FINANCING_PLAN
          ? this.parseFinancingPlan(
              transaction,
              financingType,
              currentInstrumentPosition,
              financingPlans.length,
              line.line,
            )
          : null;
      if (financingPlan) {
        financingPlans.push(financingPlan);
      }

      rows.push({
        occurrenceKey: `page-${line.page}:line-${line.line}`,
        section,
        sourceRowNumber: line.line,
        position: rows.length,
        transactionDate: transaction.date,
        description: transaction.description,
        merchantName: normalizeStatementMerchant(transaction.description),
        amount: Math.abs(transaction.amount),
        currency: "MXN",
        kind,
        decision: this.defaultDecision(kind, section),
        financingPlanPosition: financingPlan?.position,
        warningCodes: this.warningCodesFor(kind, section),
        rawText: line.text,
      });
    }

    this.markRepeatedOccurrences(rows);
    const warningCount = rows.reduce(
      (total, row) => total + (row.warningCodes?.length ?? 0),
      0,
    );
    return { rows, instruments, financingPlans, warningCount };
  }

  private detectSection(line: BanamexSourceLine): {
    section: StatementSection;
    financingType?: StatementFinancingType;
  } | null {
    if (BANAMEX_MONEY_AT_END_PATTERN.test(line.text)) {
      return null;
    }
    if (/\b(?:CFDI|COMPROBANTES FISCALES)\b/.test(line.fold)) {
      return { section: StatementSection.CFDI };
    }
    if (/COMPRAS.*MESES.*SIN INTERESES/.test(line.fold)) {
      return {
        section: StatementSection.FINANCING_PLAN,
        financingType: StatementFinancingType.NO_INTEREST,
      };
    }
    if (/PLAN DE PAGOS|SALDO DIFERIDO|PAGOS FIJOS/.test(line.fold)) {
      return {
        section: StatementSection.FINANCING_PLAN,
        financingType: StatementFinancingType.REFINANCED,
      };
    }
    if (/DETALLE DE OPERACIONES|MOVIMIENTOS DEL PERIODO/.test(line.fold)) {
      return { section: StatementSection.CURRENT_CHARGES };
    }
    if (/RESUMEN DE SALDOS|RESUMEN DE CUENTA/.test(line.fold)) {
      return { section: StatementSection.RECONCILIATION };
    }
    if (/INFORMACION DE PAGOS|OPCIONES DE PAGO/.test(line.fold)) {
      return { section: StatementSection.PAYMENT_TARGET };
    }
    return null;
  }

  private parseInstrument(
    line: BanamexSourceLine,
  ): ParsedStatementInstrument | null {
    const match = line.fold.match(
      /TARJETA\s+(DIGITAL|TITULAR|FISICA)?[^\d]*(?:TERMINACION|\*+)\s*(\d{4})/,
    );
    if (!match) {
      return null;
    }

    const kind =
      match[1] === "DIGITAL"
        ? StatementInstrumentKind.DIGITAL
        : StatementInstrumentKind.PHYSICAL;
    return {
      position: 0,
      label:
        kind === StatementInstrumentKind.DIGITAL
          ? `Digital card •••• ${match[2]}`
          : `Physical card •••• ${match[2]}`,
      kind,
      last4: match[2],
    };
  }

  private parseTransaction(line: BanamexSourceLine) {
    const match = line.text.match(BANAMEX_TRANSACTION_PATTERN);
    if (!match) {
      return null;
    }
    const date = parseStatementDate(match[1]);
    const amount = parseStatementMoney(match[4]);
    const description = match[3].trim();
    if (!date || amount === null || !description) {
      return null;
    }
    return { date, description, amount };
  }

  private parseFinancingPlan(
    transaction: { date: Date; description: string; amount: number },
    type: StatementFinancingType,
    instrumentPosition: number | null,
    position: number,
    sourceRowNumber: number,
  ): ParsedStatementFinancingPlan | null {
    const folded = foldStatementText(transaction.description);
    const installment = folded.match(/\b(\d{1,2})\s*(?:DE|\/)\s*(\d{1,2})\b/);
    if (!installment && type === StatementFinancingType.NO_INTEREST) {
      return null;
    }

    const installmentNumber = installment ? Number(installment[1]) : null;
    const installmentCount = installment ? Number(installment[2]) : null;
    return {
      position,
      instrumentPosition,
      type,
      merchantName: normalizeStatementMerchant(transaction.description),
      purchaseDate: transaction.date,
      installmentAmount: Math.abs(transaction.amount),
      installmentNumber,
      installmentCount,
      currency: "MXN",
      sourceRowNumber,
    };
  }

  private classifyRow(description: string, section: StatementSection) {
    if (section === StatementSection.CFDI) {
      return StatementRowKind.CFDI;
    }
    const folded = foldStatementText(description);
    if (/\bIVA\b.*\bINTERES|\bINTERES.*\bIVA\b/.test(folded)) {
      return StatementRowKind.TAX;
    }
    if (/\bINTERES/.test(folded)) {
      return StatementRowKind.INTEREST;
    }
    if (/\bPAGO\b|\bABONO\b/.test(folded)) {
      return StatementRowKind.PAYMENT;
    }
    if (/BONIFICACION|DEVOLUCION|\bCREDITO\b/.test(folded)) {
      return StatementRowKind.CREDIT;
    }
    if (/CAPITAL|SALDO DIFERIDO|REFINANCI/.test(folded)) {
      return StatementRowKind.REFINANCED_PRINCIPAL;
    }
    return StatementRowKind.CHARGE;
  }

  private defaultDecision(kind: StatementRowKind, section: StatementSection) {
    if (
      section === StatementSection.CFDI ||
      kind === StatementRowKind.CFDI ||
      kind === StatementRowKind.PAYMENT ||
      kind === StatementRowKind.CREDIT ||
      kind === StatementRowKind.REFINANCED_PRINCIPAL
    ) {
      return StatementRowDecision.INFO_ONLY;
    }
    return StatementRowDecision.PENDING;
  }

  private warningCodesFor(kind: StatementRowKind, section: StatementSection) {
    if (section === StatementSection.CFDI) {
      return ["FISCAL_APPENDIX_NOT_TRANSACTION"];
    }
    if (kind === StatementRowKind.REFINANCED_PRINCIPAL) {
      return ["DEBT_AMORTIZATION_NOT_EXPENSE"];
    }
    return [];
  }

  private markRepeatedOccurrences(rows: ParsedStatementRow[]) {
    const fingerprints = new Map<string, ParsedStatementRow[]>();
    for (const row of rows) {
      const fingerprint = [
        row.transactionDate?.toISOString(),
        foldStatementText(row.description),
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
        row.warningCodes = Array.from(
          new Set([...(row.warningCodes ?? []), "REPEATED_LOOKING_OCCURRENCE"]),
        );
      }
    }
  }

  private buildReconciliation(summary: SummaryValues) {
    const missing = Object.entries(summary)
      .filter(([, value]) => value === null)
      .map(([key]) => key);
    const openingBalance = summary.openingBalance ?? 0;
    const chargesTotal = summary.chargesTotal ?? 0;
    const paymentsTotal = summary.paymentsTotal ?? 0;
    const creditsTotal = summary.creditsTotal ?? 0;
    const closingBalance = summary.closingBalance ?? 0;
    const difference = roundStatementMoney(
      openingBalance +
        chargesTotal -
        paymentsTotal -
        creditsTotal -
        closingBalance,
    );
    const passed = missing.length === 0 && Math.abs(difference) <= 0.01;

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
      message:
        missing.length > 0
          ? "Some statement reconciliation totals could not be extracted"
          : passed
            ? null
            : "Statement reconciliation totals do not balance",
    };
  }
}
