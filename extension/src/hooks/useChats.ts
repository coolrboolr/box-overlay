import { useEffect, useMemo, useRef, useState } from "react";
import type { Chat } from "../types/chat";
import type { ChatAnchorScope, ChatFilterOptions } from "../services/chat-store";
import { filterChats, listChats } from "../services/chat-store";

export interface ChatFilterToggles {
  includePage: boolean;
  includeDomain: boolean;
  includeEntities: boolean;
  includeRelationships: boolean;
  includeMessages: boolean;
}

export interface UseChatsOptions {
  query?: string;
  scope?: ChatAnchorScope;
  includeMessages?: boolean;
  limit?: number;
}

export interface UseChatsResult {
  chats: Chat[];
  pinned: Chat[];
  recent: Chat[];
  totalCount: number;
  filteredCount: number;
  loading: boolean;
  error?: Error;
  truncated: boolean;
  durationMs: number;
  refresh(): void;
}

const WARN_THRESHOLD_MS = 200;

function emitTelemetry(event: string, detail?: Record<string, unknown>): void {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "DEV_TELEMETRY_EVENT",
        schemaVersion: 1,
        payload: { event, detail }
      });
    }
  } catch {
    // ignore telemetry failures
  }
}

export function useChats(options: UseChatsOptions): UseChatsResult {
  const [allChats, setAllChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();
  const pendingRef = useRef(false);

  const refresh = (): void => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setLoading(true);
    listChats()
      .then((list) => {
        setAllChats(list);
        setError(undefined);
      })
      .catch((err) => setError(err instanceof Error ? err : new Error("Failed to load chats")))
      .finally(() => {
        pendingRef.current = false;
        setLoading(false);
      });
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!allChats.length) {
      return {
        chats: [],
        truncated: false,
        durationMs: 0
      };
    }
    const result = filterChats(allChats, {
      query: options.query,
      scope: options.scope,
      includeMessages: options.includeMessages,
      limit: options.limit ?? 200
    } satisfies ChatFilterOptions);

    if (result.durationMs > WARN_THRESHOLD_MS && typeof console !== "undefined") {
      console.warn("[chat] filtering exceeded threshold", {
        durationMs: result.durationMs,
        total: allChats.length,
        query: options.query
      });
      emitTelemetry("MEMORY_FILTERS", {
        durationMs: result.durationMs,
        total: allChats.length,
        filtered: result.chats.length
      });
    }

    return result;
  }, [allChats, options.query, options.scope, options.includeMessages, options.limit]);

  const pinned = useMemo(() => filtered.chats.filter((chat) => chat.pinned), [filtered.chats]);
  const recent = useMemo(() => filtered.chats.filter((chat) => !chat.pinned), [filtered.chats]);

  return {
    chats: filtered.chats,
    pinned,
    recent,
    totalCount: allChats.length,
    filteredCount: filtered.chats.length,
    truncated: filtered.truncated,
    durationMs: filtered.durationMs,
    loading,
    error,
    refresh
  };
}
