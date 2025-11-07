import { Router } from "express";

import { analyzeRequest } from "../analyzeService";
import {
  AnalyzeError,
  BatchAnalysisRequestSchema,
  BatchAnalysisResponseSchema,
  ErrorResponseSchema,
  SCHEMA_VERSION
} from "../schema";

export function createAnalyzeBatchRouter(): Router {
  const router = Router();

  router.post("/api/analyze/batch", async (req, res) => {
    const parseResult = BatchAnalysisRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorPayload = ErrorResponseSchema.parse({
        error: "VALIDATION_ERROR",
        message: "Invalid batch analyze request payload",
        details: parseResult.error.format()
      });
      return res.status(400).json(errorPayload);
    }

    const payload = parseResult.data;

    if (payload.schemaVersion !== SCHEMA_VERSION) {
      const errorPayload = ErrorResponseSchema.parse({
        error: "UNSUPPORTED_SCHEMA_VERSION",
        message: `Unsupported schemaVersion ${payload.schemaVersion}`,
        details: { expected: SCHEMA_VERSION }
      });
      return res.status(400).json(errorPayload);
    }

    const results = await Promise.all(
      payload.items.map(async (item) => {
        try {
          const result = await analyzeRequest(item);
          return { id: item.id, result };
        } catch (error) {
          console.error("[server] batch analyze failed", {
            id: item.id,
            error: error instanceof Error ? error.message : error
          });
          return {
            id: item.id,
            error: buildBatchAnalyzeError(item.id, error)
          };
        }
      })
    );

    const responsePayload = BatchAnalysisResponseSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      results
    });

    return res.json(responsePayload);
  });

  return router;
}

function buildBatchAnalyzeError(id: string, error: unknown): AnalyzeError {
  const message =
    error instanceof Error ? error.message : "Failed to analyze content";
  const detail =
    error instanceof Error && typeof error.stack === "string"
      ? error.stack
      : undefined;

  return {
    id,
    error: message,
    retryable: false,
    statusCode: 500,
    details: detail ?? (typeof error === "string" ? error : undefined)
  };
}
