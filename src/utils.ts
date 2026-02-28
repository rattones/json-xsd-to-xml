import type { JsonObject, JsonValue } from './types.js';

/**
 * Case-insensitive property lookup on a JsonObject.
 *
 * First tries an exact match (O(1), zero overhead for inputs that already use
 * the correct casing). If that returns `undefined`, scans the object keys for
 * a case-insensitive match and returns the first hit.
 *
 * The caller should always use the *schema name* (not the matched JSON key) when
 * emitting XML, so the output casing always mirrors the XSD/WSDL declaration.
 *
 * @param obj  - The JSON object to search.
 * @param name - The canonical name from the schema (e.g. `"CNPJ"`, `"cnpjContratado"`).
 * @returns The value associated with the matching key, or `undefined` if none found.
 */
export function lookupCI(obj: JsonObject, name: string): JsonValue | undefined {
  // Fast path: exact match
  if (Object.prototype.hasOwnProperty.call(obj, name)) {
    return obj[name];
  }

  // Slow path: case-insensitive scan
  const lower = name.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) {
      return obj[key];
    }
  }

  return undefined;
}

/**
 * Returns a Set of the lowercased versions of the provided names.
 * Useful for O(1) case-insensitive membership checks.
 */
export function lowerSet(names: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const n of names) s.add(n.toLowerCase());
  return s;
}
