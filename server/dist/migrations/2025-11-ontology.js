"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLegacyMemoryFile = migrateLegacyMemoryFile;
const node_crypto_1 = __importDefault(require("node:crypto"));
const schema_1 = require("../schema");
function migrateLegacyMemoryFile(legacy, options) {
    const migratedItems = legacy.items.map((item) => ({
        id: item.id,
        parentId: item.parentId,
        sourceId: item.sourceId,
        text: item.text,
        snippet: createSnippet(item.snippet ?? item.text),
        vector: item.vector,
        contentHash: computeContentHash(item.text, item.url, "unknown"),
        duplicateOf: undefined,
        url: item.url,
        sourceDomain: item.url ? safeHostname(item.url) : null,
        title: item.title,
        contentType: item.contentType,
        capturedAt: item.capturedAt,
        language: item.language,
        entityType: "unknown",
        conceptIds: [],
        relations: [],
        tags: [],
        image: normalizeLegacyImage(item),
        createdAt: item.createdAt,
        embedModelVersion: options.embedModelVersion,
        embedDimensions: legacy.vectorLength
    }));
    return {
        schemaVersion: schema_1.MEMORY_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        vectorLength: legacy.vectorLength,
        embedModelVersion: options.embedModelVersion,
        dedupKey: options.dedupKey,
        compactions: 0,
        items: migratedItems
    };
}
function normalizeLegacyImage(item) {
    if (item.imageTag) {
        return { kind: "tag", tag: item.imageTag };
    }
    if (item.imageData) {
        const dataUri = item.imageData.startsWith("data:")
            ? item.imageData
            : `data:image/png;base64,${item.imageData}`;
        return { kind: "dataUri", data: dataUri };
    }
    return undefined;
}
function safeHostname(input) {
    if (!input) {
        return null;
    }
    try {
        const normalized = input.includes("://") ? input : `https://${input}`;
        const url = new URL(normalized);
        return url.hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
function createSnippet(text, maxLength = 280) {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength).trim()}...`;
}
function computeContentHash(text, url, entityType) {
    const hash = node_crypto_1.default.createHash("sha256");
    hash.update(text.trim());
    hash.update("::");
    hash.update(url ?? "");
    hash.update("::");
    hash.update(entityType ?? "");
    return hash.digest("hex");
}
//# sourceMappingURL=2025-11-ontology.js.map