/**
 * Ontology helpers shared between schema validation and persistence layers.
 */

export const ENTITY_TYPES = ["product", "article", "person", "brand", "unknown"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RELATION_TYPES = ["mentions", "authoredBy", "about", "sameAs"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export interface NormalizeEntityInput {
  url?: string;
  title?: string;
  text?: string;
}

export interface NormalizedEntity {
  entityType: EntityType;
  conceptIds: string[];
}

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && ENTITY_TYPES.includes(value as EntityType);
}

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === "string" && RELATION_TYPES.includes(value as RelationType);
}

/**
 * Produces a best-effort entity classification and canonical concept identifiers.
 */
export function normalizeEntity(input: NormalizeEntityInput): NormalizedEntity {
  const conceptIds = new Set<string>();
  let entityType: EntityType = "unknown";

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
  } else if (host && /(blog|news|medium|substack)/i.test(host)) {
    entityType = "article";
  } else if (title.includes("guide") || title.includes("how to")) {
    entityType = "article";
  } else if (host && /(linkedin|twitter|x\.com)/i.test(host)) {
    entityType = "person";
  } else if (title.includes("inc") || title.includes("corp")) {
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

function safeHostname(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function canonicalizeUrl(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }
  try {
    const url = new URL(input);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
