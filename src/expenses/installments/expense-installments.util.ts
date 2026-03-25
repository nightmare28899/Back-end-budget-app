export const INSTALLMENT_FREQUENCY_VALUES = ["MONTHLY"] as const;

export type InstallmentFrequencyValue =
  (typeof INSTALLMENT_FREQUENCY_VALUES)[number];

type InstallmentScheduleInput = {
  totalAmount: number;
  installmentCount: number;
  firstPaymentDate: Date;
};

export type InstallmentScheduleItem = {
  installmentIndex: number;
  amount: number;
  paymentDate: Date;
};

export function buildInstallmentSchedule(
  input: InstallmentScheduleInput,
): InstallmentScheduleItem[] {
  const count = Math.trunc(input.installmentCount);
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0) {
    throw new Error("totalAmount must be greater than 0");
  }
  if (!Number.isFinite(count) || count <= 1) {
    throw new Error("installmentCount must be greater than 1");
  }

  const amounts = splitAmountAcrossInstallments(input.totalAmount, count);
  return amounts.map((amount, index) => ({
    installmentIndex: index + 1,
    amount,
    paymentDate: addMonthsClamped(input.firstPaymentDate, index),
  }));
}

export function splitAmountAcrossInstallments(
  totalAmount: number,
  installmentCount: number,
): number[] {
  const totalCents = toMoneyCents(totalAmount);
  const count = Math.trunc(installmentCount);
  const baseAmountCents = Math.floor(totalCents / count);
  const lastAmountCents = totalCents - baseAmountCents * (count - 1);

  return Array.from({ length: count }, (_, index) =>
    fromMoneyCents(index === count - 1 ? lastAmountCents : baseAmountCents),
  );
}

function addMonthsClamped(value: Date, monthsToAdd: number): Date {
  const source = new Date(value);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const hours = source.getUTCHours();
  const minutes = source.getUTCMinutes();
  const seconds = source.getUTCSeconds();
  const milliseconds = source.getUTCMilliseconds();

  const targetMonthIndex = month + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(day, lastDayOfTargetMonth),
      hours,
      minutes,
      seconds,
      milliseconds,
    ),
  );
}

function toMoneyCents(value: number): number {
  return Math.round(value * 100);
}

function fromMoneyCents(value: number): number {
  return value / 100;
}
