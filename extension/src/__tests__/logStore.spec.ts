import { beforeEach, describe, expect, it, vi } from "vitest";

describe("telemetry log store fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as any).chrome;
  });

  it("records stats when chrome.storage is unavailable", async () => {
    const logStore = await import("../content/logStore");
    logStore.__resetTelemetryStoreForTests();

    logStore.initTelemetryStore();
    logStore.recordEvent("request", { id: "spec14", textLength: 10 });

    const stats = logStore.getStats();
    expect(stats.requestsQueued).toBe(1);
  });
});
