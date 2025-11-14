/**
 * Utility helpers that convert between camelCase runtime objects and legacy snake_case wire payloads.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type KeyTransform = (key: string) => string;

/** Converts snake_case keys to camelCase recursively. */
export function decodeWire<T>(wire: T): T {
  return transformKeys(wire, snakeToCamel) as T;
}

/** Converts camelCase keys to snake_case recursively. */
export function encodeWire<T>(camel: T): T {
  return transformKeys(camel, camelToSnake) as T;
}

function transformKeys(value: unknown, transform: KeyTransform): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => transformKeys(entry, transform));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[transform(key)] = transformKeys(entry, transform);
    }
    return result;
  }
  return value;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}
