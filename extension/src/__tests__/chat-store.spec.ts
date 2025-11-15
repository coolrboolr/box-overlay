/* @vitest-environment jsdom */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { filterChats, listChats, upsertChats } from "../services/chat-store";
import type { Chat } from "../types/chat";

const STORAGE_KEY = "llm-overlay-chats";

function mockLocalStorage(): void {
  const store: Record<string, string> = {};
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((key) => delete store[key]);
      })
    },
    writable: true
  });
}

const baseChats: Chat[] = [
  {
    chatId: "pinned",
    title: "Pinned Alpha",
    messages: ["note a"],
    anchors: {
      pageUrl: "https://example.com/a",
      domain: "example.com",
      entities: [{ id: "e1", label: "Alpha", type: "person" }],
      relationships: [{ id: "r1", type: "mentions", fromId: "e1", toId: "e2", label: "Mentions" }]
    },
    pinned: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastTouched: "2024-01-03T00:00:00.000Z"
  },
  {
    chatId: "recent",
    title: "Recent Beta",
    messages: ["beta body"],
    anchors: {
      pageUrl: "https://beta.io/page",
      domain: "beta.io",
      entities: [{ id: "e2", label: "Beta", type: "brand" }],
      relationships: [{ id: "r2", type: "refers_to", fromId: "e2", toId: "e1", label: "Refers" }]
    },
    pinned: false,
    createdAt: "2024-01-02T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    lastTouched: "2024-01-02T00:00:00.000Z"
  },
  {
    chatId: "recent-older",
    title: "Older Gamma",
    messages: ["gamma"],
    anchors: {
      pageUrl: "https://example.com/other",
      domain: "example.com",
      entities: [{ id: "e3", label: "Gamma", type: "topic" }],
      relationships: []
    },
    pinned: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastTouched: "2024-01-01T00:00:00.000Z"
  }
];

describe("chat-store listChats seeding and persistence", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it("seeds chats when storage is empty and persists them", async () => {
    const result = await listChats();
    expect(result.length).toBeGreaterThan(0);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.any(String)
    );

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored.length).toBe(result.length);
  });

  it("reads from storage on subsequent calls", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(baseChats));
    const result = await listChats();
    expect(result).toEqual(baseChats);
  });

  it("caps persisted chats at MAX_FALLBACK_CHATS", async () => {
    const largeList: Chat[] = Array.from({ length: 60 }).map((_, idx) => ({
      ...baseChats[1],
      chatId: `chat-${idx}`,
      title: `Chat ${idx}`
    }));
    upsertChats(largeList);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored.length).toBe(50);
  });
});

describe("filterChats scope matching", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it("returns all chats when no scope is provided", () => {
    const result = filterChats(baseChats, { });
    expect(result.chats.map((c) => c.chatId)).toEqual(["pinned", "recent", "recent-older"]);
  });

  it("filters by exact pageUrl", () => {
    const result = filterChats(baseChats, { scope: { pageUrl: "https://beta.io/page" } });
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].chatId).toBe("recent");
  });

  it("filters by domain", () => {
    const result = filterChats(baseChats, { scope: { domain: "example.com" } });
    expect(result.chats.map((c) => c.chatId)).toEqual(["pinned", "recent-older"]);
  });

  it("matches when any entity id intersects", () => {
    const result = filterChats(baseChats, { scope: { entityIds: ["e1"] } });
    expect(result.chats.map((c) => c.chatId)).toEqual(["pinned"]);
  });

  it("matches when any relationship id intersects", () => {
    const result = filterChats(baseChats, { scope: { relationshipIds: ["r2"] } });
    expect(result.chats.map((c) => c.chatId)).toEqual(["recent"]);
  });
});

describe("filterChats behavior and sorting", () => {
  it("returns all chats sorted pinned-first then lastTouched desc when no query/scope", () => {
    const result = filterChats(baseChats, { });
    expect(result.chats.map((c) => c.chatId)).toEqual(["pinned", "recent", "recent-older"]);
    expect(result.truncated).toBe(false);
  });

  it("matches query across anchors and messages when includeMessages=true", () => {
    const result = filterChats(baseChats, { query: "beta", includeMessages: true });
    expect(result.chats.map((c) => c.chatId)).toEqual(["recent"]);
  });

  it("excludes message-only matches when includeMessages=false", () => {
    const chats = [
      {
        ...baseChats[0],
        title: "No token here",
        messages: ["message-only-token"],
        chatId: "msg-only",
        anchors: {
          ...baseChats[0].anchors,
          domain: "example.com",
          pageUrl: "https://example.com/page"
        }
      }
    ];
    const result = filterChats(chats, { query: "message-only-token", includeMessages: false });
    expect(result.chats).toHaveLength(0);
  });

  it("enforces limit and sets truncated true when capped", () => {
    const manyChats: Chat[] = Array.from({ length: 5 }).map((_, idx) => ({
      ...baseChats[0],
      chatId: `chat-${idx}`,
      title: `Pinned ${idx}`,
      pinned: idx % 2 === 0,
      lastTouched: `2024-01-0${idx + 1}T00:00:00.000Z`
    }));
    const result = filterChats(manyChats, { limit: 3 });
    expect(result.chats).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("does not truncate when limit exceeds matches", () => {
    const result = filterChats(baseChats, { limit: 10 });
    expect(result.truncated).toBe(false);
  });
});
