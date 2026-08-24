import { validate } from "class-validator";
import { CreateSubscriptionDto } from "./create-subscription.dto";

describe("categoryId validation", () => {
  const validateCategoryId = async (categoryId: string | null | undefined) => {
    const dto = Object.assign(new CreateSubscriptionDto(), {
      name: "Test subscription",
      cost: 100,
      billingCycle: "MONTHLY",
      nextPaymentDate: "2099-01-01T00:00:00.000Z",
      categoryId,
    });
    return validate(dto);
  };

  it("accepts RFC UUIDs and legacy UUID-shaped MD5 values", async () => {
    await expect(
      validateCategoryId("550e8400-e29b-41d4-a716-446655440000"),
    ).resolves.toHaveLength(0);
    await expect(
      validateCategoryId("01234567-89ab-cdef-0123-456789abcdef"),
    ).resolves.toHaveLength(0);
  });

  it.each(["Bills", "Suscripción", "not-an-id"])(
    "rejects non-UUID category value %s",
    async (categoryId) => {
      const errors = await validateCategoryId(categoryId);
      expect(errors.some((error) => error.property === "categoryId")).toBe(
        true,
      );
    },
  );

  it("allows null and undefined for the PATCH contract", async () => {
    await expect(validateCategoryId(null)).resolves.toHaveLength(0);
    await expect(validateCategoryId(undefined)).resolves.toHaveLength(0);
  });
});
