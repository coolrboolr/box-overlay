"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryRouter = createMemoryRouter;
const express_1 = __importDefault(require("express"));
const schema_1 = require("../schema");
const embedding_1 = require("../services/embedding");
const env_1 = require("../env");
const memoryAnswer_1 = require("../services/memoryAnswer");
function createMemoryRouter(options) {
    const router = express_1.default.Router();
    if (!options.enabled || !options.store) {
        router.use((req, res) => {
            if (req.method === "OPTIONS") {
                return res.sendStatus(204);
            }
            return res.status(501).json(schema_1.ErrorResponseSchema.parse({
                error: "MEMORY_DISABLED",
                message: "Persistent memory is not enabled on this server"
            }));
        });
        return router;
    }
    const store = options.store;
    router.post("/index", async (req, res) => {
        const parseResult = schema_1.MemoryIndexRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json(schema_1.ErrorResponseSchema.parse({
                error: "VALIDATION_ERROR",
                message: "Invalid memory index payload",
                details: parseResult.error.format()
            }));
        }
        try {
            const response = await store.ingest(parseResult.data.items);
            return res.json(response);
        }
        catch (error) {
            console.error("[memory] failed to index items", error);
            return res.status(500).json(schema_1.ErrorResponseSchema.parse({
                error: "INTERNAL_ERROR",
                message: "Failed to index memory items"
            }));
        }
    });
    router.get("/stats", async (_req, res) => {
        try {
            const stats = await store.stats();
            return res.json(schema_1.MemoryStatsResponseSchema.parse(stats));
        }
        catch (error) {
            console.error("[memory] failed to read stats", error);
            return res.status(500).json(schema_1.ErrorResponseSchema.parse({
                error: "INTERNAL_ERROR",
                message: "Failed to load memory stats"
            }));
        }
    });
    router.post("/query", async (req, res) => {
        const parseResult = schema_1.MemoryQueryRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json(schema_1.ErrorResponseSchema.parse({
                error: "VALIDATION_ERROR",
                message: "Invalid memory query payload",
                details: parseResult.error.format()
            }));
        }
        try {
            const { query, topK, filters } = parseResult.data;
            const vector = await (0, embedding_1.generateEmbedding)(query);
            const effectiveTopK = Math.min(topK, filters?.limit ?? topK);
            const hits = await store.search({
                vector,
                topK: effectiveTopK,
                domain: filters?.domain,
                domains: filters?.domains,
                since: filters?.since,
                until: filters?.until,
                entityTypes: filters?.entityTypes,
                conceptIds: filters?.conceptIds
            });
            let answer;
            if (env_1.env.enableMemoryAnswers && hits.length) {
                try {
                    answer = await (0, memoryAnswer_1.generateMemoryAnswer)(query, hits.slice(0, Math.min(3, hits.length)));
                }
                catch (error) {
                    console.warn("[memory] answer generation failed", error);
                }
            }
            const payload = schema_1.MemoryQueryResponseSchema.parse({
                schemaVersion: parseResult.data.schemaVersion ?? schema_1.MEMORY_SCHEMA_VERSION,
                results: hits,
                answer
            });
            return res.json(payload);
        }
        catch (error) {
            console.error("[memory] query failed", error);
            return res.status(500).json(schema_1.ErrorResponseSchema.parse({
                error: "INTERNAL_ERROR",
                message: "Failed to query memory"
            }));
        }
    });
    router.patch("/items/:id", async (req, res) => {
        const mutationResult = schema_1.MemoryMutationSchema.safeParse(req.body);
        if (!mutationResult.success) {
            return res.status(400).json(schema_1.ErrorResponseSchema.parse({
                error: "VALIDATION_ERROR",
                message: "Invalid mutation payload",
                details: mutationResult.error.format()
            }));
        }
        try {
            const updated = await store.mutateItem(req.params.id, mutationResult.data);
            if (!updated) {
                return res.status(404).json(schema_1.ErrorResponseSchema.parse({
                    error: "NOT_FOUND",
                    message: "Memory chunk not found"
                }));
            }
            return res.json(updated);
        }
        catch (error) {
            console.error("[memory] mutation failed", error);
            return res.status(500).json(schema_1.ErrorResponseSchema.parse({
                error: "INTERNAL_ERROR",
                message: "Failed to update memory item"
            }));
        }
    });
    if (env_1.env.enableMemoryAdmin) {
        router.post("/admin/compact", async (_req, res) => {
            try {
                await store.compact();
                return res.json({ status: "ok" });
            }
            catch (error) {
                console.error("[memory] compaction failed", error);
                return res.status(500).json(schema_1.ErrorResponseSchema.parse({
                    error: "INTERNAL_ERROR",
                    message: "Compaction failed"
                }));
            }
        });
    }
    return router;
}
//# sourceMappingURL=memory.js.map