const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseOptions, buildFixtures, seed } = require("./seed-inbox-demo.cjs");
const validEnv = {
  DATABASE_URL_DOCKER:
    "postgresql://fixture:fixture@host.docker.internal:5432/budgetapp?schema=public",
};
test("requires exact target account and refuses ambient DATABASE_URL fallback", () => {
  assert.throws(() => parseOptions([], validEnv), /exact target email/);
  assert.throws(
    () => parseOptions(["--email", "*"], validEnv),
    /exact target email/,
  );
  assert.throws(
    () =>
      parseOptions(["--email", "demo@example.com"], {
        DATABASE_URL: validEnv.DATABASE_URL_DOCKER,
      }),
    /DATABASE_URL_DOCKER/,
  );
});
test("rejects remote, wrong database, unsafe schema, and libpq host overrides before any connection", () => {
  for (const url of [
    "postgresql://fixture@remote.example.com/budgetapp",
    "postgresql://fixture@127.0.0.1/production",
    "postgresql://fixture@localhost/budgetapp?host=remote.example.com",
    "postgresql://fixture@localhost/budgetapp?schema=private",
    "http://localhost/budgetapp",
  ]) {
    assert.throws(
      () =>
        parseOptions(["--email", "demo@example.com"], {
          DATABASE_URL_DOCKER: url,
        }),
      /Refusing/,
    );
  }
});
test("accepts exact email and maps only local Docker hostname", () => {
  const result = parseOptions(
    ["--email", "demo@example.com", "--dry-run"],
    validEnv,
  );
  assert.equal(result.email, "demo@example.com");
  assert.equal(result.dryRun, true);
  assert.equal(new URL(result.databaseUrl).hostname, "127.0.0.1");
});
test("fixtures are stable, owner-scoped, bounded pending purchases with varied warnings", () => {
  const rows = buildFixtures("owner", 1800000000000);
  assert.equal(rows.length, 24);
  assert.equal(new Set(rows.map((row) => row.fingerprint)).size, 24);
  assert.deepEqual(rows, buildFixtures("owner", 1800000000000));
  assert.notEqual(rows[0].id, buildFixtures("other", 1800000000000)[0].id);
  assert(
    rows.every(
      (row) =>
        row.userId === "owner" &&
        row.status === "PENDING" &&
        row.merchant.startsWith("TEST — ") &&
        row.amountCents > 0n,
    ),
  );
  assert.equal(new Set(rows.map((row) => row.confidence)).size, 3);
  assert.equal(new Set(rows.map((row) => row.currency)).size, 2);
  assert(rows.some((row) => row.possibleDuplicateOf));
  assert(rows.some((row) => row.mayBeRegistered));
});
test("missing or wrong exact email never writes", async () => {
  for (const user of [
    null,
    { id: "owner", email: "another@example.com", isActive: true },
  ]) {
    await assert.rejects(
      seed(
        {
          user: { findUnique: async () => user },
          $transaction: () => assert.fail("must not write"),
        },
        { email: "demo@example.com" },
      ),
      /exactly matches/,
    );
  }
});
test("dry run only counts owner fixtures and never writes", async () => {
  const db = {
    user: {
      findUnique: async () => ({
        id: "owner",
        email: "demo@example.com",
        isActive: true,
        deletedAt: null,
      }),
    },
    detectedPurchase: {
      count: async ({ where }) => {
        assert.equal(where.userId, "owner");
        return where.status ? 2 : 4;
      },
    },
    $transaction: () => assert.fail("must not write"),
  };
  assert.deepEqual(
    await seed(db, { email: "demo@example.com", dryRun: true }),
    {
      email: "demo@example.com",
      dryRun: true,
      wouldCreate: 20,
      skipped: 4,
      remaining: 2,
    },
  );
});
test("seed inserts once, skips terminal rows, and never updates existing records", async () => {
  const existing = new Map([
    ["panel-inbox-demo:v1:0", { status: "CONFIRMED" }],
    ["panel-inbox-demo:v1:1", { status: "DISCARDED" }],
  ]);
  const tx = {
    detectedPurchase: {
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true);
        let count = 0;
        for (const row of data) {
          if (!existing.has(row.fingerprint)) {
            existing.set(row.fingerprint, row);
            count++;
          }
        }
        return { count };
      },
      count: async () =>
        [...existing.values()].filter((row) => row.status === "PENDING").length,
    },
  };
  const db = {
    user: {
      findUnique: async () => ({
        id: "owner",
        email: "demo@example.com",
        isActive: true,
        deletedAt: null,
      }),
    },
    $transaction: async (action) => action(tx),
  };
  assert.deepEqual(await seed(db, { email: "demo@example.com" }), {
    email: "demo@example.com",
    dryRun: false,
    created: 22,
    skipped: 2,
    remaining: 22,
  });
  assert.deepEqual(await seed(db, { email: "demo@example.com" }), {
    email: "demo@example.com",
    dryRun: false,
    created: 0,
    skipped: 24,
    remaining: 22,
  });
  assert.equal(existing.get("panel-inbox-demo:v1:0").status, "CONFIRMED");
  assert.equal(existing.get("panel-inbox-demo:v1:1").status, "DISCARDED");
});
