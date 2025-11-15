import express from "express";

import { MemoryStore } from "../memory/store";
import {
  MEMORY_SCHEMA_VERSION,
  ErrorResponseSchema,
  MemoryIndexRequestSchema,
  MemoryQueryRequestSchema,
  MemoryQueryResponseSchema,
  MemoryStatsResponseSchema,
  MemoryMutationSchema
} from "../schema";
import { generateEmbedding } from "../services/embedding";
import { env } from "../env";
import { generateMemoryAnswer } from "../services/memoryAnswer";
import { conversationStore } from "../memory/conversation";

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
      conversationStore.pruneExpired();
      const { query, topK, filters, conversationId, history } = parseResult.data;
      const session = conversationId ? conversationStore.getOrCreate(conversationId) : null;
      const effectiveHistory = history ?? session?.history ?? [];
      const vector = await generateEmbedding(query);
      const effectiveTopK = Math.min(topK, filters?.limit ?? topK);
      const hits = await store.search({
        vector,
        topK: effectiveTopK,
        domain: filters?.domain,
        domains: filters?.domains,
        since: filters?.since,
        until: filters?.until,
        entityTypes: filters?.entityTypes,
        conceptIds: filters?.conceptIds,
        tags: filters?.tags
      });

      let answer:
        | {
            text: string;
            sources: string[];
            sourceIds?: string[];
          }
        | undefined;

      if (env.enableMemoryAnswers && hits.length) {
        try {
          answer = await generateMemoryAnswer(query, hits.slice(0, Math.min(3, hits.length)), {
            history: effectiveHistory
          });
        } catch (error) {
          console.warn("[memory] answer generation failed", error);
        }
      }

      const payload = MemoryQueryResponseSchema.parse({
        schemaVersion: parseResult.data.schemaVersion ?? MEMORY_SCHEMA_VERSION,
        results: hits,
        answer
      });

      if (session) {
        session.history = [...effectiveHistory, { role: "user", content: query }];
        if (answer?.text) {
          session.history.push({
            role: "assistant",
            content: answer.text,
            sourceIds: answer.sourceIds
          });
        }
        conversationStore.update(session.id, {
          history: session.history,
          lastQuery: query,
          lastAnswer: answer?.text,
          appliedFilters: filters,
          lastSourceIds: answer?.sourceIds
        });
      }
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

  router.patch("/items/:id", async (req, res) => {
    const mutationResult = MemoryMutationSchema.safeParse(req.body);
    if (!mutationResult.success) {
      return res.status(400).json(
        ErrorResponseSchema.parse({
          error: "VALIDATION_ERROR",
          message: "Invalid mutation payload",
          details: mutationResult.error.format()
        })
      );
    }
    try {
      const updated = await store.mutateItem(req.params.id, mutationResult.data);
      if (!updated) {
        return res.status(404).json(
          ErrorResponseSchema.parse({
            error: "NOT_FOUND",
            message: "Memory chunk not found"
          })
        );
      }
      return res.json(updated);
    } catch (error) {
      console.error("[memory] mutation failed", error);
      return res.status(500).json(
        ErrorResponseSchema.parse({
          error: "INTERNAL_ERROR",
          message: "Failed to update memory item"
        })
      );
    }
  });

  if (env.enableMemoryAdmin) {
    router.post("/admin/compact", async (_req, res) => {
      try {
        await store.compact();
        return res.json({ status: "ok" });
      } catch (error) {
        console.error("[memory] compaction failed", error);
        return res.status(500).json(
          ErrorResponseSchema.parse({
            error: "INTERNAL_ERROR",
            message: "Compaction failed"
          })
        );
      }
    });
  }

  return router;
}
