import { ValidationPipe } from "@nestjs/common";
import {
  ConfirmDetectedPurchaseDto,
  QueryDetectedPurchasesDto,
  SyncDetectedPurchasesDto,
} from "./detected-purchase.dto";
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const purchase = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  fingerprint: "fp",
  sourcePackage: "bank",
  amountCents: 123,
  currency: "MXN",
  merchant: null,
  occurredAtMillis: 1,
  confidence: "HIGH",
  mayBeRegistered: false,
};
const sync = (value: unknown) =>
  pipe.transform(value, { type: "body", metatype: SyncDetectedPurchasesDto });
describe("Detected purchase request validation", () => {
  it("accepts the wire contract with nullable merchant and duplicate", async () => {
    await expect(
      sync({ purchases: [{ ...purchase, possibleDuplicateOf: null }] }),
    ).resolves.toBeDefined();
  });
  it.each([
    { amountCents: 0 },
    { amountCents: 0.5 },
    { amountCents: Number.MAX_SAFE_INTEGER },
    { occurredAtMillis: -1 },
    { currency: "mxn" },
    { confidence: "UNKNOWN" },
    { id: "not-uuid" },
    { mayBeRegistered: "false" },
    { rawText: "private" },
    { type: "DEPOSIT" },
    { status: "CONFIRMED" },
  ])("rejects invalid or extra purchase fields %p", async (fields) => {
    await expect(
      sync({ purchases: [{ ...purchase, ...fields }] }),
    ).rejects.toThrow();
  });
  it("rejects unknown envelope fields and excessive batch", async () => {
    await expect(
      sync({ purchases: [purchase], userId: "other" }),
    ).rejects.toThrow();
    await expect(
      sync({ purchases: Array(101).fill(purchase) }),
    ).rejects.toThrow();
  });
  it("rejects missing or invalid nested expenses", async () => {
    for (const value of [
      {},
      { expense: null },
      { expense: {} },
      { expense: { title: "Coffee", cost: -1 } },
      { expense: { title: "Coffee", cost: 1, userId: "other" } },
    ]) {
      await expect(
        pipe.transform(value, {
          type: "body",
          metatype: ConfirmDetectedPurchaseDto,
        }),
      ).rejects.toThrow();
    }
  });
  it("bounds pagination", async () => {
    for (const query of [{ limit: "101" }, { page: "0" }, { status: "ALL" }])
      await expect(
        pipe.transform(query, {
          type: "query",
          metatype: QueryDetectedPurchasesDto,
        }),
      ).rejects.toThrow();
  });
});
