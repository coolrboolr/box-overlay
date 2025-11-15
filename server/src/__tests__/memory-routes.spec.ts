import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createServerApp } from "../app";
import { MemoryStore } from "../memory/store";
import type { MemoryIndexItem } from "../schema";
import { env } from "../env";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("Memory routes", () => {
  it("indexes items and exposes stats", async () => {
    const store = await createStore();
    const { app } = await createServerApp({
      enableDevExtensionRegistration: false,
      enableBatchAnalyze: false,
      allowedOrigins: new Set(),
      enableMemory: true,
      memoryStore: store
    });

    const payload = buildPayload("memory-test-1", "https://example.com/article");

    const ingestResponse = await request(app).post("/api/memory/index").send({ items: [payload] }).expect(200);

    expect(ingestResponse.body.counts.indexed).toBe(1);
    expect(Array.isArray(ingestResponse.body.results)).toBe(true);

    const statsResponse = await request(app).get("/api/memory/stats").expect(200);
    expect(statsResponse.body.items).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 for invalid payload", async () => {
    const store = await createStore();
    const { app } = await createServerApp({
      enableDevExtensionRegistration: false,
      enableBatchAnalyze: false,
      allowedOrigins: new Set(),
      enableMemory: true,
      memoryStore: store
    });

    await request(app)
      .post("/api/memory/index")
      .send({ items: [] })
      .expect(400);
  });

  it("clears memory via admin endpoint when confirmed", async () => {
    const original = env.enableMemoryAdmin;
    env.enableMemoryAdmin = true;
    try {
      const store = await createStore();
      const { app } = await createServerApp({
        enableDevExtensionRegistration: false,
        enableBatchAnalyze: false,
        allowedOrigins: new Set(),
        enableMemory: true,
        memoryStore: store
      });

      await request(app)
        .post("/api/memory/index")
        .send({ items: [buildPayload("clear-1", "https://example.com")] });
      const statsBefore = await store.stats();
      expect(statsBefore.items).toBeGreaterThan(0);

      await request(app)
        .post("/api/memory/admin/clear")
        .send({ confirm: "nope" })
        .expect(400);

      await request(app)
        .post("/api/memory/admin/clear")
        .send({ confirm: "ERASE" })
        .expect(200);

      const statsAfter = await store.stats();
      expect(statsAfter.items).toBe(0);
    } finally {
      env.enableMemoryAdmin = original;
    }
  });

  it("exports memory without embedding vectors", async () => {
    const original = env.enableMemoryAdmin;
    env.enableMemoryAdmin = true;
    try {
      const store = await createStore();
      const { app } = await createServerApp({
        enableDevExtensionRegistration: false,
        enableBatchAnalyze: false,
        allowedOrigins: new Set(),
        enableMemory: true,
        memoryStore: store
      });

      await request(app)
        .post("/api/memory/index")
        .send({ items: [buildPayload("export-1", "https://demo.dev")] })
        .expect(200);

      const response = await request(app).post("/api/memory/admin/export").send({}).expect(200);

      expect(response.headers["content-disposition"]).toContain("attachment; filename=");
      expect(response.body.schemaVersion).toBeDefined();
      expect(response.body.items?.[0]?.vector).toBeUndefined();
    } finally {
      env.enableMemoryAdmin = original;
    }
  });
});

async function createStore(): Promise<MemoryStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-router-"));
  tempDirs.push(dir);
  const store = new MemoryStore({
    dbPath: path.join(dir, "store.json"),
    dedupThreshold: 0.9,
    dedupKey: "cosine",
    maxCharsPerChunk: 256,
    embedModelVersion: "test-model@1",
    allowModelMismatch: true,
    embed: fakeEmbed
  });
  await store.load();
  return store;
}

function buildPayload(id: string, url: string): MemoryIndexItem {
  return {
    id,
    sourceId: `${id}-source`,
    text: "The quick brown fox jumps over the lazy dog.",
    url,
    title: "Example",
    capturedAt: new Date().toISOString(),
    contentType: "text/html",
    language: "en"
  };
}

async function fakeEmbed(text: string): Promise<Float32Array> {
  const buffer = Buffer.from(text);
  const vector = new Float32Array(8);
  for (let i = 0; i < vector.length; i += 1) {
    const byte = buffer[i % buffer.length] ?? 0;
    vector[i] = (byte % 64) / 64;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return Float32Array.from(vector.map((value) => value / magnitude));
}
