/**
 * Local copy of ontology enums for the extension bundle.
 * Keep in sync with server/src/schema/ontology.ts when backend evolves.
 */
export const ENTITY_TYPES = ["product", "article", "person", "brand", "unknown"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RELATION_TYPES = ["mentions", "authoredBy", "about", "sameAs"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
