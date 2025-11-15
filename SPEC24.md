# SPEC24: In-Overlay Chat Creation & Organization Flows

## Objective
Wire the overlay chat UI to persistence so users can create chats from page/entity context, view relevant chats, and organize via pin/rename/grouping within box-overlay.

## Scope
- In scope: connect SPEC22 UI to SPEC23 persistence/hooks; creation flows from page and entity/relationship; contextual listing; pin/unpin; rename; grouping (pinned/recent/by-entity); state for active chat; empty/loading/error handling; keyboard accessibility.
- Out of scope: delete/archive (deferred); advanced search/filter (SPEC25); cross-device sync; rich composer changes.

## Context
- Depends on SPEC22 shell and SPEC23 storage/hooks.
- Uses ontology context hook to prefill anchors; should respect overlay interaction patterns established in prior specs (ESC close, focus trap, HUD coexistence).
- Aligns with memory anchor semantics so chats and memory can share ontology identifiers.

## Implementation Plan
1) Replace stub data in `ChatPanel` with `useChats` results filtered by current `pageUrl` and visible ontology entity/relationship IDs.
2) Add “New chat from here” action that captures page/domain and any selected entities; persist via `createChat` and set `activeChatId` in overlay/global state.
3) Add “New chat on this entity/relationship” entrypoint from entity UI (chips/context menu) that seeds anchors and opens the panel.
4) Maintain `activeChatId` in overlay/global state so other components can react (e.g., detail view, badges).
5) Group list view: pinned first, then recent; add toggle/view for “by entity” grouping with entity label headings and their chats beneath.
6) Implement pin/unpin and inline rename actions with optimistic UI updates and persistence via `updateChatMetadata`.
7) Display context chips in the detail header (page, entities, relationships); ensure clarity with multiple anchors.
8) Handle empty/loading/error states explicitly; keep keyboard navigation and focus trap intact; no console errors.

## Files and Surfaces to Touch (best guess)
- `extension/src/components/chat/ChatPanel.tsx`, `ChatList.tsx`, `ChatDetail.tsx`
- `extension/src/components/entity/*` (to add "Start chat"/context menu actions)
- `extension/src/hooks/useChats.ts`, `useChat.ts`
- `extension/src/services/chat-store.ts` (minor adjustments if needed)
- `extension/src/state/overlayStore.ts` (add `activeChatId` and actions)
- `extension/src/styles/*` for chip/group styling

## Acceptance Criteria
- Users can create chats from current page or a specific entity/relationship; anchors are stored and shown as chips.
- Chat list shows chats relevant to current context; pinned appear first; by-entity grouping available via toggle.
- Pin/unpin and rename persist and reflect immediately in UI.
- Active chat state drives detail view; empty/loading/error states are visible; keyboard/ESC close still works; no console errors.

## Stretch / Next Steps (Optional)
- Drag-to-reorder pinned chats.
- Keyboard shortcuts for new chat and pin toggle.
