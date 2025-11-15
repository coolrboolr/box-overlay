/**
 * Overlay chat domain model (see SPEC21: Overlay Chat IA & UX Skeleton).
 * Types only; no runtime imports or behavior.
 */
import type { EntityType, RelationType } from "./ontology";

/**
 * Anchored entity selected or inferred for a chat.
 */
export interface AnchorEntity {
  id: string;
  label: string;
  type: EntityType;
  source?: "selection" | "memory-hit" | "manual";
}

/**
 * Relationship anchor connecting two entities within a chat.
 */
export interface AnchorRelationship {
  id: string;
  type: RelationType;
  fromId: string;
  toId: string;
  label?: string;
}

/**
 * Set of anchors that tie a chat to its page/domain and ontology objects.
 * pageUrl is optional to allow pure entity/relationship chats per SPEC21.
 */
export interface AnchorSet {
  pageUrl?: string;
  domain?: string;
  entities: AnchorEntity[];
  relationships: AnchorRelationship[];
}

/**
 * Overlay chat object per SPEC21. Message IDs are stored by reference only.
 */
export interface Chat {
  chatId: string;
  title: string;
  messages: string[];
  anchors: AnchorSet;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastTouched: string;
}
