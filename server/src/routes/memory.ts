import express from "express";

import { MemoryStore } from "../memory/store";
import {
  ErrorResponseSchema,
  MemoryIndexRequestSchema,
  MemoryStatsResponseSchema
} from "../schema";

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

  return router;
}
