"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const EnvSchema = zod_1.z.object({
    PORT: zod_1.z.coerce.number().int().positive().default(5000),
    ALLOWED_EXTENSION_IDS: zod_1.z
        .string()
        .default("")
        .transform((value) => value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)),
    OLLAMA_MODEL: zod_1.z.string().default("llama3"),
    OLLAMA_BASE_URL: zod_1.z.string().url().default("http://127.0.0.1:11434"),
    OLLAMA_TIMEOUT_MS: zod_1.z.coerce.number().int().positive().default(20000),
    MOCK_OLLAMA: zod_1.z
        .string()
        .optional()
        .transform((value) => value === "true"),
    MOCK_OLLAMA_FALLBACK: zod_1.z
        .string()
        .optional()
        .transform((value) => value === "true"),
    ENABLE_DEV_EXTENSION_REGISTRATION: zod_1.z
        .string()
        .optional()
        .transform((value) => {
        if (value === undefined) {
            return true;
        }
        const normalized = value.trim().toLowerCase();
        return normalized === "1" || normalized === "true";
    }),
    ENABLE_BATCH_ANALYZE: zod_1.z
        .string()
        .optional()
        .transform((value) => {
        if (value === undefined) {
            return false;
        }
        const normalized = value.trim().toLowerCase();
        return normalized === "1" || normalized === "true";
    }),
    DEV_EXTENSION_REGISTRY_FILE: zod_1.z
        .string()
        .optional()
        .default(".cache/dev-extension-origins.json"),
    MEMORY_ENABLED: zod_1.z
        .string()
        .optional()
        .transform((value) => {
        if (value === undefined) {
            return false;
        }
        const normalized = value.trim().toLowerCase();
        return normalized === "1" || normalized === "true";
    }),
    MEMORY_DB_PATH: zod_1.z
        .string()
        .optional()
        .default(".cache/memory-store.json"),
    MEMORY_EMBED_MODEL: zod_1.z.string().default("mxbai-embed-large"),
    MEMORY_DEDUP_THRESHOLD: zod_1.z.coerce.number().min(0).max(1).default(0.9),
    MEMORY_MAX_CHARS_PER_CHUNK: zod_1.z.coerce.number().int().positive().default(1000),
    USE_FAKE_EMBEDDINGS: zod_1.z
        .string()
        .optional()
        .transform((value) => value === "true")
});
const parsed = EnvSchema.parse(process.env);
const repoRoot = node_path_1.default.resolve(__dirname, "..", "..");
function normalizeExtensionId(value) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
        return null;
    }
    if (/^[a-p]{32}$/.test(trimmed)) {
        return `chrome-extension://${trimmed}`;
    }
    if (trimmed.startsWith("chrome-extension://")) {
        return trimmed;
    }
    return null;
}
const allowedExtensionOrigins = new Set(parsed.ALLOWED_EXTENSION_IDS.map(normalizeExtensionId).filter((value) => Boolean(value)));
function resolvePathFromRepo(rawPath) {
    if (!rawPath) {
        return undefined;
    }
    const normalized = rawPath.trim();
    if (!normalized) {
        return undefined;
    }
    return node_path_1.default.isAbsolute(normalized)
        ? normalized
        : node_path_1.default.resolve(repoRoot, normalized);
}
exports.env = {
    ...parsed,
    allowedOrigins: allowedExtensionOrigins,
    enableDevExtensionRegistration: parsed.ENABLE_DEV_EXTENSION_REGISTRATION,
    enableBatchAnalyze: parsed.ENABLE_BATCH_ANALYZE,
    devExtensionRegistryFile: resolvePathFromRepo(parsed.DEV_EXTENSION_REGISTRY_FILE),
    memoryEnabled: parsed.MEMORY_ENABLED,
    memoryDbPath: resolvePathFromRepo(parsed.MEMORY_DB_PATH) ?? node_path_1.default.resolve(repoRoot, ".cache/memory-store.json"),
    memoryEmbedModel: parsed.MEMORY_EMBED_MODEL,
    memoryDedupThreshold: parsed.MEMORY_DEDUP_THRESHOLD,
    memoryMaxCharsPerChunk: parsed.MEMORY_MAX_CHARS_PER_CHUNK,
    useFakeEmbeddings: parsed.USE_FAKE_EMBEDDINGS
};
//# sourceMappingURL=env.js.map