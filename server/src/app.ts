import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";

import { analyzeRequest } from "./analyzeService";
import { env } from "./env";
import { MemoryStore } from "./memory/store";
import { createAnalyzeBatchRouter } from "./routes/analyzeBatch";
import { createDevExtensionsRouter } from "./routes/devExtensions";
import { createMemoryRouter } from "./routes/memory";
import {
  ErrorResponseSchema,
  ItemAnalysisRequestSchema
} from "./schema";
import { formatErrorDetails } from "./utils/errors";
import { DevExtensionRegistry } from "./utils/devExtensionRegistry";

const JSON_LIMIT = "2mb";

export interface CreateServerAppOptions {
  enableDevExtensionRegistration?: boolean;
  enableBatchAnalyze?: boolean;
  allowedOrigins?: Set<string>;
  devExtensionRegistryFile?: string;
  enableMemory?: boolean;
  memoryStore?: MemoryStore;
}

interface ResolvedServerConfig {
  enableDevExtensionRegistration: boolean;
  enableBatchAnalyze: boolean;
  allowedOrigins: Set<string>;
  devExtensionRegistryFile?: string;
  enableMemory: boolean;
  memoryStore?: MemoryStore;
}

export async function createServerApp(options: CreateServerAppOptions = {}) {
  const config = resolveConfig(options);

  const app = express();
  const registry = new DevExtensionRegistry({ filePath: config.devExtensionRegistryFile });
  const dynamicExtensionOrigins = new Set<string>();
  let memoryStore: MemoryStore | undefined = config.memoryStore;

  if (config.enableDevExtensionRegistration) {
    await registry.load();
    registry.getAll().forEach((origin) => dynamicExtensionOrigins.add(origin));
  }

  if (config.enableMemory) {
    if (!memoryStore) {
      memoryStore = new MemoryStore({
        dbPath: env.memoryDbPath,
        dedupThreshold: env.memoryDedupThreshold,
        dedupKey: env.memoryDedupKey,
        maxCharsPerChunk: env.memoryMaxCharsPerChunk,
        embedModelVersion: env.memoryEmbedModelVersion,
        allowModelMismatch: env.useFakeEmbeddings
      });
      await memoryStore.load();
      console.log("[memory] store loaded", {
        path: env.memoryDbPath,
        dedupThreshold: env.memoryDedupThreshold
      });
    } else {
      await memoryStore.load();
    }
  }

  app.use(express.json({ limit: JSON_LIMIT }));
  app.use(buildCorsMiddleware());

  let lastRegistrationAttemptAt: number | null = null;

  if (config.enableDevExtensionRegistration) {
    app.use(
      "/api/dev",
      createDevExtensionsRouter({
        registry,
        dynamicExtensionOrigins,
        allowedExtensionOrigins: config.allowedOrigins,
        onRegisterAttempt: () => {
          lastRegistrationAttemptAt = Date.now();
        }
      })
    );
  }

  app.use(
    createExtensionOriginVerifier({
      allowedExtensionOrigins: config.allowedOrigins,
      dynamicExtensionOrigins,
      registrationEnabled: config.enableDevExtensionRegistration,
      getLastRegistrationAttempt: () => lastRegistrationAttemptAt
    })
  );

  if (config.enableBatchAnalyze) {
    app.use(createAnalyzeBatchRouter());
  }

  app.use(
    "/api/memory",
    createMemoryRouter({
      enabled: config.enableMemory,
      store: memoryStore
    })
  );

  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.json({ status: "ok", model: env.OLLAMA_MODEL, mock: env.MOCK_OLLAMA });
  };

  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  const defaultTags = ["technology", "finance", "sports", "lifestyle", "entertainment"];

  app.get("/api/tags", (_req, res) => {
    res.json({ tags: defaultTags });
  });

  app.post("/api/analyze", async (req, res) => {
    const parseResult = ItemAnalysisRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorPayload = ErrorResponseSchema.parse({
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
      const result = await analyzeRequest(payload);
      return res.json(result);
    } catch (error) {
      console.error("[server] analyze failed", {
        id: payload.id,
        error: error instanceof Error ? error.message : String(error)
      });
      const errorPayload = ErrorResponseSchema.parse({
        error: "INTERNAL_ERROR",
        message: "Failed to analyze content",
        details:
          process.env.NODE_ENV === "development" ? formatErrorDetails(error) : undefined
      });
      return res.status(500).json(errorPayload);
    }
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("[server] unhandled error", err);
    const errorPayload = ErrorResponseSchema.parse({
      error: "INTERNAL_ERROR",
      message: "Internal server error",
      details: process.env.NODE_ENV === "development" ? formatErrorDetails(err) : undefined
    });
    res.status(500).json(errorPayload);
  };

  app.use(errorHandler);

  return { app, registry, dynamicExtensionOrigins };
}

function resolveConfig(options: CreateServerAppOptions): ResolvedServerConfig {
  return {
    enableDevExtensionRegistration:
      options.enableDevExtensionRegistration ?? env.enableDevExtensionRegistration,
    enableBatchAnalyze: options.enableBatchAnalyze ?? env.enableBatchAnalyze,
    allowedOrigins: options.allowedOrigins ?? new Set(env.allowedOrigins),
    devExtensionRegistryFile:
      options.devExtensionRegistryFile ?? env.devExtensionRegistryFile,
    enableMemory: options.enableMemory ?? Boolean(env.memoryEnabled),
    memoryStore: options.memoryStore
  };
}

function buildCorsMiddleware() {
  return cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (origin.startsWith("chrome-extension://")) {
        return callback(null, true);
      }

      if (
        origin.startsWith("http://127.0.0.1") ||
        origin.startsWith("http://localhost") ||
        origin.startsWith("https://127.0.0.1") ||
        origin.startsWith("https://localhost")
      ) {
        return callback(null, true);
      }

      console.warn("[server] blocked CORS origin", origin);
      return callback(new Error("Not allowed by CORS"));
    }
  });
}

interface ExtensionOriginVerifierOptions {
  allowedExtensionOrigins: Set<string>;
  dynamicExtensionOrigins: Set<string>;
  registrationEnabled: boolean;
  getLastRegistrationAttempt: () => number | null;
}

function createExtensionOriginVerifier(options: ExtensionOriginVerifierOptions) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const originHeader = typeof req.headers.origin === "string" ? req.headers.origin.toLowerCase() : null;

    if (!originHeader || !originHeader.startsWith("chrome-extension://")) {
      return next();
    }

    if (
      options.allowedExtensionOrigins.has(originHeader) ||
      options.dynamicExtensionOrigins.has(originHeader)
    ) {
      return next();
    }

    const requestId =
      req.body && typeof req.body === "object" && typeof (req.body as { id?: unknown }).id === "string"
        ? (req.body as { id: string }).id
        : undefined;

    const lastAttempt = options.getLastRegistrationAttempt();
    const recentRegistration = typeof lastAttempt === "number" ? Date.now() - lastAttempt < 60_000 : false;

    console.warn("[server] 403 blocked origin", {
      origin: originHeader,
      path: req.path,
      requestId,
      registrationEnabled: options.registrationEnabled,
      recentRegistrationAttempt: recentRegistration
    });

    const allowedIds = new Set<string>();
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
