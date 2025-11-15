import { describe, expect, it } from "vitest";
import type { Chat } from "../types/chat";
import { filterChats } from "../services/chat-store";

const baseChats: Chat[] = [
  {
    chatId: "chat-1",
    title: "Alpha summary",
    messages: ["First message"],
    anchors: {
      pageUrl: "https://example.com/a",
      domain: "example.com",
      entities: [{ id: "e1", label: "Alpha", type: "person" }],
      relationships: []
    },
    pinned: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    lastTouched: "2024-01-02T00:00:00.000Z"
  },
  {
    chatId: "chat-2",
    title: "Beta domain note",
    messages: ["Contains beta snippet"],
    anchors: {
      pageUrl: "https://beta.io/page",
      domain: "beta.io",
      entities: [{ id: "e2", label: "Beta", type: "brand" }],
      relationships: [{ id: "r1", type: "mentions", fromId: "e2", toId: "e1", label: "Mentions" }]
    },
    pinned: true,
    createdAt: "2024-02-01T00:00:00.000Z",
    updatedAt: "2024-02-01T00:00:00.000Z",
    lastTouched: "2024-02-02T00:00:00.000Z"
  }
];

describe("filterChats", () => {
  it("matches title search case-insensitively", () => {
    const result = filterChats(baseChats, { query: "alpha" });
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].chatId).toBe("chat-1");
  });

  it("filters by domain scope when provided", () => {
    const result = filterChats(baseChats, { scope: { domain: "beta.io" } });
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].chatId).toBe("chat-2");
  });

  it("filters by entity intersection when entityIds provided", () => {
    const result = filterChats(baseChats, { scope: { entityIds: ["e1"] } });
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].chatId).toBe("chat-1");
  });

  it("honors message search when includeMessages enabled", () => {
    const result = filterChats(baseChats, { query: "snippet", includeMessages: true });
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].chatId).toBe("chat-2");
  });

  it("limits results and marks truncated when over limit", () => {
    const expanded = Array.from({ length: 5 }).map((_, idx) => ({
      ...baseChats[0],
      chatId: `clone-${idx}`,
      title: `Clone ${idx}`
    }));
    const result = filterChats(expanded, { limit: 3 });
    expect(result.chats).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("respects domain scope combined with query against entity labels", () => {
    const result = filterChats(baseChats, {
      scope: { domain: "beta.io" },
      query: "beta"
    });
    expect(result.chats.map((c) => c.chatId)).toEqual(["chat-2"]);
  });

  it("requires both entityIds and relationshipIds when provided together", () => {
    const result = filterChats(baseChats, {
      scope: { entityIds: ["e2"], relationshipIds: ["r1"] }
    });
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].chatId).toBe("chat-2");
  });

  it("includeMessages toggle governs message-only matches", () => {
    const chats = [
      {
        ...baseChats[0],
        chatId: "msg-only",
        title: "No match title",
        messages: ["special-token"]
      }
    ];
    const withMessages = filterChats(chats, { query: "special-token", includeMessages: true });
    const withoutMessages = filterChats(chats, { query: "special-token", includeMessages: false });
    expect(withMessages.chats).toHaveLength(1);
    expect(withoutMessages.chats).toHaveLength(0);
  });

  it("keeps pinned chats ahead of non-pinned in filtered results", () => {
    const mixed = [
      { ...baseChats[0], chatId: "p1", pinned: true, lastTouched: "2024-01-02T00:00:00.000Z" },
      { ...baseChats[0], chatId: "np1", pinned: false, title: "Alpha again", lastTouched: "2024-01-03T00:00:00.000Z" }
    ];
    const result = filterChats(mixed, { query: "alpha" });
    expect(result.chats.map((c) => c.chatId)).toEqual(["p1", "np1"]);
  });
});
