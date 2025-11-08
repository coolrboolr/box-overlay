"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAnalyzeBatchRouter = createAnalyzeBatchRouter;
const express_1 = require("express");
const analyzeService_1 = require("../analyzeService");
const schema_1 = require("../schema");
function createAnalyzeBatchRouter() {
    const router = (0, express_1.Router)();
    router.post("/api/analyze/batch", async (req, res) => {
        const parseResult = schema_1.BatchAnalysisRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            const errorPayload = schema_1.ErrorResponseSchema.parse({
                error: "VALIDATION_ERROR",
                message: "Invalid batch analyze request payload",
                details: parseResult.error.format()
            });
            return res.status(400).json(errorPayload);
        }
        const payload = parseResult.data;
        if (payload.schemaVersion !== schema_1.SCHEMA_VERSION) {
            const errorPayload = schema_1.ErrorResponseSchema.parse({
                error: "UNSUPPORTED_SCHEMA_VERSION",
                message: `Unsupported schemaVersion ${payload.schemaVersion}`,
                details: { expected: schema_1.SCHEMA_VERSION }
            });
            return res.status(400).json(errorPayload);
        }
        const results = await Promise.all(payload.items.map(async (item) => {
            try {
                const result = await (0, analyzeService_1.analyzeRequest)(item);
                return { id: item.id, result };
            }
            catch (error) {
                console.error("[server] batch analyze failed", {
                    id: item.id,
                    error: error instanceof Error ? error.message : error
                });
                return {
                    id: item.id,
                    error: buildBatchAnalyzeError(item.id, error)
                };
            }
        }));
        const responsePayload = schema_1.BatchAnalysisResponseSchema.parse({
            schemaVersion: schema_1.SCHEMA_VERSION,
            results
        });
        return res.json(responsePayload);
    });
    return router;
}
function buildBatchAnalyzeError(id, error) {
    const message = error instanceof Error ? error.message : "Failed to analyze content";
    const detail = error instanceof Error && typeof error.stack === "string"
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
//# sourceMappingURL=analyzeBatch.js.map