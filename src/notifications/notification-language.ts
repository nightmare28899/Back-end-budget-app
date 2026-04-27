export const NOTIFICATION_LANGUAGE_VALUES = ["en", "es"] as const;

export type NotificationLanguage =
  (typeof NOTIFICATION_LANGUAGE_VALUES)[number];

export function coerceNotificationLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith("es")) {
    return "es";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return normalized;
}

export function normalizeNotificationLanguage(
  value: string | null | undefined,
): NotificationLanguage {
  return coerceNotificationLanguage(value) === "es" ? "es" : "en";
}
