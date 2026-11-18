import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ParsedStatementData } from "./card-statements.types";
import type {
  ExtractedStatementText,
  StatementParser,
} from "./parsers/statement-parser.interface";

export class FinancingPlanBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancingPlanBackfillError";
  }
}

export interface BackfillStatementImport {
  id: string;
  sourceSha256: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface BuildBackfillInput {
  statementImport: BackfillStatementImport;
  pdfSha256: string;
  parsed: ParsedStatementData;
  instrumentSnapshots: Array<{ id: string; position: number }>;
}

/**
 * Picks the parser for the PDF. With an explicit issuer the matching parser
 * must accept the PDF; without one exactly one parser may accept it, so an
 * ambiguous or unrecognized PDF never gets parsed by a guess.
 */
export function selectBackfillParser(
  issuer: string | undefined,
  parsers: Record<string, StatementParser>,
  extracted: ExtractedStatementText,
): StatementParser {
  const issuers = Object.keys(parsers);
  if (issuer !== undefined) {
    const parser = parsers[issuer];
    if (!parser) {
      throw new FinancingPlanBackfillError(
        `Unknown issuer "${issuer}" (expected one of: ${issuers.join(", ")})`,
      );
    }
    if (!parser.canParse(extracted)) {
      throw new FinancingPlanBackfillError(
        `The PDF is not a ${issuer} statement`,
      );
    }
    return parser;
  }

  const accepted = issuers.filter((name) => parsers[name].canParse(extracted));
  if (accepted.length !== 1) {
    throw new FinancingPlanBackfillError(
      `Could not detect the issuer (${accepted.length} parsers accept the PDF); pass --issuer ${issuers.join("|")}`,
    );
  }
  return parsers[accepted[0]];
}

export function sha256Hex(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const dayKey = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : null;

/**
 * Pure step of the financing-plan backfill (any issuer): verifies the PDF really is
 * the one the import was created from and returns the plan rows to insert.
 * Throws instead of returning data whenever the inputs do not line up, so the
 * caller never deletes the existing plans without a safe replacement.
 */
export function buildFinancingPlanBackfill(
  input: BuildBackfillInput,
): Prisma.StatementFinancingPlanCreateManyInput[] {
  const { statementImport, parsed } = input;

  if (input.pdfSha256 !== statementImport.sourceSha256) {
    throw new FinancingPlanBackfillError(
      "PDF hash does not match the statement import source hash",
    );
  }
  if (
    dayKey(parsed.periodStart) !== dayKey(statementImport.periodStart) ||
    dayKey(parsed.periodEnd) !== dayKey(statementImport.periodEnd)
  ) {
    throw new FinancingPlanBackfillError(
      "Parsed statement period does not match the statement import period",
    );
  }
  if (parsed.financingPlans.length === 0) {
    throw new FinancingPlanBackfillError(
      "The parser found no financing plans; refusing to replace existing plans",
    );
  }

  const snapshotByPosition = new Map(
    input.instrumentSnapshots.map((snapshot) => [
      snapshot.position,
      snapshot.id,
    ]),
  );

  return parsed.financingPlans.map((plan) => ({
    statementImportId: statementImport.id,
    instrumentSnapshotId:
      plan.instrumentPosition == null
        ? null
        : (snapshotByPosition.get(plan.instrumentPosition) ?? null),
    type: plan.type,
    merchantName: plan.merchantName ?? null,
    purchaseDate: plan.purchaseDate ?? null,
    originalAmount: plan.originalAmount ?? null,
    installmentAmount: plan.installmentAmount ?? null,
    installmentNumber: plan.installmentNumber ?? null,
    installmentCount: plan.installmentCount ?? null,
    remainingAmount: plan.remainingAmount ?? null,
    currency: plan.currency,
    sourceRowNumber: plan.sourceRowNumber ?? null,
    position: plan.position,
  }));
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const asNumber = (value: unknown) => (value == null ? 0 : Number(value));

/** Counts and amounts only: safe to print (no merchant names or identifiers). */
export function summarizeBackfillPlans(
  plans: Prisma.StatementFinancingPlanCreateManyInput[],
) {
  return {
    planCount: plans.length,
    totalRemainingAmount: round2(
      plans.reduce((sum, plan) => sum + asNumber(plan.remainingAmount), 0),
    ),
    totalInstallmentAmount: round2(
      plans.reduce((sum, plan) => sum + asNumber(plan.installmentAmount), 0),
    ),
    plans: plans.map((plan) => ({
      installment: `${plan.installmentNumber ?? "?"}/${plan.installmentCount ?? "?"}`,
      originalAmount:
        plan.originalAmount == null ? null : asNumber(plan.originalAmount),
      remainingAmount:
        plan.remainingAmount == null ? null : asNumber(plan.remainingAmount),
      installmentAmount:
        plan.installmentAmount == null
          ? null
          : asNumber(plan.installmentAmount),
    })),
  };
}
