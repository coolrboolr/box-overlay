"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStatsResponseSchema = exports.MemoryIndexResponseSchema = exports.MemoryIndexResultSchema = exports.MemoryIndexRequestSchema = exports.MemoryIndexItemSchema = exports.ErrorResponseSchema = exports.BatchAnalysisResponseSchema = exports.BatchAnalysisRequestSchema = exports.AnalyzeErrorSchema = exports.ItemAnalysisResponseSchema = exports.ItemAnalysisRequestSchema = exports.MEMORY_SCHEMA_VERSION = exports.SCHEMA_VERSION = void 0;
const zod_1 = require("zod");
exports.SCHEMA_VERSION = 1;
exports.MEMORY_SCHEMA_VERSION = 1;
const ItemSourceMetaSchema = zod_1.z
    .object({
    profileName: zod_1.z.string().min(1).optional(),
    anchorTag: zod_1.z.string().min(1).optional(),
    anchorStrategy: zod_1.z.string().min(1).optional()
})
    .partial()
    .optional();
exports.ItemAnalysisRequestSchema = zod_1.z.object({
    schemaVersion: zod_1.z
        .number()
        .int()
        .min(1)
        .max(exports.SCHEMA_VERSION)
        .optional()
        .default(exports.SCHEMA_VERSION),
    id: zod_1.z.string().min(1, "id is required"),
    text: zod_1.z.string().min(1, "text is required").max(1500, "text exceeds maximum length"),
    image: zod_1.z.string().min(1).optional(),
    sourceMeta: ItemSourceMetaSchema
});
exports.ItemAnalysisResponseSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    summary: zod_1.z.string().min(1),
    image_tag: zod_1.z.string().min(1).optional(),
    is_ad: zod_1.z.boolean()
});
exports.AnalyzeErrorSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    error: zod_1.z.string(),
    retryable: zod_1.z.boolean(),
    statusCode: zod_1.z.number().int().optional(),
    details: zod_1.z.string().optional()
});
exports.BatchAnalysisRequestSchema = zod_1.z.object({
    schemaVersion: zod_1.z.number().int().min(1),
    items: zod_1.z.array(exports.ItemAnalysisRequestSchema)
});
const BatchAnalysisResultSchema = zod_1.z.union([
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        result: exports.ItemAnalysisResponseSchema
    }),
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        error: exports.AnalyzeErrorSchema
    })
]);
exports.BatchAnalysisResponseSchema = zod_1.z.object({
    schemaVersion: zod_1.z.number().int().min(1),
    results: zod_1.z.array(BatchAnalysisResultSchema)
});
exports.ErrorResponseSchema = zod_1.z.object({
    error: zod_1.z.string(),
    message: zod_1.z.string(),
    details: zod_1.z.unknown().optional()
});
exports.MemoryIndexItemSchema = zod_1.z.object({
    id: zod_1.z.string().min(1, "id is required"),
    sourceId: zod_1.z.string().min(1).optional(),
    text: zod_1.z.string().min(1, "text is required"),
    url: zod_1.z.string().url().optional(),
    title: zod_1.z.string().min(1).optional(),
    contentType: zod_1.z.string().min(1).optional(),
    capturedAt: zod_1.z.string().datetime().optional(),
    language: zod_1.z.string().min(2).max(8).optional(),
    imageTag: zod_1.z.string().optional(),
    imageData: zod_1.z.string().optional()
});
exports.MemoryIndexRequestSchema = zod_1.z.object({
    schemaVersion: zod_1.z
        .number()
        .int()
        .min(1)
        .max(exports.MEMORY_SCHEMA_VERSION)
        .optional()
        .default(exports.MEMORY_SCHEMA_VERSION),
    items: zod_1.z.array(exports.MemoryIndexItemSchema).min(1, "items are required")
});
exports.MemoryIndexResultSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    status: zod_1.z.enum(["indexed", "duplicate", "failed"]),
    message: zod_1.z.string().optional(),
    storedIds: zod_1.z.array(zod_1.z.string().min(1)).optional()
});
exports.MemoryIndexResponseSchema = zod_1.z.object({
    schemaVersion: zod_1.z.number().int().min(1),
    counts: zod_1.z.object({
        indexed: zod_1.z.number().int().nonnegative(),
        duplicate: zod_1.z.number().int().nonnegative(),
        failed: zod_1.z.number().int().nonnegative()
    }),
    results: zod_1.z.array(exports.MemoryIndexResultSchema)
});
exports.MemoryStatsResponseSchema = zod_1.z.object({
    schemaVersion: zod_1.z.number().int().min(1),
    items: zod_1.z.number().int().nonnegative(),
    vectors: zod_1.z.number().int().nonnegative(),
    fileSizeBytes: zod_1.z.number().int().nonnegative(),
    lastPersistedAt: zod_1.z.string().datetime().optional()
});
//# sourceMappingURL=schema.js.map