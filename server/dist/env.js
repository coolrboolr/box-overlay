"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
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
    })
});
const parsed = EnvSchema.parse(process.env);
exports.env = {
    ...parsed,
    allowedOrigins: parsed.ALLOWED_EXTENSION_IDS.length === 0
        ? null
        : new Set(parsed.ALLOWED_EXTENSION_IDS.map((id) => `chrome-extension://${id.toLowerCase()}`)),
    enableDevExtensionRegistration: parsed.ENABLE_DEV_EXTENSION_REGISTRATION,
    enableBatchAnalyze: parsed.ENABLE_BATCH_ANALYZE
};
//# sourceMappingURL=env.js.map