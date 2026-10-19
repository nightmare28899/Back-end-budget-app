const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const databaseUrl = process.env.DETECTED_PURCHASE_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set DETECTED_PURCHASE_TEST_DATABASE_URL explicitly to a disposable local inbox_test database",
  );
const target = new URL(databaseUrl);
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  !/^\/inbox_test(?:_[a-z0-9]+)?$/.test(target.pathname) ||
  [...target.searchParams.keys()].some(
    (key) => !["schema", "sslmode"].includes(key),
  )
) {
  throw new Error(
    "Refusing non-local or non-disposable test database; use localhost and database inbox_test or inbox_test_suffix",
  );
}
// PrismaService must see the explicitly gated URL, never ambient DATABASE_URL.
process.env.DATABASE_URL = databaseUrl;
const backend = path.resolve(__dirname, "..");
require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  project: path.join(backend, "tsconfig.json"),
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    resolvePackageJsonExports: false,
    resolvePackageJsonImports: false,
  },
});
const { PrismaService } = require(backend + "/src/prisma/prisma.service.ts");
const { ExpensesService } = require(
  backend + "/src/expenses/expenses.service.ts",
);
const { CreditCardsService } = require(
  backend + "/src/credit-cards/credit-cards.service.ts",
);
const { EntitlementsService } = require(
  backend + "/src/common/entitlements/entitlements.service.ts",
);
const { DetectedPurchasesService } = require(
  backend + "/src/detected-purchases/detected-purchases.service.ts",
);

async function main() {
  const db = new PrismaService();
  await db.$connect();
  const entitlements = new EntitlementsService(db);
  const cards = new CreditCardsService(db, entitlements);
  const expenses = new ExpensesService(db, {}, cards, entitlements, {});
  const inbox = new DetectedPurchasesService(db, expenses);
  const users = [];
  const purchase = (fingerprint = randomUUID()) => ({
    id: randomUUID(),
    fingerprint,
    sourcePackage: "test.bank",
    amountCents: 12345,
    currency: "MXN",
    merchant: "Inbox integration fixture",
    occurredAtMillis: Date.now(),
    confidence: "HIGH",
    possibleDuplicateOf: null,
    mayBeRegistered: false,
  });
  try {
    for (let index = 0; index < 2; index++)
      users.push(
        await db.user.create({
          data: {
            name: "Inbox fixture",
            email: `inbox-${randomUUID()}@example.invalid`,
            password: "not-a-login-password",
            isPremium: true,
          },
        }),
      );
    const [owner, other] = users;
    const category = await db.category.create({
      data: { userId: owner.id, name: "Inbox fixture" },
    });
    const draft = {
      title: "Accepted fixture",
      cost: 123.45,
      currency: "MXN",
      categoryId: category.id,
      paymentMethod: "CASH",
    };
    const shared = purchase();
    const syncs = await Promise.all(
      Array.from({ length: 6 }, () =>
        inbox.sync(owner.id, { purchases: [{ ...shared, id: randomUUID() }] }),
      ),
    );
    const row = syncs[0].purchases[0];
    assert(syncs.every((result) => result.purchases[0].id === row.id));
    assert.equal(
      await db.detectedPurchase.count({ where: { userId: owner.id } }),
      1,
    );
    console.log("PASS concurrent uploads deduplicate by owner/fingerprint");
    await assert.rejects(
      inbox.confirm(other.id, row.id, { expense: draft }),
      (error) => error.getStatus() === 404,
    );
    await assert.rejects(
      inbox.discard(other.id, row.id),
      (error) => error.getStatus() === 404,
    );
    assert.equal((await inbox.list(other.id, {})).pagination.totalCount, 0);
    console.log("PASS cross-owner access blocked");
    const confirmed = await Promise.all(
      Array.from({ length: 6 }, () =>
        inbox.confirm(owner.id, row.id, { expense: draft }),
      ),
    );
    assert(
      confirmed.every((result) => result.expenseId === confirmed[0].expenseId),
    );
    assert.equal(await db.expense.count({ where: { userId: owner.id } }), 1);
    assert.equal(
      (await inbox.sync(owner.id, { purchases: [shared] })).purchases[0].status,
      "CONFIRMED",
    );
    console.log(
      "PASS concurrent confirmation + retry creates one expense, stale upload cannot reopen",
    );
    const discarded = (await inbox.sync(owner.id, { purchases: [purchase()] }))
      .purchases[0];
    await inbox.discard(owner.id, discarded.id);
    await inbox.discard(owner.id, discarded.id);
    await assert.rejects(
      inbox.confirm(owner.id, discarded.id, { expense: draft }),
      (error) => error.getStatus() === 409,
    );
    console.log("PASS discard idempotence and confirm conflict");
    const invalid = (await inbox.sync(owner.id, { purchases: [purchase()] }))
      .purchases[0];
    const otherCategory = await db.category.create({
      data: { userId: other.id, name: "Other owner fixture" },
    });
    await assert.rejects(
      inbox.confirm(owner.id, invalid.id, {
        expense: { ...draft, categoryId: otherCategory.id },
      }),
      (error) => error.getStatus() === 404,
    );
    assert.equal(
      (await db.detectedPurchase.findUnique({ where: { id: invalid.id } }))
        .status,
      "PENDING",
    );
    assert.equal(await db.expense.count({ where: { userId: owner.id } }), 1);
    console.log(
      "PASS rejected category leaves purchase pending and expense count unchanged",
    );
    const rollbackRow = (
      await inbox.sync(owner.id, { purchases: [purchase()] })
    ).purchases[0];
    const failingInbox = new DetectedPurchasesService(db, {
      createInTransaction: async (userId, dto, tx) => {
        await expenses.createInTransaction(userId, dto, tx);
        throw new Error("injected failure after expense write");
      },
    });
    await assert.rejects(
      failingInbox.confirm(owner.id, rollbackRow.id, { expense: draft }),
      /injected failure/,
    );
    assert.equal(await db.expense.count({ where: { userId: owner.id } }), 1);
    assert.equal(
      (await db.detectedPurchase.findUnique({ where: { id: rollbackRow.id } }))
        .status,
      "PENDING",
    );
    console.log(
      "PASS real transaction rolls back expense on post-create failure",
    );
    const race = (await inbox.sync(owner.id, { purchases: [purchase()] }))
      .purchases[0];
    const outcomes = await Promise.allSettled([
      inbox.confirm(owner.id, race.id, { expense: draft }),
      inbox.discard(owner.id, race.id),
    ]);
    const final = await db.detectedPurchase.findUnique({
      where: { id: race.id },
    });
    assert.equal(
      outcomes.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      await db.expense.count({ where: { userId: owner.id } }),
      final.status === "CONFIRMED" ? 2 : 1,
    );
    console.log("PASS confirm/discard race has one terminal winner");
    const card = await db.creditCard.create({
      data: {
        userId: owner.id,
        name: "Test card",
        bank: "Fixture",
        brand: "VISA",
        last4: "1234",
        currency: "MXN",
      },
    });
    const installments = (
      await inbox.sync(owner.id, { purchases: [purchase()] })
    ).purchases[0];
    const installmentDraft = {
      ...draft,
      title: "Installment fixture",
      cost: 300,
      paymentMethod: "CREDIT_CARD",
      creditCardId: card.id,
      isInstallment: true,
      installmentCount: 3,
      installmentFrequency: "MONTHLY",
      installmentPurchaseDate: "2026-10-18",
      installmentFirstPaymentDate: "2026-10-18",
    };
    await Promise.all([
      inbox.confirm(owner.id, installments.id, { expense: installmentDraft }),
      inbox.confirm(owner.id, installments.id, { expense: installmentDraft }),
    ]);
    assert.equal(
      await db.expense.count({
        where: { userId: owner.id, title: "Installment fixture" },
      }),
      3,
    );
    console.log(
      "PASS installment approval uses same transaction and one schedule",
    );
  } finally {
    await db.user.deleteMany({
      where: { id: { in: users.map((user) => user.id) } },
    });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
