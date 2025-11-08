import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../analyzeService", () => {
  return {
    analyzeRequest: vi.fn(async (payload: { id: string }) => ({
      id: payload.id,
      summary: "mock summary",
      is_ad: false
    }))
  };
});

import { createServerApp } from "../app";

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
});

describe("Dev extension routes", () => {
  it("allows analyze after registration and re-blocks after clear", async () => {
    const registryPath = await createTempRegistryPath();
    const originId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const origin = `chrome-extension://${originId}`;

    const { app } = await createServerApp({
      enableDevExtensionRegistration: true,
      enableBatchAnalyze: false,
      allowedOrigins: new Set(),
      devExtensionRegistryFile: registryPath
    });

    const payload = { id: "spec13", text: "Sample text" };

    await request(app)
      .post("/api/analyze")
      .set("Origin", origin)
      .send(payload)
      .expect(403);

    await request(app)
      .post("/api/dev/register-extension-origin")
      .query({ id: originId })
      .expect(204);

    await request(app)
      .post("/api/analyze")
      .set("Origin", origin)
      .send(payload)
      .expect(200);

    await request(app)
      .post("/api/dev/clear-extension-origins")
      .expect(204);

    await request(app)
      .post("/api/analyze")
      .set("Origin", origin)
      .send(payload)
      .expect(403);
  });
});

async function createTempRegistryPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-registry-"));
  tempDirs.push(dir);
  return path.join(dir, "origins.json");
}
