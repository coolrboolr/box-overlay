"use strict";
/**
 * Utility helpers that convert between camelCase runtime objects and legacy snake_case wire payloads.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeWire = decodeWire;
exports.encodeWire = encodeWire;
/** Converts snake_case keys to camelCase recursively. */
function decodeWire(wire) {
    return transformKeys(wire, snakeToCamel);
}
/** Converts camelCase keys to snake_case recursively. */
function encodeWire(camel) {
    return transformKeys(camel, camelToSnake);
}
function transformKeys(value, transform) {
    if (Array.isArray(value)) {
        return value.map((entry) => transformKeys(entry, transform));
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, entry] of Object.entries(value)) {
            result[transform(key)] = transformKeys(entry, transform);
        }
        return result;
    }
    return value;
}
function snakeToCamel(key) {
    return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}
function camelToSnake(key) {
    return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}
//# sourceMappingURL=wireCodec.js.map