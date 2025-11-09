"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryRouter = createMemoryRouter;
const express_1 = __importDefault(require("express"));
const schema_1 = require("../schema");
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
    return router;
}
//# sourceMappingURL=memory.js.map