import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  ALLOWED_EXTENSION_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  OLLAMA_MODEL: z.string().default("llama3"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  MOCK_OLLAMA: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MOCK_OLLAMA_FALLBACK: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  ENABLE_DEV_EXTENSION_REGISTRATION: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return true;
      }
      const normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true";
    }),
  ENABLE_BATCH_ANALYZE: z
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

export const env = {
  ...parsed,
  allowedOrigins:
    parsed.ALLOWED_EXTENSION_IDS.length === 0
      ? null
      : new Set(parsed.ALLOWED_EXTENSION_IDS.map((id) => `chrome-extension://${id.toLowerCase()}`)),
  enableDevExtensionRegistration: parsed.ENABLE_DEV_EXTENSION_REGISTRATION,
  enableBatchAnalyze: parsed.ENABLE_BATCH_ANALYZE
};
