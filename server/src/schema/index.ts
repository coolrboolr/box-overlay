/**
 * Schema invariants
 * ------------------
 * - All API objects are validated with strict Zod schemas (unknown keys rejected).
 * - Memory index/query payloads pin schemaVersion literals so rollouts stay in lockstep.
 * - Domains accept bare hostnames or full https? URLs and are normalized via safeHostname.
 * - Text payloads enforce conservative limits (analyze: 1 500 chars, memory index: LIMIT_TEXT).
 * - Image references travel through ImageRefSchema so request/response shapes stay aligned.
 * - Ontology fields (entityType, relations, conceptIds) are validated eagerly when ONTOLOGY_MODE="strict".
 */

import { z } from "zod";

import {
  ENTITY_TYPES,
  RELATION_TYPES,
  type EntityType,
  type RelationType,
  isEntityType,
  isRelationType
} from "./ontology";
import { decodeWire, encodeWire } from "./wireCodec";

export const SCHEMA_VERSION = 1 as const;
export const MEMORY_SCHEMA_VERSION = 2 as const;

const ANALYSIS_TEXT_LIMIT = 1_500;
const MEMORY_TEXT_LIMIT = parsePositiveInt(process.env.LIMIT_TEXT, 4_000);
const ACCEPT_BARE_DOMAIN = parseBoolean(process.env.ACCEPT_BARE_DOMAIN, true);
const DATA_URI_MAX_CHARS = 100 * 1024; // 100 KB upper bound
const LANGUAGE_TAG_REGEX = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
const MIME_REGEX = /^[\w.+-]+\/[\w.+-]+$/;
const TAG_REGEX = /^[A-Za-z0-9\-_/]+$/;
const HOSTNAME_REGEX = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
const COSINE_RANGE = parseCosineRange(process.env.COSINE_RANGE ?? "0-1");
const ONTOLOGY_MODE = (process.env.ONTOLOGY_MODE ?? "strict").toLowerCase() === "loose" ? "loose" : "strict";
const MAX_FILTER_RANGE_DAYS = parsePositiveInt(process.env.MEMORY_MAX_FILTER_DAYS, 90);

type OntologyMode = "strict" | "loose";

const EntityTypeSchema = buildEntityTypeSchema(ONTOLOGY_MODE);
const RelationTypeSchema = buildRelationTypeSchema(ONTOLOGY_MODE);

const HostnameOnlySchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    if (!HOSTNAME_REGEX.test(value.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value must be a valid hostname"
      });
    }
  })
  .transform((value) => value.toLowerCase());

const HostOrUrlSchema = ACCEPT_BARE_DOMAIN
  ? z
      .string()
      .min(1)
      .superRefine((value, ctx) => {
        if (value.includes("://")) {
          try {
            new URL(value);
            return;
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "domain must be a valid URL or bare hostname"
            });
            return;
          }
        }
        if (!HOSTNAME_REGEX.test(value.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "domain must be a valid hostname when scheme omitted"
          });
        }
      })
  : z.string().url({ message: "domain must be provided as a full URL" });

const LanguageTagSchema = z
  .string()
  .regex(LANGUAGE_TAG_REGEX, {
    message: "language must be a valid BCP-47 tag such as en or en-US"
  });

const MimeTypeSchema = z
  .string()
  .regex(MIME_REGEX, {
    message: "contentType must be a valid MIME type like text/html"
  });

const ConceptIdSchema = z
  .string()
  .min(1)
  .max(128, "conceptIds must be ≤128 characters");

const RelationSchema = z
  .object({
    type: RelationTypeSchema,
    targetId: z.string().min(1)
  })
  .strict();

const TagSchema = z
  .string()
  .trim()
  .min(1, { message: "tag cannot be empty" })
  .max(20, { message: "tag must be ≤20 characters" })
  .regex(TAG_REGEX, {
    message: "tag must be alphanumeric and may include - _ /"
  })
  .transform((value) => value.toLowerCase());

const UserNoteSchema = z
  .string()
  .trim()
  .max(200, { message: "note must be ≤200 characters" });

/** Unified image reference used across request/response payloads. */
export const ImageRefSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("tag"),
        tag: z.string().min(1)
      })
      .strict(),
    z
      .object({
        kind: z.literal("dataUri"),
        data: z
          .string()
          .max(DATA_URI_MAX_CHARS, "dataUri payload exceeds 100KB budget")
          .refine((value) => value.startsWith("data:"), {
            message: "dataUri must start with data:"
          })
      })
      .strict(),
    z
      .object({
        kind: z.literal("url"),
        url: z.string().url()
      })
      .strict()
  ])
  .describe("Image references are normalized by kind/tag/dataUri/url");

const OptionalImageRef = z
  .preprocess((value) => (value === undefined ? undefined : coerceImageRef(value)), ImageRefSchema)
  .optional();

const ItemSourceMetaSchema = z
  .object({
    profileName: z.string().min(1).optional(),
    anchorTag: z.string().min(1).optional(),
    anchorStrategy: z.string().min(1).optional()
  })
  .strict();

/** Strict analyze request payload used by /api/analyze. */
export const ItemAnalysisRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    id: z.string().min(1, "id is required"),
    text: z
      .string()
      .min(1, "text is required")
      .max(ANALYSIS_TEXT_LIMIT, `text exceeds ${ANALYSIS_TEXT_LIMIT} characters`),
    image: OptionalImageRef,
    sourceMeta: ItemSourceMetaSchema.optional()
  })
  .strict();

export type ItemAnalysisRequest = z.infer<typeof ItemAnalysisRequestSchema>;

/** Analyze response emitted by Ollama proxy, normalized to camelCase. */
export const ItemAnalysisResponseSchema = z
  .object({
    id: z.string().min(1),
    summary: z.string().min(1),
    image: OptionalImageRef,
    isAd: z.boolean()
  })
  .strict();

export type ItemAnalysisResponse = z.infer<typeof ItemAnalysisResponseSchema>;

/** Error envelope shared by analyze and batch endpoints. */
export const AnalyzeErrorSchema = z
  .object({
    id: z.string().min(1),
    error: z.string(),
    retryable: z.boolean(),
    statusCode: z
      .number()
      .int()
      .min(400)
      .max(599)
      .optional(),
    details: z.string().optional()
  })
  .strict();

export type AnalyzeError = z.infer<typeof AnalyzeErrorSchema>;

/** Batch analyze request schema. */
export const BatchAnalysisRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    items: z.array(ItemAnalysisRequestSchema).min(1)
  })
  .strict();

export type BatchAnalysisRequest = z.infer<typeof BatchAnalysisRequestSchema>;

export const BatchAnalysisResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ok"),
      id: z.string().min(1),
      result: ItemAnalysisResponseSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("err"),
      id: z.string().min(1),
      error: AnalyzeErrorSchema
    })
    .strict()
]);

export type BatchAnalysisResult = z.infer<typeof BatchAnalysisResultSchema>;

/** Batch analyze response with discriminated union results. */
export const BatchAnalysisResponseSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    results: z.array(BatchAnalysisResultSchema)
  })
  .strict();

export type BatchAnalysisResponse = z.infer<typeof BatchAnalysisResponseSchema>;

/** Compatibility helper that maps legacy {result|error} shapes to discriminated unions. */
export function adaptLegacyBatchResult(
  legacy: { id: string; result?: unknown; error?: unknown }
): BatchAnalysisResult {
  if (legacy.result) {
    return BatchAnalysisResultSchema.parse({
      kind: "ok",
      id: legacy.id,
      result: ItemAnalysisResponseSchema.parse(legacy.result)
    });
  }
  return BatchAnalysisResultSchema.parse({
    kind: "err",
    id: legacy.id,
    error: AnalyzeErrorSchema.parse(legacy.error)
  });
}

/** Error payload returned by REST endpoints. */
export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
  .strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Single chunk indexed into semantic memory. */
export const MemoryIndexItemSchema = z
  .object({
    id: z.string().min(1, "id is required"),
    parentId: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
    text: z
      .string()
      .min(1, "text is required")
      .max(MEMORY_TEXT_LIMIT, `text must be ≤${MEMORY_TEXT_LIMIT} characters`),
    url: z.string().url().optional(),
    title: z.string().min(1).optional(),
    contentType: MimeTypeSchema.optional(),
    capturedAt: z.string().datetime().optional(),
    language: LanguageTagSchema.optional(),
    image: OptionalImageRef,
    entityType: EntityTypeSchema.optional(),
    conceptIds: z.array(ConceptIdSchema).max(16).optional(),
    tags: z.array(TagSchema).max(10).optional(),
    userNote: UserNoteSchema.optional(),
    relations: z.array(RelationSchema).max(32).optional(),
    sourceDomain: HostnameOnlySchema.optional(),
    updatedAt: z.string().datetime().optional()
  })
  .strict()
  .describe("Normalized memory chunk ready for ingestion");

export type MemoryIndexItem = z.infer<typeof MemoryIndexItemSchema>;

/** Memory index request envelope, schemaVersion pinned for coordinated deploys. */
export const MemoryIndexRequestSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION).default(MEMORY_SCHEMA_VERSION),
    items: z.array(MemoryIndexItemSchema).min(1, "items are required"),
    flush: z.boolean().optional()
  })
  .strict();

export type MemoryIndexRequest = z.infer<typeof MemoryIndexRequestSchema>;

/** Result emitted for each memory item ingest attempt. */
export const MemoryIndexResultSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["indexed", "duplicate", "failed"]),
    message: z.string().optional(),
    storedIds: z.array(z.string().min(1)).optional(),
    duplicateOf: z.string().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "indexed" && (!value.storedIds || value.storedIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "indexed result must include storedIds"
      });
    }
    if (value.status === "failed" && !value.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed result must include message"
      });
    }
  });

export type MemoryIndexResult = z.infer<typeof MemoryIndexResultSchema>;

/** Memory index response summarizing ingest outcome. */
export const MemoryIndexResponseSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
    counts: z
      .object({
        indexed: z.number().int().nonnegative(),
        duplicate: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative()
      })
      .strict(),
    results: z.array(MemoryIndexResultSchema)
  })
  .strict();

export type MemoryIndexResponse = z.infer<typeof MemoryIndexResponseSchema>;

/** Memory store stats include embed metadata for upgrade safety. */
export const MemoryStatsResponseSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
    items: z.number().int().nonnegative(),
    vectors: z.number().int().nonnegative(),
    fileSizeBytes: z.number().int().nonnegative(),
    lastPersistedAt: z.string().datetime().optional(),
    embedModelVersion: z.string().min(1),
    embedDimensions: z.number().int().positive(),
    compactions: z.number().int().nonnegative().default(0),
    tagCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
    taggedItems: z.number().int().nonnegative().default(0)
  })
  .strict();

export type MemoryStatsResponse = z.infer<typeof MemoryStatsResponseSchema>;

/** Filter payload accepted by /api/memory/query. */
export const MemoryQueryFiltersSchema = z
  .object({
    domain: HostOrUrlSchema.optional(),
    domains: z.array(HostOrUrlSchema).max(3).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    entityTypes: z.array(EntityTypeSchema).max(8).optional(),
    conceptIds: z.array(ConceptIdSchema).max(16).optional(),
    tags: z.array(TagSchema).max(10).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.since && value.until && Date.parse(value.since) > Date.parse(value.until)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "since must be earlier than or equal to until"
      });
    }
    const since = value.since ? Date.parse(value.since) : null;
    const until = value.until ? Date.parse(value.until) : null;
    const rangeEnd = until ?? Date.now();
    if (since && rangeEnd - since > MAX_FILTER_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `date ranges must be <=${MAX_FILTER_RANGE_DAYS} days`
      });
    }
  });

export type MemoryQueryFilters = z.infer<typeof MemoryQueryFiltersSchema>;

/** Request envelope for /api/memory/query. */
export const MemoryQueryRequestSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION).default(MEMORY_SCHEMA_VERSION),
    query: z.string().min(1),
    topK: z
      .number()
      .int()
      .min(1)
      .max(MAX_TOP_K)
      .default(DEFAULT_TOP_K)
      .describe("Defaults to 5 results; cap at 20 to contain payload size."),
    filters: MemoryQueryFiltersSchema.optional(),
    conversationId: z.string().uuid().optional(),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1),
            sourceIds: z.array(z.string().min(1)).optional()
          })
          .strict()
      )
      .max(5)
      .optional()
  })
  .strict();

export type MemoryQueryRequest = z.infer<typeof MemoryQueryRequestSchema>;

/** Single hit returned by memory search. */
export const MemoryQueryHitSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().min(1),
    sourceId: z.string().optional(),
    url: z.string().url().optional(),
    title: z.string().optional(),
    snippet: z.string().min(1).max(320, "snippet exceeds 320 characters"),
    capturedAt: z.string().datetime().optional(),
    contentType: MimeTypeSchema.optional(),
    language: LanguageTagSchema.optional(),
    entityType: EntityTypeSchema.optional(),
    conceptIds: z.array(ConceptIdSchema).optional(),
    tags: z.array(TagSchema).optional(),
    userNote: UserNoteSchema.optional(),
    updatedAt: z.string().datetime().optional(),
    relations: z.array(RelationSchema).optional(),
    sourceDomain: HostnameOnlySchema.optional(),
    similarity: z
      .number()
      .min(COSINE_RANGE.min)
      .max(COSINE_RANGE.max),
    duplicateOf: z.string().optional()
  })
  .strict();

export type MemoryQueryHit = z.infer<typeof MemoryQueryHitSchema>;

/** Response payload for memory queries, with optional synthesized answer. */
export const MemoryQueryResponseSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION),
    results: z.array(MemoryQueryHitSchema),
    answer: z
      .object({
        text: z.string().min(1),
        sources: z.array(z.string().min(1)),
        sourceIds: z.array(z.string().min(1)).optional()
      })
      .strict()
      .optional(),
    answerSuppressed: z.string().min(1).max(200).optional()
  })
  .strict();

export type MemoryQueryResponse = z.infer<typeof MemoryQueryResponseSchema>;

/** PATCH payload for /api/memory/items/:id allowing ontology edits. */
export const MemoryMutationSchema = z
  .object({
    schemaVersion: z.literal(MEMORY_SCHEMA_VERSION).optional(),
    entityType: EntityTypeSchema.optional(),
    relations: z.array(RelationSchema).optional(),
    tags: z.array(TagSchema).max(10).optional(),
    userNote: UserNoteSchema.optional(),
    conceptIds: z.array(ConceptIdSchema).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "mutation payload must include at least one field"
  });

export type MemoryMutation = z.infer<typeof MemoryMutationSchema>;

export { decodeWire, encodeWire };
export { normalizeEntity } from "./ontology";

function coerceImageRef(value: unknown) {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      return { kind: "dataUri" as const, data: value };
    }
    if (/^https?:\/\//i.test(value)) {
      return { kind: "url" as const, url: value };
    }
    return { kind: "tag" as const, tag: value };
  }
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function parseCosineRange(raw: string): { min: number; max: number } {
  const cleaned = raw.replace(/[()\s]/g, "");
  const [minStr, maxStr] = cleaned.split("-");
  const min = Number(minStr);
  const max = Number(maxStr);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}

function buildEntityTypeSchema(mode: OntologyMode) {
  if (mode === "loose") {
    return z
      .string()
      .transform((value) => (isEntityType(value) ? (value as EntityType) : ("unknown" as EntityType)));
  }
  return z
    .string()
    .superRefine((value, ctx) => {
      if (!isEntityType(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `entityType must be one of: ${ENTITY_TYPES.join(", ")}`
        });
      }
    })
    .transform((value) => value as EntityType);
}

function buildRelationTypeSchema(mode: OntologyMode) {
  if (mode === "loose") {
    return z
      .string()
      .transform((value) => (isRelationType(value) ? (value as RelationType) : ("mentions" as RelationType)));
  }
  return z
    .string()
    .superRefine((value, ctx) => {
      if (!isRelationType(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `relations.type must be one of: ${RELATION_TYPES.join(", ")}`
        });
      }
    })
    .transform((value) => value as RelationType);
}
