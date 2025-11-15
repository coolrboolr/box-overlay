import type { MemoryQueryFilters } from "../schema";

type Role = "user" | "assistant";

export interface ConversationTurn {
  role: Role;
  content: string;
  sourceIds?: string[];
}

export interface ConversationSession {
  id: string;
  lastQuery?: string;
  lastAnswer?: string;
  lastSourceIds?: string[];
  appliedFilters?: MemoryQueryFilters;
  history: ConversationTurn[];
  updatedAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HISTORY_LIMIT = 3;

export class ConversationStore {
  private readonly sessions = new Map<string, ConversationSession>();

  getOrCreate(conversationId: string): ConversationSession {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.updatedAt = Date.now();
      return existing;
    }
    const session: ConversationSession = {
      id: conversationId,
      history: [],
      updatedAt: Date.now()
    };
    this.sessions.set(conversationId, session);
    return session;
  }

  update(conversationId: string, patch: Partial<ConversationSession>): ConversationSession | null {
    const session = this.sessions.get(conversationId);
    if (!session) {
      return null;
    }
    const updated: ConversationSession = {
      ...session,
      ...patch,
      history: patch.history ?? session.history,
      updatedAt: Date.now()
    };
    updated.history = updated.history.slice(-HISTORY_LIMIT);
    this.sessions.set(conversationId, updated);
    return updated;
  }

  pruneExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }

  clear(conversationId: string): void {
    this.sessions.delete(conversationId);
  }
}

export const conversationStore = new ConversationStore();
