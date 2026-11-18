import { BadRequestException } from "@nestjs/common";

export const NUTRITION_COMMAND_ERROR =
  "This change could not be saved. Refresh and verify the selected diet, recipe and permissions.";

/**
 * SQLSTATE classes that mean "the request was invalid" rather than "the
 * database is unhealthy": P0001 (RAISE EXCEPTION), 22xxx (data exception) and
 * 23xxx (integrity constraint violation).
 */
const CLIENT_SQLSTATE = /^(P0001|22[0-9A-Z]{3}|23[0-9A-Z]{3})$/;

function collectSqlStates(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== "object" || depth > 4) return [];
  const record = error as Record<string, unknown>;
  const found: string[] = [];
  for (const key of ["originalCode", "sqlState", "code"]) {
    if (typeof record[key] === "string") found.push(record[key]);
  }
  for (const key of ["meta", "driverAdapterError", "cause"]) {
    found.push(...collectSqlStates(record[key], depth + 1));
  }
  if (typeof record.message === "string") {
    const match = /\b(P0001|22[0-9A-Z]{3}|23[0-9A-Z]{3})\b/.exec(
      record.message,
    );
    if (match) found.push(match[1]);
  }
  return found;
}

export function isClientDatabaseError(error: unknown): boolean {
  return collectSqlStates(error).some((state) => CLIENT_SQLSTATE.test(state));
}

/** Maps client-caused database failures to a generic 400; rethrows the rest. */
export function mapNutritionDatabaseError(error: unknown): never {
  if (isClientDatabaseError(error)) {
    throw new BadRequestException(NUTRITION_COMMAND_ERROR);
  }
  throw error;
}
