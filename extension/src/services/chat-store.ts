import type { Chat } from "../types/chat";

const STORAGE_KEY = "llm-overlay-chats";
const MAX_FALLBACK_CHATS = 50;

export interface ChatAnchorScope {
  pageUrl?: string;
  domain?: string;
  entityIds?: string[];
  relationshipIds?: string[];
}

export interface ChatFilterOptions {
  query?: string;
  scope?: ChatAnchorScope;
  includeMessages?: boolean;
  limit?: number;
}

export interface ChatFilterResult {
  chats: Chat[];
  truncated: boolean;
  durationMs: number;
}

function loadFromStorage(): Chat[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as Chat[];
  } catch {
    return [];
  }
}

function persistToStorage(chats: Chat[]): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, MAX_FALLBACK_CHATS)));
  } catch {
    // ignore write failures; storage may be blocked or full
  }
}

function getDomainFromUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function buildDefaultChats(): Chat[] {
  const now = new Date().toISOString();
  const pageUrl = typeof window !== "undefined" ? window.location.href : "https://example.com";
  const domain = getDomainFromUrl(pageUrl) ?? "example.com";

  return [
    {
      chatId: "chat-seed-pinned",
      title: "Current page overview",
      messages: ["Quick recap of this page", "Key points to revisit later"],
      anchors: {
        pageUrl,
        domain,
        entities: [
          { id: "entity-page", label: "This page", type: "article" },
          { id: "entity-example", label: "Example anchor", type: "unknown" }
        ],
        relationships: []
      },
      pinned: true,
      createdAt: now,
      updatedAt: now,
      lastTouched: now
    },
    {
      chatId: "chat-seed-entity",
      title: "Entity follow-ups",
      messages: ["Need to reach out to contacts at Widgets Inc."],
      anchors: {
        pageUrl,
        domain,
        entities: [{ id: "entity-widgets", label: "Widgets Inc", type: "brand" }],
        relationships: []
      },
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastTouched: now
    },
    {
      chatId: "chat-seed-relationship",
      title: "Relationship notes",
      messages: ["Track mention flow between author and subject."],
      anchors: {
        pageUrl,
        domain,
        entities: [
          { id: "entity-author", label: "Sample person", type: "person" },
          { id: "entity-subject", label: "Subject", type: "topic" }
        ],
        relationships: [
          {
            id: "rel-mentions",
            type: "mentions",
            fromId: "entity-author",
            toId: "entity-subject",
            label: "Mentions this topic"
          }
        ]
      },
      pinned: false,
      createdAt: now,
      updatedAt: now,
      lastTouched: now
    }
  ];
}

export async function listChats(): Promise<Chat[]> {
  const stored = loadFromStorage();
  if (stored.length) {
    return stored;
  }
  const defaults = buildDefaultChats();
  persistToStorage(defaults);
  return defaults;
}

function intersectsById<T extends { id: string }>(a: T[], ids?: string[]): boolean {
  if (!ids || ids.length === 0) {
    return true;
  }
  return a.some((item) => ids.includes(item.id));
}

function matchesScope(chat: Chat, scope?: ChatAnchorScope): boolean {
  if (!scope) {
    return true;
  }
  if (scope.pageUrl && chat.anchors.pageUrl !== scope.pageUrl) {
    return false;
  }
  if (scope.domain && chat.anchors.domain !== scope.domain) {
    return false;
  }
  if (!intersectsById(chat.anchors.entities, scope.entityIds)) {
    return false;
  }
  if (!intersectsById(chat.anchors.relationships, scope.relationshipIds)) {
    return false;
  }
  return true;
}

export function filterChats(chats: Chat[], options: ChatFilterOptions): ChatFilterResult {
  const start = performance.now();
  const {
    query,
    scope,
    includeMessages = true,
    limit = 200
  } = options;
  const needle = query?.trim().toLowerCase();
  const results: Chat[] = [];
  let truncated = false;

  for (const chat of chats) {
    if (!matchesScope(chat, scope)) {
      continue;
    }

    if (needle) {
      const candidateStrings: string[] = [
        chat.title,
        chat.anchors.pageUrl ?? "",
        chat.anchors.domain ?? "",
        ...chat.anchors.entities.map((e) => e.label),
        ...chat.anchors.entities.map((e) => e.type),
        ...chat.anchors.relationships.map((rel) => rel.label ?? ""),
        ...chat.anchors.relationships.map((rel) => rel.type)
      ];

      if (includeMessages) {
        candidateStrings.push(...chat.messages);
      }

      const matched = candidateStrings.some((value) =>
        value ? value.toLowerCase().includes(needle) : false
      );
      if (!matched && includeMessages) {
        // no-op; messages already included
      }
      if (!matched) {
        continue;
      }
    }

    results.push(chat);
    if (results.length >= limit) {
      truncated = true;
      break;
    }
  }

  const durationMs = performance.now() - start;

  const sorted = results.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.lastTouched).getTime() - new Date(a.lastTouched).getTime();
  });

  return {
    chats: sorted,
    truncated,
    durationMs
  };
}

export function upsertChats(nextChats: Chat[]): void {
  persistToStorage(nextChats);
}
