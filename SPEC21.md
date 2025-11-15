# SPEC21: Overlay Chat IA & UX Skeleton

## Objective
Define the chat information architecture and baseline overlay UX so users can create, view, and organize chats anchored to ontologified pages/entities, setting the contracts that later specs will implement.

## Scope
- In scope: chat/anchor data model; flows for new chat from page or entity/relationship; grouping views (pinned, recent, by-entity); panel placement/behavior; MVP constraints.
- Out of scope: persistence/storage; search/filter; delete/archive; message generation changes; cross-tab/device sync; full visual polish.

## Context
- Builds on overlay shell and ontologifier outputs established through SPEC2–SPEC3 and memory/chat work up to SPEC20 (popup chat). This spec introduces overlay-specific chat IA.
- Reuses ontology data already surfaced for memory anchors (page URL/domain, entity/relationship ids/types/labels) from specs 15–19.
- Should keep terminology aligned with shared types in `extension/src/types/messages.ts` and schemas in `server/src/schema.ts` for future interoperability.

## Implementation Plan
1) Review current overlay layout and entrypoints to place a persistent chat launcher without conflicting with memory HUD/controls from SPEC16–SPEC20.
2) Define chat domain model:
   - `chatId`, `title`, `messages[]` (references only), `anchors: AnchorSet { pageUrl, domain?, entities: AnchorEntity[], relationships: AnchorRelationship[] }`, `pinned`, `createdAt`, `updatedAt`, `lastTouched`.
3) Document UX flows:
   - New chat from current page (page anchor required; optional entities from current selection).
   - New chat from selected entity/relationship (entity/relationship anchors required; page anchor optional but recommended).
   - Browsing relevant chats for current page/entities; grouping modes: pinned, recent, by-entity (entity label headings).
4) Specify panel placement/behavior: right-hand drawer inside overlay, minimum usable width, focus trap, ESC/backdrop close, z-index harmony with existing panels.
5) Enumerate MVP constraints: no search; no persistence; cap visible chats (e.g., top 10 recent); single-anchor selection per creation flow; no delete/archive; reload resets state.
6) Record Open Questions to hand off to later specs:
   - Storage choice (IndexedDB vs chrome.storage) and cross-device sync expectations.
   - Handling multi-page anchors and user navigation between pages/tabs.
   - Migration or deliberate ignoring of legacy popup chat history (SPEC20) for overlay UX.
   - Future delete/archive semantics and retention policy.

## Files and Surfaces to Touch (best guess)
- `SPEC21.md` (this spec).
- Optional design notes `docs/chat-ia-notes.md`.
- Reference-only review of overlay structure in `extension/src/components` and state in `extension/src/state`.

## Acceptance Criteria
- Chat object model documented with required anchor fields and metadata.
- UX flows written for creating and viewing chats by page/entity with grouping modes (pinned/recent/by-entity).
- Panel placement and open/close behavior defined and compatible with existing overlay controls.
- MVP constraints and Open Questions listed explicitly.

## Stretch / Next Steps (Optional)
- ASCII wireframes for primary states (launcher, list, detail).
- Accessibility notes covering focus order, focus trap, and keyboard close.
