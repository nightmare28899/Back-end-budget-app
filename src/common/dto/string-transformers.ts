export function trimStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function trimLowerCaseStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function trimUpperCaseStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}
