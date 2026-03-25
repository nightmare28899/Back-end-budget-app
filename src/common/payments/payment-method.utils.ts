import { PaymentMethod } from "@prisma/client";

export const PAYMENT_METHOD_VALUES = [
  "CASH",
  "CREDIT_CARD",
  "DEBIT_CARD",
  "TRANSFER",
] as const;

export function normalizePaymentMethod(
  value?: string | PaymentMethod | null,
): PaymentMethod | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = String(value).trim().toUpperCase();

  switch (normalized) {
    case "CARD":
    case "CREDIT_CARD":
      return PaymentMethod.CREDIT_CARD;
    case "DEBIT_CARD":
      return PaymentMethod.DEBIT_CARD;
    case "TRANSFER":
      return PaymentMethod.TRANSFER;
    case "CASH":
      return PaymentMethod.CASH;
    default:
      return undefined;
  }
}

export function isCreditCardPaymentMethod(
  value?: string | PaymentMethod | null,
): boolean {
  return normalizePaymentMethod(value) === PaymentMethod.CREDIT_CARD;
}
