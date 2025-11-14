"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEntity = exports.encodeWire = exports.decodeWire = exports.MemoryMutationSchema = exports.MemoryQueryResponseSchema = exports.MemoryQueryHitSchema = exports.MemoryQueryRequestSchema = exports.MemoryQueryFiltersSchema = exports.MemoryStatsResponseSchema = exports.MemoryIndexResponseSchema = exports.MemoryIndexResultSchema = exports.MemoryIndexRequestSchema = exports.MemoryIndexItemSchema = exports.ErrorResponseSchema = exports.BatchAnalysisResponseSchema = exports.BatchAnalysisResultSchema = exports.BatchAnalysisRequestSchema = exports.AnalyzeErrorSchema = exports.ItemAnalysisResponseSchema = exports.ItemAnalysisRequestSchema = exports.ImageRefSchema = exports.MEMORY_SCHEMA_VERSION = exports.SCHEMA_VERSION = void 0;
exports.adaptLegacyBatchResult = adaptLegacyBatchResult;
const zod_1 = require("zod");
const ontology_1 = require("./ontology");
const wireCodec_1 = require("./wireCodec");
Object.defineProperty(exports, "decodeWire", { enumerable: true, get: function () { return wireCodec_1.decodeWire; } });
Object.defineProperty(exports, "encodeWire", { enumerable: true, get: function () { return wireCodec_1.encodeWire; } });
exports.SCHEMA_VERSION = 1;
exports.MEMORY_SCHEMA_VERSION = 1;
const ANALYSIS_TEXT_LIMIT = 1500;
const MEMORY_TEXT_LIMIT = parsePositiveInt(process.env.LIMIT_TEXT, 4000);
const ACCEPT_BARE_DOMAIN = parseBoolean(process.env.ACCEPT_BARE_DOMAIN, true);
const DATA_URI_MAX_CHARS = 100 * 1024; // 100 KB upper bound
const LANGUAGE_TAG_REGEX = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
const MIME_REGEX = /^[\w.+-]+\/[\w.+-]+$/;
const HOSTNAME_REGEX = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;
const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
const COSINE_RANGE = parseCosineRange(process.env.COSINE_RANGE ?? "0-1");
const ONTOLOGY_MODE = (process.env.ONTOLOGY_MODE ?? "strict").toLowerCase() === "loose" ? "loose" : "strict";
const EntityTypeSchema = buildEntityTypeSchema(ONTOLOGY_MODE);
const RelationTypeSchema = buildRelationTypeSchema(ONTOLOGY_MODE);
const HostnameOnlySchema = zod_1.z
    .string()
    .min(1)
    .superRefine((value, ctx) => {
    if (!HOSTNAME_REGEX.test(value.toLowerCase())) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "value must be a valid hostname"
        });
    }
})
    .transform((value) => value.toLowerCase());
const HostOrUrlSchema = ACCEPT_BARE_DOMAIN
    ? zod_1.z
        .string()
        .min(1)
        .superRefine((value, ctx) => {
        if (value.includes("://")) {
            try {
                new URL(value);
                return;
            }
            catch {
                ctx.addIssue({
                    code: zod_1.z.ZodIssueCode.custom,
                    message: "domain must be a valid URL or bare hostname"
                });
                return;
            }
        }
        if (!HOSTNAME_REGEX.test(value.toLowerCase())) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: "domain must be a valid hostname when scheme omitted"
            });
        }
    })
    : zod_1.z.string().url({ message: "domain must be provided as a full URL" });
const LanguageTagSchema = zod_1.z
    .string()
    .regex(LANGUAGE_TAG_REGEX, {
    message: "language must be a valid BCP-47 tag such as en or en-US"
});
const MimeTypeSchema = zod_1.z
    .string()
    .regex(MIME_REGEX, {
    message: "contentType must be a valid MIME type like text/html"
});
const ConceptIdSchema = zod_1.z
    .string()
    .min(1)
    .max(128, "conceptIds must be ≤128 characters");
const RelationSchema = zod_1.z
    .object({
    type: RelationTypeSchema,
    targetId: zod_1.z.string().min(1)
})
    .strict();
/** Unified image reference used across request/response payloads. */
exports.ImageRefSchema = zod_1.z
    .discriminatedUnion("kind", [
    zod_1.z
        .object({
        kind: zod_1.z.literal("tag"),
        tag: zod_1.z.string().min(1)
    })
        .strict(),
    zod_1.z
        .object({
        kind: zod_1.z.literal("dataUri"),
        data: zod_1.z
            .string()
            .max(DATA_URI_MAX_CHARS, "dataUri payload exceeds 100KB budget")
            .refine((value) => value.startsWith("data:"), {
            message: "dataUri must start with data:"
        })
    })
        .strict(),
    zod_1.z
        .object({
        kind: zod_1.z.literal("url"),
        url: zod_1.z.string().url()
    })
        .strict()
])
    .describe("Image references are normalized by kind/tag/dataUri/url");
const OptionalImageRef = zod_1.z
    .preprocess((value) => (value === undefined ? undefined : coerceImageRef(value)), exports.ImageRefSchema)
    .optional();
const ItemSourceMetaSchema = zod_1.z
    .object({
    profileName: zod_1.z.string().min(1).optional(),
    anchorTag: zod_1.z.string().min(1).optional(),
    anchorStrategy: zod_1.z.string().min(1).optional()
})
    .strict();
/** Strict analyze request payload used by /api/analyze. */
exports.ItemAnalysisRequestSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.SCHEMA_VERSION).default(exports.SCHEMA_VERSION),
    id: zod_1.z.string().min(1, "id is required"),
    text: zod_1.z
        .string()
        .min(1, "text is required")
        .max(ANALYSIS_TEXT_LIMIT, `text exceeds ${ANALYSIS_TEXT_LIMIT} characters`),
    image: OptionalImageRef,
    sourceMeta: ItemSourceMetaSchema.optional()
})
    .strict();
/** Analyze response emitted by Ollama proxy, normalized to camelCase. */
exports.ItemAnalysisResponseSchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1),
    summary: zod_1.z.string().min(1),
    image: OptionalImageRef,
    isAd: zod_1.z.boolean()
})
    .strict();
/** Error envelope shared by analyze and batch endpoints. */
exports.AnalyzeErrorSchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1),
    error: zod_1.z.string(),
    retryable: zod_1.z.boolean(),
    statusCode: zod_1.z
        .number()
        .int()
        .min(400)
        .max(599)
        .optional(),
    details: zod_1.z.string().optional()
})
    .strict();
/** Batch analyze request schema. */
exports.BatchAnalysisRequestSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.SCHEMA_VERSION),
    items: zod_1.z.array(exports.ItemAnalysisRequestSchema).min(1)
})
    .strict();
exports.BatchAnalysisResultSchema = zod_1.z.discriminatedUnion("kind", [
    zod_1.z
        .object({
        kind: zod_1.z.literal("ok"),
        id: zod_1.z.string().min(1),
        result: exports.ItemAnalysisResponseSchema
    })
        .strict(),
    zod_1.z
        .object({
        kind: zod_1.z.literal("err"),
        id: zod_1.z.string().min(1),
        error: exports.AnalyzeErrorSchema
    })
        .strict()
]);
/** Batch analyze response with discriminated union results. */
exports.BatchAnalysisResponseSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.SCHEMA_VERSION),
    results: zod_1.z.array(exports.BatchAnalysisResultSchema)
})
    .strict();
/** Compatibility helper that maps legacy {result|error} shapes to discriminated unions. */
function adaptLegacyBatchResult(legacy) {
    if (legacy.result) {
        return exports.BatchAnalysisResultSchema.parse({
            kind: "ok",
            id: legacy.id,
            result: exports.ItemAnalysisResponseSchema.parse(legacy.result)
        });
    }
    return exports.BatchAnalysisResultSchema.parse({
        kind: "err",
        id: legacy.id,
        error: exports.AnalyzeErrorSchema.parse(legacy.error)
    });
}
/** Error payload returned by REST endpoints. */
exports.ErrorResponseSchema = zod_1.z
    .object({
    error: zod_1.z.string(),
    message: zod_1.z.string(),
    details: zod_1.z.unknown().optional()
})
    .strict();
/** Single chunk indexed into semantic memory. */
exports.MemoryIndexItemSchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1, "id is required"),
    parentId: zod_1.z.string().min(1).optional(),
    sourceId: zod_1.z.string().min(1).optional(),
    text: zod_1.z
        .string()
        .min(1, "text is required")
        .max(MEMORY_TEXT_LIMIT, `text must be ≤${MEMORY_TEXT_LIMIT} characters`),
    url: zod_1.z.string().url().optional(),
    title: zod_1.z.string().min(1).optional(),
    contentType: MimeTypeSchema.optional(),
    capturedAt: zod_1.z.string().datetime().optional(),
    language: LanguageTagSchema.optional(),
    image: OptionalImageRef,
    entityType: EntityTypeSchema.optional(),
    conceptIds: zod_1.z.array(ConceptIdSchema).max(16).optional(),
    tags: zod_1.z.array(zod_1.z.string().min(1)).max(16).optional(),
    relations: zod_1.z.array(RelationSchema).max(32).optional(),
    sourceDomain: HostnameOnlySchema.optional()
})
    .strict()
    .describe("Normalized memory chunk ready for ingestion");
/** Memory index request envelope, schemaVersion pinned for coordinated deploys. */
exports.MemoryIndexRequestSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.MEMORY_SCHEMA_VERSION).default(exports.MEMORY_SCHEMA_VERSION),
    items: zod_1.z.array(exports.MemoryIndexItemSchema).min(1, "items are required"),
    flush: zod_1.z.boolean().optional()
})
    .strict();
/** Result emitted for each memory item ingest attempt. */
exports.MemoryIndexResultSchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1),
    status: zod_1.z.enum(["indexed", "duplicate", "failed"]),
    message: zod_1.z.string().optional(),
    storedIds: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    duplicateOf: zod_1.z.string().optional()
})
    .strict()
    .superRefine((value, ctx) => {
    if (value.status === "indexed" && (!value.storedIds || value.storedIds.length === 0)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "indexed result must include storedIds"
        });
    }
    if (value.status === "failed" && !value.message) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "failed result must include message"
        });
    }
});
/** Memory index response summarizing ingest outcome. */
exports.MemoryIndexResponseSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.MEMORY_SCHEMA_VERSION),
    counts: zod_1.z
        .object({
        indexed: zod_1.z.number().int().nonnegative(),
        duplicate: zod_1.z.number().int().nonnegative(),
        failed: zod_1.z.number().int().nonnegative()
    })
        .strict(),
    results: zod_1.z.array(exports.MemoryIndexResultSchema)
})
    .strict();
/** Memory store stats include embed metadata for upgrade safety. */
exports.MemoryStatsResponseSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.MEMORY_SCHEMA_VERSION),
    items: zod_1.z.number().int().nonnegative(),
    vectors: zod_1.z.number().int().nonnegative(),
    fileSizeBytes: zod_1.z.number().int().nonnegative(),
    lastPersistedAt: zod_1.z.string().datetime().optional(),
    embedModelVersion: zod_1.z.string().min(1),
    embedDimensions: zod_1.z.number().int().positive(),
    compactions: zod_1.z.number().int().nonnegative().default(0)
})
    .strict();
/** Filter payload accepted by /api/memory/query. */
exports.MemoryQueryFiltersSchema = zod_1.z
    .object({
    domain: HostOrUrlSchema.optional(),
    domains: zod_1.z.array(HostOrUrlSchema).max(8).optional(),
    since: zod_1.z.string().datetime().optional(),
    until: zod_1.z.string().datetime().optional(),
    limit: zod_1.z.number().int().min(1).max(50).optional(),
    entityTypes: zod_1.z.array(EntityTypeSchema).max(8).optional(),
    conceptIds: zod_1.z.array(ConceptIdSchema).max(16).optional()
})
    .strict()
    .superRefine((value, ctx) => {
    if (value.since && value.until && Date.parse(value.since) > Date.parse(value.until)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "since must be earlier than or equal to until"
        });
    }
});
/** Request envelope for /api/memory/query. */
exports.MemoryQueryRequestSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.MEMORY_SCHEMA_VERSION).default(exports.MEMORY_SCHEMA_VERSION),
    query: zod_1.z.string().min(1),
    topK: zod_1.z
        .number()
        .int()
        .min(1)
        .max(MAX_TOP_K)
        .default(DEFAULT_TOP_K)
        .describe("Defaults to 5 results; cap at 20 to contain payload size."),
    filters: exports.MemoryQueryFiltersSchema.optional()
})
    .strict();
/** Single hit returned by memory search. */
exports.MemoryQueryHitSchema = zod_1.z
    .object({
    id: zod_1.z.string().min(1),
    parentId: zod_1.z.string().min(1),
    sourceId: zod_1.z.string().optional(),
    url: zod_1.z.string().url().optional(),
    title: zod_1.z.string().optional(),
    snippet: zod_1.z.string().min(1).max(320, "snippet exceeds 320 characters"),
    capturedAt: zod_1.z.string().datetime().optional(),
    contentType: MimeTypeSchema.optional(),
    language: LanguageTagSchema.optional(),
    entityType: EntityTypeSchema.optional(),
    conceptIds: zod_1.z.array(ConceptIdSchema).optional(),
    tags: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    relations: zod_1.z.array(RelationSchema).optional(),
    sourceDomain: HostnameOnlySchema.optional(),
    similarity: zod_1.z
        .number()
        .min(COSINE_RANGE.min)
        .max(COSINE_RANGE.max),
    duplicateOf: zod_1.z.string().optional()
})
    .strict();
/** Response payload for memory queries, with optional synthesized answer. */
exports.MemoryQueryResponseSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.MEMORY_SCHEMA_VERSION),
    results: zod_1.z.array(exports.MemoryQueryHitSchema),
    answer: zod_1.z
        .object({
        text: zod_1.z.string().min(1),
        sources: zod_1.z.array(zod_1.z.string().min(1)),
        sourceIds: zod_1.z.array(zod_1.z.string().min(1)).optional()
    })
        .strict()
        .optional()
})
    .strict();
/** PATCH payload for /api/memory/items/:id allowing ontology edits. */
exports.MemoryMutationSchema = zod_1.z
    .object({
    entityType: EntityTypeSchema.optional(),
    relations: zod_1.z.array(RelationSchema).optional(),
    tags: zod_1.z.array(zod_1.z.string().min(1)).max(16).optional(),
    conceptIds: zod_1.z.array(ConceptIdSchema).optional()
})
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
    message: "mutation payload must include at least one field"
});
var ontology_2 = require("./ontology");
Object.defineProperty(exports, "normalizeEntity", { enumerable: true, get: function () { return ontology_2.normalizeEntity; } });
function coerceImageRef(value) {
    if (typeof value === "string") {
        if (value.startsWith("data:")) {
            return { kind: "dataUri", data: value };
        }
        if (/^https?:\/\//i.test(value)) {
            return { kind: "url", url: value };
        }
        return { kind: "tag", tag: value };
    }
    return value;
}
function parseBoolean(value, fallback) {
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
function parsePositiveInt(raw, fallback) {
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}
function parseCosineRange(raw) {
    const cleaned = raw.replace(/[()\s]/g, "");
    const [minStr, maxStr] = cleaned.split("-");
    const min = Number(minStr);
    const max = Number(maxStr);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
        return { min: 0, max: 1 };
    }
    return { min, max };
}
function buildEntityTypeSchema(mode) {
    if (mode === "loose") {
        return zod_1.z
            .string()
            .transform((value) => ((0, ontology_1.isEntityType)(value) ? value : "unknown"));
    }
    return zod_1.z
        .string()
        .superRefine((value, ctx) => {
        if (!(0, ontology_1.isEntityType)(value)) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `entityType must be one of: ${ontology_1.ENTITY_TYPES.join(", ")}`
            });
        }
    })
        .transform((value) => value);
}
function buildRelationTypeSchema(mode) {
    if (mode === "loose") {
        return zod_1.z
            .string()
            .transform((value) => ((0, ontology_1.isRelationType)(value) ? value : "mentions"));
    }
    return zod_1.z
        .string()
        .superRefine((value, ctx) => {
        if (!(0, ontology_1.isRelationType)(value)) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: `relations.type must be one of: ${ontology_1.RELATION_TYPES.join(", ")}`
            });
        }
    })
        .transform((value) => value);
}
//# sourceMappingURL=index.js.map