import express from "express";

import { MemoryStore } from "../memory/store";
import {
  MEMORY_SCHEMA_VERSION,
  ErrorResponseSchema,
  MemoryIndexRequestSchema,
  MemoryQueryRequestSchema,
  MemoryQueryResponseSchema,
  MemoryStatsResponseSchema
} from "../schema";
import { generateEmbedding } from "../services/embedding";
import { env } from "../env";
import { generateMemoryAnswer } from "../services/memoryAnswer";

interface MemoryRouterOptions {
  enabled: boolean;
  store?: MemoryStore;
}

export function createMemoryRouter(options: MemoryRouterOptions) {
  const router = express.Router();

  if (!options.enabled || !options.store) {
    router.use((req, res) => {
      if (req.method === "OPTIONS") {
        return res.sendStatus(204);
      }
      return res.status(501).json(
        ErrorResponseSchema.parse({
          error: "MEMORY_DISABLED",
          message: "Persistent memory is not enabled on this server"
        })
      );
    });
    return router;
  }

  const store = options.store;

  router.post("/index", async (req, res) => {
    const parseResult = MemoryIndexRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(
        ErrorResponseSchema.parse({
          error: "VALIDATION_ERROR",
          message: "Invalid memory index payload",
          details: parseResult.error.format()
        })
      );
    }

    try {
      const response = await store.ingest(parseResult.data.items);
      return res.json(response);
    } catch (error) {
      console.error("[memory] failed to index items", error);
      return res.status(500).json(
        ErrorResponseSchema.parse({
          error: "INTERNAL_ERROR",
          message: "Failed to index memory items"
        })
      );
    }
  });

  router.get("/stats", async (_req, res) => {
    try {
      const stats = await store.stats();
      return res.json(MemoryStatsResponseSchema.parse(stats));
    } catch (error) {
      console.error("[memory] failed to read stats", error);
      return res.status(500).json(
        ErrorResponseSchema.parse({
          error: "INTERNAL_ERROR",
          message: "Failed to load memory stats"
        })
      );
    }
  });

  router.post("/query", async (req, res) => {
    const parseResult = MemoryQueryRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(
        ErrorResponseSchema.parse({
          error: "VALIDATION_ERROR",
          message: "Invalid memory query payload",
          details: parseResult.error.format()
        })
      );
    }

    try {
      const { query, topK, filters } = parseResult.data;
      const vector = await generateEmbedding(query);
      const hits = await store.search({
        vector,
        topK,
        domain: filters?.domain,
        since: filters?.since,
        until: filters?.until
      });

      let answer:
        | {
            text: string;
            sources: string[];
          }
        | undefined;

      if (env.enableMemoryAnswers && hits.length) {
        try {
          answer = await generateMemoryAnswer(query, hits.slice(0, Math.min(3, hits.length)));
        } catch (error) {
          console.warn("[memory] answer generation failed", error);
        }
      }

      const payload = MemoryQueryResponseSchema.parse({
        schemaVersion: parseResult.data.schemaVersion ?? MEMORY_SCHEMA_VERSION,
        results: hits,
        answer
      });
      return res.json(payload);
    } catch (error) {
      console.error("[memory] query failed", error);
      return res.status(500).json(
        ErrorResponseSchema.parse({
          error: "INTERNAL_ERROR",
          message: "Failed to query memory"
        })
      );
    }
  });

  return router;
}
