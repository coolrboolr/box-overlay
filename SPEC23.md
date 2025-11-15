# SPEC23: Chat Persistence & Ontology Linking

## Objective
Define and implement the durable chat schema and local persistence layer with ontology-aware queries so chats can be saved, loaded, and updated for overlay use.

## Scope
- In scope: chat schema with anchors; storage mechanism compatible with MV3; chatStore service with pluggable adapters; CRUD operations; anchor-based listing; metadata updates (pin/rename); React hooks for data access; schema versioning/migrations; unit tests.
- Out of scope: UI wiring (handled in SPEC24); advanced search/filter (SPEC25); cross-device sync unless trivial; delete/archive; LLM streaming changes.

## Context
- Builds on IA from SPEC21 and prepares data for SPEC24 UI wiring.
- Should align with shared type locations (`extension/src/types/messages.ts`) and schema/versioning patterns established in memory specs (SPEC15–SPEC19) and popup chat (SPEC20).
- Ontology anchors reuse ontologifier outputs (page URL/domain, entity/relationship ids/types/labels) already available in overlay context hooks.

## Implementation Plan
1) Finalize chat schema interface:
   - `{ id, title, messages?: string[] | MessageStub[], anchors: AnchorSet { pageUrl, domain?, entities: AnchorEntity[], relationships: AnchorRelationship[] }, pinned, createdAt, updatedAt, lastTouched, schemaVersion }`.
2) Select storage consistent with MV3 (IndexedDB/localforage or `chrome.storage.local`); wrap in `chatStore` service with adapter interface for future backend mirroring.
3) Implement service methods: `createChat`, `getChat`, `listChatsByContext({ pageUrl?, entityIds?, relationshipIds? })`, `updateChatMetadata` (pin/rename), `saveMessages` (append/replace message refs).
4) Add React hooks `useChats` and `useChat` that accept context/filter params and expose `{ data, loading, error }`; include graceful fallback when storage unavailable.
5) Add lightweight schema versioning/migration similar to memory: persist `schemaVersion`, attempt migration, otherwise drop or quarantine malformed/legacy entries.
6) Note open questions: eviction/size limits; backend sync strategy; migration from legacy popup chat history.
7) Write unit tests covering CRUD, anchor filtering, metadata updates, and migration fallbacks using existing harness patterns.

## Files and Surfaces to Touch (best guess)
- `extension/src/types/messages.ts` (chat types/interfaces)
- `extension/src/services/chat-store.ts` (new)
- `extension/src/hooks/useChats.ts`, `useChat.ts` (new)
- Optional schema stub in `server/src/schema.ts` for future sync compatibility
- Tests under `extension/src/__tests__/chat-store.spec.ts`

## Acceptance Criteria
- Chat schema exported with anchors (page URL/domain, entity/relationship ids/types/labels) and metadata fields including `schemaVersion`.
- Storage layer supports create/read/update/list by context and persists pin/rename + messages.
- Hooks provide data/loading/error and handle storage absence gracefully.
- Schema versioning/migration path exists; malformed entries do not crash consumers.
- Unit tests pass for CRUD, anchor filtering, and migration fallback behaviors.

## Stretch / Next Steps (Optional)
- Configurable eviction/size limits with LRU policy.
- Backend adapter interface for optional sync.
