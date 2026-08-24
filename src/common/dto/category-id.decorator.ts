import { IsUUID } from "class-validator";

/**
 * Category IDs are UUID-shaped database identifiers. Older records were
 * generated from an MD5 digest and therefore do not have RFC version/variant
 * bits, but are still valid identifiers for compatibility purposes.
 */
export function IsCategoryId() {
  return IsUUID("loose");
}
