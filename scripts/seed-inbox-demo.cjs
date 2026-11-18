const { createHash } = require("node:crypto");

function parseOptions(args, env) {
  let email = env.INBOX_DEMO_EMAIL;
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--email" && args[index + 1]) email = args[++index];
    else if (args[index] === "--dry-run") dryRun = true;
    else
      throw new Error(
        "Usage: seed:inbox:demo -- --email exact@example.com [--dry-run]",
      );
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(
      "An exact target email is required via --email or INBOX_DEMO_EMAIL",
    );
  }
  if (!env.DATABASE_URL_DOCKER)
    throw new Error(
      "DATABASE_URL_DOCKER must explicitly identify the local budgetapp database",
    );
  const target = new URL(env.DATABASE_URL_DOCKER);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["host.docker.internal", "localhost", "127.0.0.1", "[::1]"].includes(
      target.hostname,
    ) ||
    target.pathname !== "/budgetapp" ||
    [...target.searchParams.keys()].some(
      (key) => !["schema", "sslmode"].includes(key),
    ) ||
    (target.searchParams.has("schema") &&
      target.searchParams.get("schema") !== "public")
  ) {
    throw new Error(
      "Refusing non-local or unexpected database; only the local budgetapp public schema is allowed",
    );
  }
  if (target.hostname === "host.docker.internal") target.hostname = "127.0.0.1";
  return { email, dryRun, databaseUrl: target.toString() };
}

function fixtureId(userId, index) {
  const hex = createHash("sha256")
    .update(`${userId}:panel-inbox-demo:v1:${index}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function buildFixtures(userId, now = Date.now()) {
  const merchants = [
    "Grocery store",
    "Coffee shop",
    "Bookshop",
    "Restaurant",
    "Fuel station",
    "Pharmacy",
    "Cinema",
    "Online purchase",
  ];
  const amounts = [18950, 6500, 34999, 28000, 75000, 12990, 22500, 1999];
  return Array.from({ length: 24 }, (_, index) => ({
    id: fixtureId(userId, index),
    userId,
    fingerprint: `panel-inbox-demo:v1:${index}`,
    sourcePackage: "test.panel.inbox.demo",
    amountCents: BigInt(amounts[index % amounts.length]),
    currency: index % 6 === 5 ? "USD" : "MXN",
    merchant: `TEST — ${merchants[index % merchants.length]} ${index + 1}`,
    occurredAtMillis: BigInt(now - index * 3 * 60 * 60 * 1000),
    confidence: ["HIGH", "MEDIUM", "LOW"][index % 3],
    possibleDuplicateOf:
      index > 0 && index % 5 === 0 ? fixtureId(userId, index - 1) : null,
    mayBeRegistered: index % 4 === 0,
    status: "PENDING",
  }));
}

async function seed(db, options) {
  const user = await db.user.findUnique({
    where: { email: options.email },
    select: { id: true, email: true, isActive: true, deletedAt: true },
  });
  if (!user || user.email !== options.email)
    throw new Error(
      "No account exactly matches the supplied email; nothing was written",
    );
  if (!user.isActive || user.deletedAt)
    throw new Error("Target account is inactive; nothing was written");
  const fixtures = buildFixtures(user.id);
  const where = {
    userId: user.id,
    fingerprint: { in: fixtures.map((item) => item.fingerprint) },
  };
  if (options.dryRun) {
    const existing = await db.detectedPurchase.count({ where });
    return {
      email: user.email,
      dryRun: true,
      wouldCreate: fixtures.length - existing,
      skipped: existing,
      remaining: await db.detectedPurchase.count({
        where: { ...where, status: "PENDING" },
      }),
    };
  }
  return db.$transaction(async (tx) => {
    const { count: created } = await tx.detectedPurchase.createMany({
      data: fixtures,
      skipDuplicates: true,
    });
    return {
      email: user.email,
      dryRun: false,
      created,
      skipped: fixtures.length - created,
      remaining: await tx.detectedPurchase.count({
        where: { ...where, status: "PENDING" },
      }),
    };
  });
}

async function main() {
  require("dotenv").config({ quiet: true });
  const options = parseOptions(process.argv.slice(2), process.env);
  const { PrismaClient } = require("@prisma/client");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: options.databaseUrl }),
  });
  try {
    console.log(JSON.stringify(await seed(db, options), null, 2));
  } finally {
    await db.$disconnect();
  }
}

module.exports = { parseOptions, buildFixtures, seed };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
