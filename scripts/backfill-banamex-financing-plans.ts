/**
 * One-off backfill: replace the financing plans of a Banamex statement import
 * with the plans parsed from its original PDF (multi-line installment tables).
 *
 * Usage (from the backend root):
 *   npm run backfill:banamex-plans -- --statement-import-id <id> --pdf <path> [--dry-run]
 *
 * Database URL: read from DATABASE_URL (.env). If it points at
 * host.docker.internal the host is rewritten to localhost; set
 * BACKFILL_DATABASE_URL to override it entirely.
 *
 * What it does, in ONE transaction: detaches this import's statement rows from
 * their plans (financingPlanId = null), deletes the import's existing plans and
 * inserts the parsed ones. It never touches other row fields, expenses,
 * payments, reconciliation or payment targets. --dry-run only reads.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PdfTextExtractor } from "../src/card-statements/extractors/pdf-text.extractor";
import { BanamexStatementParser } from "../src/card-statements/parsers/banamex/banamex-statement.parser";
import {
  BanamexBackfillError,
  buildBanamexFinancingPlanBackfill,
  sha256Hex,
  summarizeBackfillPlans,
} from "../src/card-statements/banamex-financing-plan-backfill";

function parseArgs(argv: string[]) {
  const args = { importId: "", pdf: "", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--statement-import-id") args.importId = argv[++i] ?? "";
    else if (arg === "--pdf") args.pdf = argv[++i] ?? "";
    else if (arg === "--dry-run") args.dryRun = true;
    else throw new BanamexBackfillError(`Unknown argument: ${arg}`);
  }
  if (!args.importId || !args.pdf) {
    throw new BanamexBackfillError(
      "Usage: --statement-import-id <id> --pdf <path> [--dry-run]",
    );
  }
  return args;
}

function resolveDatabaseUrl() {
  const url = process.env.BACKFILL_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new BanamexBackfillError(
      "DATABASE_URL (or BACKFILL_DATABASE_URL) is not defined",
    );
  }
  return process.env.BACKFILL_DATABASE_URL
    ? url
    : url.replace("host.docker.internal", "localhost");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const statementImport = await prisma.statementImport.findUnique({
      where: { id: args.importId },
      select: {
        id: true,
        sourceSha256: true,
        periodStart: true,
        periodEnd: true,
        instruments: { select: { id: true, position: true } },
      },
    });
    if (!statementImport) {
      throw new BanamexBackfillError("Statement import not found");
    }

    const buffer = readFileSync(args.pdf);
    const extracted = await new PdfTextExtractor().extract(buffer);
    const parser = new BanamexStatementParser();
    if (!parser.canParse(extracted)) {
      throw new BanamexBackfillError("The PDF is not a Banamex statement");
    }

    const plans = buildBanamexFinancingPlanBackfill({
      statementImport,
      pdfSha256: sha256Hex(buffer),
      parsed: parser.parse(extracted),
      instrumentSnapshots: statementImport.instruments,
    });
    console.log(
      JSON.stringify(
        { dryRun: args.dryRun, ...summarizeBackfillPlans(plans) },
        null,
        2,
      ),
    );

    if (args.dryRun) {
      console.log("Dry run: nothing was written.");
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const detached = await tx.statementRow.updateMany({
        where: { statementImportId: args.importId },
        data: { financingPlanId: null },
      });
      const deleted = await tx.statementFinancingPlan.deleteMany({
        where: { statementImportId: args.importId },
      });
      const created = await tx.statementFinancingPlan.createMany({
        data: plans,
      });
      return {
        detachedRows: detached.count,
        deletedPlans: deleted.count,
        createdPlans: created.count,
      };
    });
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
