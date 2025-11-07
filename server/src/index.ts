import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";

import { ErrorResponseSchema, ItemAnalysisRequestSchema } from "./schema";
import { env } from "./env";
import { analyzeRequest } from "./analyzeService";
import { createAnalyzeBatchRouter } from "./routes/analyzeBatch";
import { formatErrorDetails } from "./utils/errors";

const HOST = "127.0.0.1";
const JSON_LIMIT = "2mb";

const app = express();
const dynamicExtensionOrigins = new Set<string>();

const defaultTags = ["technology", "finance", "sports", "lifestyle", "entertainment"];

app.use(express.json({ limit: JSON_LIMIT }));

if (env.enableDevExtensionRegistration) {
  app.post("/api/dev/register-extension-origin", registerExtensionOriginHandler);
}

app.use(buildCorsMiddleware(dynamicExtensionOrigins));

if (env.enableBatchAnalyze) {
  app.use(createAnalyzeBatchRouter());
}

const healthHandler = (_req: express.Request, res: express.Response) => {
  res.json({ status: "ok", model: env.OLLAMA_MODEL, mock: env.MOCK_OLLAMA });
};

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

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
      details: process.env.NODE_ENV === "development" ? formatErrorDetails(error) : undefined
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

const server = app.listen(env.PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${env.PORT}`);
});

process.on("SIGINT", () => {
  console.log("[server] shutting down...");
  server.close(() => {
    process.exit(0);
  });
});

function buildCorsMiddleware(dynamicOrigins: Set<string>) {
  return cors({
    origin(origin, callback) {
      if (!origin) {
        if (env.allowedOrigins === null) {
          return callback(null, true);
        }
        return callback(null, true);
      }

      if (
        env.allowedOrigins === null ||
        env.allowedOrigins.has(origin) ||
        dynamicOrigins.has(origin)
      ) {
        return callback(null, true);
      }

      console.warn("[server] blocked CORS origin", origin);
      return callback(new Error("Not allowed by CORS"));
    }
  });
}

function registerExtensionOriginHandler(
  req: express.Request,
  res: express.Response
): express.Response | void {
  if (!env.enableDevExtensionRegistration) {
    return res.status(404).end();
  }

  const requestedOrigin = coerceExtensionOrigin(req);
  if (!requestedOrigin) {
    return res.status(400).json({ error: "INVALID_EXTENSION_ORIGIN" });
  }

  if (env.allowedOrigins?.has(requestedOrigin)) {
    return res.status(204).end();
  }

  if (!dynamicExtensionOrigins.has(requestedOrigin)) {
    dynamicExtensionOrigins.add(requestedOrigin);
    console.log("[server] registered dev extension origin", requestedOrigin);
  }

  return res.status(204).end();
}

function coerceExtensionOrigin(req: express.Request): string | null {
  const queryValue = req.query.id;
  const fromQuery = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  const normalizedFromQuery = normalizeExtensionId(typeof fromQuery === "string" ? fromQuery : null);
  if (normalizedFromQuery) {
    return normalizedFromQuery;
  }

  const headerOrigin = typeof req.headers.origin === "string" ? req.headers.origin : null;
  if (headerOrigin?.startsWith("chrome-extension://")) {
    return headerOrigin.toLowerCase();
  }

  return null;
}

function normalizeExtensionId(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (/^[a-p]{32}$/.test(trimmed)) {
    return `chrome-extension://${trimmed}`;
  }
  return null;
}
