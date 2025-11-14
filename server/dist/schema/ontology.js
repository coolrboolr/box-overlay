"use strict";
/**
 * Ontology helpers shared between schema validation and persistence layers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELATION_TYPES = exports.ENTITY_TYPES = void 0;
exports.isEntityType = isEntityType;
exports.isRelationType = isRelationType;
exports.normalizeEntity = normalizeEntity;
exports.ENTITY_TYPES = ["product", "article", "person", "brand", "unknown"];
exports.RELATION_TYPES = ["mentions", "authoredBy", "about", "sameAs"];
function isEntityType(value) {
    return typeof value === "string" && exports.ENTITY_TYPES.includes(value);
}
function isRelationType(value) {
    return typeof value === "string" && exports.RELATION_TYPES.includes(value);
}
/**
 * Produces a best-effort entity classification and canonical concept identifiers.
 */
function normalizeEntity(input) {
    const conceptIds = new Set();
    let entityType = "unknown";
    const host = safeHostname(input.url);
    const title = input.title?.toLowerCase() ?? "";
    const text = input.text?.toLowerCase() ?? "";
    if (host) {
        conceptIds.add(`url:${host}`);
    }
    const canonicalUrl = canonicalizeUrl(input.url);
    if (canonicalUrl) {
        conceptIds.add(`canonical:${canonicalUrl}`);
    }
    if (title) {
        conceptIds.add(`title:${slugify(title).slice(0, 64)}`);
    }
    if (text.includes("product") || /buy now|pricing|sku/i.test(input.text ?? "")) {
        entityType = "product";
    }
    else if (host && /(blog|news|medium|substack)/i.test(host)) {
        entityType = "article";
    }
    else if (title.includes("guide") || title.includes("how to")) {
        entityType = "article";
    }
    else if (host && /(linkedin|twitter|x\.com)/i.test(host)) {
        entityType = "person";
    }
    else if (title.includes("inc") || title.includes("corp")) {
        entityType = "brand";
    }
    if (conceptIds.size === 0 && title) {
        conceptIds.add(`freetext:${title}`);
    }
    return {
        entityType,
        conceptIds: Array.from(conceptIds).filter(Boolean)
    };
}
function safeHostname(input) {
    if (!input) {
        return undefined;
    }
    try {
        const url = new URL(input.includes("://") ? input : `https://${input}`);
        return url.hostname.toLowerCase();
    }
    catch {
        return undefined;
    }
}
function canonicalizeUrl(input) {
    if (!input) {
        return undefined;
    }
    try {
        const url = new URL(input);
        url.hash = "";
        url.search = "";
        return url.toString();
    }
    catch {
        return undefined;
    }
}
function slugify(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
//# sourceMappingURL=ontology.js.map