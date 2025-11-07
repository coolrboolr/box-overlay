import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

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
