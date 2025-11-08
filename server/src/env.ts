import path from "node:path";

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
    }),
  DEV_EXTENSION_REGISTRY_FILE: z
    .string()
    .optional()
    .default(".cache/dev-extension-origins.json")
});

const parsed = EnvSchema.parse(process.env);

const repoRoot = path.resolve(__dirname, "..", "..");

function normalizeExtensionId(value: string): string | null {
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

const allowedExtensionOrigins = new Set(
  parsed.ALLOWED_EXTENSION_IDS.map(normalizeExtensionId).filter((value): value is string => Boolean(value))
);

function resolveRegistryFile(rawPath: string | undefined): string | undefined {
  if (!rawPath) {
    return undefined;
  }
  const normalized = rawPath.trim();
  if (!normalized) {
    return undefined;
  }
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(repoRoot, normalized);
}

export const env = {
  ...parsed,
  allowedOrigins: allowedExtensionOrigins,
  enableDevExtensionRegistration: parsed.ENABLE_DEV_EXTENSION_REGISTRATION,
  enableBatchAnalyze: parsed.ENABLE_BATCH_ANALYZE,
  devExtensionRegistryFile: resolveRegistryFile(parsed.DEV_EXTENSION_REGISTRY_FILE)
};
