import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;
export const MEMORY_SCHEMA_VERSION = 1 as const;

const ItemSourceMetaSchema = z
  .object({
    profileName: z.string().min(1).optional(),
    anchorTag: z.string().min(1).optional(),
    anchorStrategy: z.string().min(1).optional()
  })
  .partial()
  .optional();

export const ItemAnalysisRequestSchema = z.object({
  schemaVersion: z
    .number()
    .int()
    .min(1)
    .max(SCHEMA_VERSION)
    .optional()
    .default(SCHEMA_VERSION),
  id: z.string().min(1, "id is required"),
  text: z.string().min(1, "text is required").max(1500, "text exceeds maximum length"),
  image: z.string().min(1).optional(),
  sourceMeta: ItemSourceMetaSchema
});

export type ItemAnalysisRequest = z.infer<typeof ItemAnalysisRequestSchema>;

export const ItemAnalysisResponseSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  image_tag: z.string().min(1).optional(),
  is_ad: z.boolean()
});

export type ItemAnalysisResponse = z.infer<typeof ItemAnalysisResponseSchema>;

export const AnalyzeErrorSchema = z.object({
  id: z.string().min(1),
  error: z.string(),
  retryable: z.boolean(),
  statusCode: z.number().int().optional(),
  details: z.string().optional()
});

export type AnalyzeError = z.infer<typeof AnalyzeErrorSchema>;

export const BatchAnalysisRequestSchema = z.object({
  schemaVersion: z.number().int().min(1),
  items: z.array(ItemAnalysisRequestSchema)
});

export type BatchAnalysisRequest = z.infer<typeof BatchAnalysisRequestSchema>;

const BatchAnalysisResultSchema = z.union([
  z.object({
    id: z.string().min(1),
    result: ItemAnalysisResponseSchema
  }),
  z.object({
    id: z.string().min(1),
    error: AnalyzeErrorSchema
  })
]);

export const BatchAnalysisResponseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  results: z.array(BatchAnalysisResultSchema)
});

export type BatchAnalysisResponse = z.infer<typeof BatchAnalysisResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional()
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const MemoryIndexItemSchema = z.object({
  id: z.string().min(1, "id is required"),
  sourceId: z.string().min(1).optional(),
  text: z.string().min(1, "text is required"),
  url: z.string().url().optional(),
  title: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  capturedAt: z.string().datetime().optional(),
  language: z.string().min(2).max(8).optional(),
  imageTag: z.string().optional(),
  imageData: z.string().optional()
});

export type MemoryIndexItem = z.infer<typeof MemoryIndexItemSchema>;

export const MemoryIndexRequestSchema = z.object({
  schemaVersion: z
    .number()
    .int()
    .min(1)
    .max(MEMORY_SCHEMA_VERSION)
    .optional()
    .default(MEMORY_SCHEMA_VERSION),
  items: z.array(MemoryIndexItemSchema).min(1, "items are required")
});

export type MemoryIndexRequest = z.infer<typeof MemoryIndexRequestSchema>;

export const MemoryIndexResultSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["indexed", "duplicate", "failed"]),
  message: z.string().optional(),
  storedIds: z.array(z.string().min(1)).optional()
});

export type MemoryIndexResult = z.infer<typeof MemoryIndexResultSchema>;

export const MemoryIndexResponseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  counts: z.object({
    indexed: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }),
  results: z.array(MemoryIndexResultSchema)
});

export type MemoryIndexResponse = z.infer<typeof MemoryIndexResponseSchema>;

export const MemoryStatsResponseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  items: z.number().int().nonnegative(),
  vectors: z.number().int().nonnegative(),
  fileSizeBytes: z.number().int().nonnegative(),
  lastPersistedAt: z.string().datetime().optional()
});

export type MemoryStatsResponse = z.infer<typeof MemoryStatsResponseSchema>;

export const MemoryQueryFiltersSchema = z.object({
  domain: z.string().url().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional()
});

export const MemoryQueryRequestSchema = z.object({
  schemaVersion: z
    .number()
    .int()
    .min(1)
    .max(MEMORY_SCHEMA_VERSION)
    .optional()
    .default(MEMORY_SCHEMA_VERSION),
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).optional().default(5),
  filters: MemoryQueryFiltersSchema.optional()
});

export type MemoryQueryRequest = z.infer<typeof MemoryQueryRequestSchema>;

export const MemoryQueryHitSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1),
  sourceId: z.string().optional(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  snippet: z.string().min(1),
  capturedAt: z.string().datetime().optional(),
  contentType: z.string().optional(),
  language: z.string().optional(),
  similarity: z.number().min(-1).max(1)
});

export type MemoryQueryHit = z.infer<typeof MemoryQueryHitSchema>;

export const MemoryQueryResponseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  results: z.array(MemoryQueryHitSchema),
  answer: z
    .object({
      text: z.string().min(1),
      sources: z.array(z.string().min(1))
    })
    .optional()
});

export type MemoryQueryResponse = z.infer<typeof MemoryQueryResponseSchema>;
