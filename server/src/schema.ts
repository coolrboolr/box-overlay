import { z } from "zod";

export const ItemAnalysisRequestSchema = z.object({
  id: z.string().min(1, "id is required"),
  text: z.string().min(1, "text is required").max(1500, "text exceeds maximum length"),
  image: z.string().min(1).optional()
});

export type ItemAnalysisRequest = z.infer<typeof ItemAnalysisRequestSchema>;

export const ItemAnalysisResponseSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  image_tag: z.string().min(1).optional(),
  is_ad: z.boolean()
});

export type ItemAnalysisResponse = z.infer<typeof ItemAnalysisResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.unknown().optional()
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
