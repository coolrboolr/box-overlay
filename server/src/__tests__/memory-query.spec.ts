import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerApp } from "../app";
import { MemoryStore } from "../memory/store";
import type { MemoryIndexItem } from "../schema";
import { env } from "../env";
import * as embeddingService from "../services/embedding";

const tempDirs: string[] = [];

beforeEach(() => {
  tempDirs.length = 0;
});

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  env.enableMemoryAnswers = false;
  vi.restoreAllMocks();
});

describe("memory query endpoint", () => {
  it("returns ranked matches without answers", async () => {
    env.enableMemoryAnswers = false;
    const store = await createPopulatedStore();
    const { app } = await createServerApp({
      enableMemory: true,
      memoryStore: store,
      enableDevExtensionRegistration: false,
      enableBatchAnalyze: false,
      allowedOrigins: new Set()
    });

    vi.spyOn(embeddingService, "generateEmbedding").mockResolvedValue(new Float32Array([1, 0, 0, 0]));

    const response = await request(app)
      .post("/api/memory/query")
      .send({ query: "local semantic memory", topK: 2 })
      .expect(200);

    expect(response.body.results).toHaveLength(2);
    expect(response.body.answer).toBeUndefined();
    expect(response.body.results[0].similarity).toBeGreaterThanOrEqual(
      response.body.results[1].similarity
    );
  });

  it("includes generated answer when enabled", async () => {
    env.enableMemoryAnswers = true;
    const store = await createPopulatedStore();

    vi.mock("../services/memoryAnswer", () => ({
      generateMemoryAnswer: vi.fn(async () => ({
        text: "Memory response",
        sources: ["Snippet"],
        sourceIds: ["alpha"]
      }))
    }));

    vi.spyOn(embeddingService, "generateEmbedding").mockResolvedValue(new Float32Array([1, 0, 0, 0]));

    const { app } = await createServerApp({
      enableMemory: true,
      memoryStore: store,
      enableDevExtensionRegistration: false,
      enableBatchAnalyze: false,
      allowedOrigins: new Set()
    });

    const response = await request(app)
      .post("/api/memory/query")
      .send({ query: "assistant answer" })
      .expect(200);

    expect(response.body.answer).toBeDefined();
    vi.doUnmock("../services/memoryAnswer");
  });
});

async function createPopulatedStore(): Promise<MemoryStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-query-"));
  tempDirs.push(dir);
  const store = new MemoryStore({
    dbPath: path.join(dir, "store.json"),
    dedupThreshold: 0.5,
    dedupKey: "cosine",
    maxCharsPerChunk: 512,
    embedModelVersion: "test-model@1",
    allowModelMismatch: true,
    embed: fakeEmbed
  });
  await store.load();

  const items: MemoryIndexItem[] = [
    {
      id: "alpha",
      sourceId: "alpha",
      text: "Persistent local semantic memory overview",
      url: "https://example.com/a",
      title: "Overview",
      capturedAt: new Date().toISOString()
    },
    {
      id: "beta",
      sourceId: "beta",
      text: "Instructions about querying stored snippets",
      url: "https://example.com/b",
      title: "Query",
      capturedAt: new Date().toISOString()
    }
  ];

  await store.ingest(items);
  return store;
}

async function fakeEmbed(text: string): Promise<Float32Array> {
  const basisIndex = Math.abs(hash(text)) % 4;
  const vector = new Float32Array(4);
  vector[basisIndex] = 1;
  return vector;
}

function hash(input: string): number {
  let result = 0;
  for (let i = 0; i < input.length; i += 1) {
    result = (result * 31 + input.charCodeAt(i)) | 0;
  }
  return result;
}
