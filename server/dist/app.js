"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServerApp = createServerApp;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const analyzeService_1 = require("./analyzeService");
const env_1 = require("./env");
const store_1 = require("./memory/store");
const analyzeBatch_1 = require("./routes/analyzeBatch");
const devExtensions_1 = require("./routes/devExtensions");
const memory_1 = require("./routes/memory");
const schema_1 = require("./schema");
const errors_1 = require("./utils/errors");
const devExtensionRegistry_1 = require("./utils/devExtensionRegistry");
const JSON_LIMIT = "2mb";
async function createServerApp(options = {}) {
    const config = resolveConfig(options);
    const app = (0, express_1.default)();
    const registry = new devExtensionRegistry_1.DevExtensionRegistry({ filePath: config.devExtensionRegistryFile });
    const dynamicExtensionOrigins = new Set();
    let memoryStore = config.memoryStore;
    if (config.enableDevExtensionRegistration) {
        await registry.load();
        registry.getAll().forEach((origin) => dynamicExtensionOrigins.add(origin));
    }
    if (config.enableMemory) {
        if (!memoryStore) {
            memoryStore = new store_1.MemoryStore({
                dbPath: env_1.env.memoryDbPath,
                dedupThreshold: env_1.env.memoryDedupThreshold,
                maxCharsPerChunk: env_1.env.memoryMaxCharsPerChunk
            });
            await memoryStore.load();
            console.log("[memory] store loaded", {
                path: env_1.env.memoryDbPath,
                dedupThreshold: env_1.env.memoryDedupThreshold
            });
        }
        else {
            await memoryStore.load();
        }
    }
    app.use(express_1.default.json({ limit: JSON_LIMIT }));
    app.use(buildCorsMiddleware());
    let lastRegistrationAttemptAt = null;
    if (config.enableDevExtensionRegistration) {
        app.use("/api/dev", (0, devExtensions_1.createDevExtensionsRouter)({
            registry,
            dynamicExtensionOrigins,
            allowedExtensionOrigins: config.allowedOrigins,
            onRegisterAttempt: () => {
                lastRegistrationAttemptAt = Date.now();
            }
        }));
    }
    app.use(createExtensionOriginVerifier({
        allowedExtensionOrigins: config.allowedOrigins,
        dynamicExtensionOrigins,
        registrationEnabled: config.enableDevExtensionRegistration,
        getLastRegistrationAttempt: () => lastRegistrationAttemptAt
    }));
    if (config.enableBatchAnalyze) {
        app.use((0, analyzeBatch_1.createAnalyzeBatchRouter)());
    }
    app.use("/api/memory", (0, memory_1.createMemoryRouter)({
        enabled: config.enableMemory,
        store: memoryStore
    }));
    const healthHandler = (_req, res) => {
        res.json({ status: "ok", model: env_1.env.OLLAMA_MODEL, mock: env_1.env.MOCK_OLLAMA });
    };
    app.get("/health", healthHandler);
    app.get("/api/health", healthHandler);
    const defaultTags = ["technology", "finance", "sports", "lifestyle", "entertainment"];
    app.get("/api/tags", (_req, res) => {
        res.json({ tags: defaultTags });
    });
    app.post("/api/analyze", async (req, res) => {
        const parseResult = schema_1.ItemAnalysisRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
            const errorPayload = schema_1.ErrorResponseSchema.parse({
                error: "VALIDATION_ERROR",
                message: "Invalid analyze request payload",
                details: parseResult.error.format()
            });
            return res.status(400).json(errorPayload);
        }
        const payload = parseResult.data;
        try {
            console.log("[server] analyze request", {
                id: payload.id,
                textLength: payload.text.length,
                hasImage: Boolean(payload.image)
            });
            const result = await (0, analyzeService_1.analyzeRequest)(payload);
            return res.json(result);
        }
        catch (error) {
            console.error("[server] analyze failed", {
                id: payload.id,
                error: error instanceof Error ? error.message : String(error)
            });
            const errorPayload = schema_1.ErrorResponseSchema.parse({
                error: "INTERNAL_ERROR",
                message: "Failed to analyze content",
                details: process.env.NODE_ENV === "development" ? (0, errors_1.formatErrorDetails)(error) : undefined
            });
            return res.status(500).json(errorPayload);
        }
    });
    const errorHandler = (err, _req, res, _next) => {
        console.error("[server] unhandled error", err);
        const errorPayload = schema_1.ErrorResponseSchema.parse({
            error: "INTERNAL_ERROR",
            message: "Internal server error",
            details: process.env.NODE_ENV === "development" ? (0, errors_1.formatErrorDetails)(err) : undefined
        });
        res.status(500).json(errorPayload);
    };
    app.use(errorHandler);
    return { app, registry, dynamicExtensionOrigins };
}
function resolveConfig(options) {
    return {
        enableDevExtensionRegistration: options.enableDevExtensionRegistration ?? env_1.env.enableDevExtensionRegistration,
        enableBatchAnalyze: options.enableBatchAnalyze ?? env_1.env.enableBatchAnalyze,
        allowedOrigins: options.allowedOrigins ?? new Set(env_1.env.allowedOrigins),
        devExtensionRegistryFile: options.devExtensionRegistryFile ?? env_1.env.devExtensionRegistryFile,
        enableMemory: options.enableMemory ?? Boolean(env_1.env.memoryEnabled),
        memoryStore: options.memoryStore
    };
}
function buildCorsMiddleware() {
    return (0, cors_1.default)({
        origin(origin, callback) {
            if (!origin) {
                return callback(null, true);
            }
            if (origin.startsWith("chrome-extension://")) {
                return callback(null, true);
            }
            if (origin.startsWith("http://127.0.0.1") ||
                origin.startsWith("http://localhost") ||
                origin.startsWith("https://127.0.0.1") ||
                origin.startsWith("https://localhost")) {
                return callback(null, true);
            }
            console.warn("[server] blocked CORS origin", origin);
            return callback(new Error("Not allowed by CORS"));
        }
    });
}
function createExtensionOriginVerifier(options) {
    return (req, res, next) => {
        const originHeader = typeof req.headers.origin === "string" ? req.headers.origin.toLowerCase() : null;
        if (!originHeader || !originHeader.startsWith("chrome-extension://")) {
            return next();
        }
        if (options.allowedExtensionOrigins.has(originHeader) ||
            options.dynamicExtensionOrigins.has(originHeader)) {
            return next();
        }
        const requestId = req.body && typeof req.body === "object" && typeof req.body.id === "string"
            ? req.body.id
            : undefined;
        const lastAttempt = options.getLastRegistrationAttempt();
        const recentRegistration = typeof lastAttempt === "number" ? Date.now() - lastAttempt < 60000 : false;
        console.warn("[server] 403 blocked origin", {
            origin: originHeader,
            path: req.path,
            requestId,
            registrationEnabled: options.registrationEnabled,
            recentRegistrationAttempt: recentRegistration
        });
        const allowedIds = new Set();
        options.allowedExtensionOrigins.forEach((value) => {
            allowedIds.add(value.replace("chrome-extension://", ""));
        });
        options.dynamicExtensionOrigins.forEach((value) => {
            allowedIds.add(value.replace("chrome-extension://", ""));
        });
        const payload = {
            error: "EXTENSION_ORIGIN_BLOCKED",
            message: options.registrationEnabled
                ? "Extension origin is not registered. Reload the unpacked extension to register again."
                : "Extension origin is not allowlisted. Update ALLOWED_EXTENSION_IDS or enable dev registration.",
            origin: originHeader,
            allowedIds: Array.from(allowedIds),
            nextSteps: options.registrationEnabled
                ? "Call /api/dev/register-extension-origin?id=<extensionId> from the background worker."
                : "Set ENABLE_DEV_EXTENSION_REGISTRATION=true or update ALLOWED_EXTENSION_IDS."
        };
        return res.status(403).json(payload);
    };
}
//# sourceMappingURL=app.js.map