import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ConversationStore } from "../memory/conversation";

const TEN_MIN = 10 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConversationStore", () => {
  it("creates and reuses sessions", () => {
    const store = new ConversationStore();
    const session = store.getOrCreate("abc");
    const again = store.getOrCreate("abc");
    expect(again.id).toBe(session.id);
  });

  it("truncates history to last 3 turns", () => {
    const store = new ConversationStore();
    store.getOrCreate("abc");
    const updated = store.update("abc", {
      history: [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
        { role: "assistant", content: "4" }
      ]
    });
    expect(updated?.history.length).toBe(3);
    expect(updated?.history[0].content).toBe("2");
  });

  it("prunes expired sessions", () => {
    const store = new ConversationStore();
    store.getOrCreate("abc");
    vi.setSystemTime(Date.now() + TEN_MIN + 60_000);
    store.pruneExpired();
    expect(store.getOrCreate("abc").history.length).toBe(0);
  });
});
