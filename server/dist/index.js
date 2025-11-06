"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const schema_1 = require("./schema");
const ollama_1 = require("./ollama");
const env_1 = require("./env");
const HOST = "127.0.0.1";
const JSON_LIMIT = "2mb";
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: JSON_LIMIT }));
app.use(buildCorsMiddleware());
app.post("/api/analyze", async (req, res) => {
    const parseResult = schema_1.ItemAnalysisRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        const errorPayload = schema_1.ErrorResponseSchema.parse({
            error: "Invalid request payload",
            details: parseResult.error.format()
        });
        return res.status(400).json(errorPayload);
    }
    const payload = parseResult.data;
    try {
        const result = await analyzeRequest(payload);
        return res.json(result);
    }
    catch (error) {
        console.error("[server] analyze failed", {
            id: payload.id,
            error: error instanceof Error ? error.message : String(error)
        });
        const errorPayload = schema_1.ErrorResponseSchema.parse({
            error: "Failed to analyze content",
            details: process.env.NODE_ENV === "development" ? formatErrorDetails(error) : undefined
        });
        return res.status(500).json(errorPayload);
    }
});
const errorHandler = (err, _req, res, _next) => {
    console.error("[server] unhandled error", err);
    const errorPayload = schema_1.ErrorResponseSchema.parse({
        error: "Internal server error",
        details: process.env.NODE_ENV === "development" ? formatErrorDetails(err) : undefined
    });
    res.status(500).json(errorPayload);
};
app.use(errorHandler);
const server = app.listen(env_1.env.PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${env_1.env.PORT}`);
});
process.on("SIGINT", () => {
    console.log("[server] shutting down...");
    server.close(() => {
        process.exit(0);
    });
});
async function analyzeRequest(payload) {
    const response = await (0, ollama_1.callOllama)(payload, {
        model: env_1.env.OLLAMA_MODEL,
        baseUrl: env_1.env.OLLAMA_BASE_URL,
        timeoutMs: env_1.env.OLLAMA_TIMEOUT_MS,
        mock: env_1.env.MOCK_OLLAMA
    });
    return schema_1.ItemAnalysisResponseSchema.parse(response);
}
function buildCorsMiddleware() {
    return (0, cors_1.default)({
        origin(origin, callback) {
            if (!origin) {
                if (env_1.env.allowedOrigins === null) {
                    return callback(null, true);
                }
                return callback(null, true);
            }
            if (env_1.env.allowedOrigins === null || env_1.env.allowedOrigins.has(origin)) {
                return callback(null, true);
            }
            return callback(new Error("Not allowed by CORS"));
        }
    });
}
function formatErrorDetails(error) {
    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack
        };
    }
    return error;
}
//# sourceMappingURL=index.js.map