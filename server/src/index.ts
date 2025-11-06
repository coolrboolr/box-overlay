import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";

import {
  ErrorResponseSchema,
  ItemAnalysisRequestSchema,
  ItemAnalysisResponseSchema,
  type ItemAnalysisRequest
} from "./schema";
import { callOllama } from "./ollama";
import { env } from "./env";

const HOST = "127.0.0.1";
const JSON_LIMIT = "2mb";

const app = express();

app.use(express.json({ limit: JSON_LIMIT }));
app.use(buildCorsMiddleware());

app.post("/api/analyze", async (req, res) => {
  const parseResult = ItemAnalysisRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorPayload = ErrorResponseSchema.parse({
      error: "Invalid request payload",
      details: parseResult.error.format()
    });
    return res.status(400).json(errorPayload);
  }

  const payload = parseResult.data;
  try {
    const result = await analyzeRequest(payload);
    return res.json(result);
  } catch (error) {
    console.error("[server] analyze failed", {
      id: payload.id,
      error: error instanceof Error ? error.message : String(error)
    });
    const errorPayload = ErrorResponseSchema.parse({
      error: "Failed to analyze content",
      details: process.env.NODE_ENV === "development" ? formatErrorDetails(error) : undefined
    });
    return res.status(500).json(errorPayload);
  }
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("[server] unhandled error", err);
  const errorPayload = ErrorResponseSchema.parse({
    error: "Internal server error",
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

async function analyzeRequest(payload: ItemAnalysisRequest) {
  const response = await callOllama(payload, {
    model: env.OLLAMA_MODEL,
    baseUrl: env.OLLAMA_BASE_URL,
    timeoutMs: env.OLLAMA_TIMEOUT_MS,
    mock: env.MOCK_OLLAMA
  });
  return ItemAnalysisResponseSchema.parse(response);
}

function buildCorsMiddleware() {
  return cors({
    origin(origin, callback) {
      if (!origin) {
        if (env.allowedOrigins === null) {
          return callback(null, true);
        }
        return callback(null, true);
      }

      if (env.allowedOrigins === null || env.allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    }
  });
}

function formatErrorDetails(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }
  return error;
}
