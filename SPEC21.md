# SPEC21: Overlay Chat IA & UX Skeleton

## Objective
Define the chat information architecture and baseline overlay UX so users can create, view, and organize chats anchored to ontologified pages/entities, setting the contracts that later specs will implement.

## Scope
- **In scope:** chat/anchor data model; flows for new chat from page or entity/relationship; grouping views (pinned, recent, by-entity); panel placement/behavior; MVP constraints.
- **Out of scope:** persistence/storage; search/filter; delete/archive; message generation changes; cross-tab/device sync; full visual polish.

## Context
- Builds on overlay shell and ontologifier outputs established through SPEC2–SPEC3 and memory/chat work up to SPEC20 (popup chat). This spec introduces overlay-specific chat IA.
- Reuses ontology data already surfaced for memory anchors (page URL/domain, entity/relationship ids/types/labels) from specs 15–19.
- Should keep terminology aligned with shared types in `extension/src/types/messages.ts` and schemas in `server/src/schema.ts` for future interoperability.

## Deliverables
1. Chat domain model with anchor requirements and timestamps, expressed in TypeScript-friendly shapes that can sit next to existing message types.
2. UX flows covering creation from page/entity/relationship and browsing/grouping within the overlay.
3. Panel placement, open/close behavior, and interaction rules compatible with existing memory HUD + ontology affordances.
4. Explicit MVP constraints and a tracked list of open questions to hand to later specs.

## Domain Model (front-of-client, ephemeral for MVP)
- `Chat`  
  - `chatId: string` (UUID v4)  
  - `title: string` (user editable; default “Chat about <entity|page title|domain>”)  
  - `messages: string[]` (ordered references to message IDs; messages themselves live in future persistence layer)  
  - `anchors: AnchorSet` (see below)  
  - `pinned: boolean`  
  - `createdAt: ISO 8601`  
  - `updatedAt: ISO 8601` (system-driven when title/pin/anchor changes)  
  - `lastTouched: ISO 8601` (updates on every open or message append; drives “recent”)  
- `Message` (reference only for now)  
  - `messageId`, `role: "user" | "assistant"`, `content: string`, `createdAt`  
  - Stored outside this spec; chats keep only IDs to allow later persistence/backfill.  
- `AnchorSet`  
  - `pageUrl: string` (required for page-launched chats; optional for pure entity/relationship chat)  
  - `domain?: string` (normalized host; aligns with `MemoryQueryFilters.domain`)  
  - `entities: AnchorEntity[]` (0–N)  
  - `relationships: AnchorRelationship[]` (0–N)  
- `AnchorEntity`  
  - `id: string` (ontology/global ID)  
  - `label: string` (user-friendly surface)  
  - `type: EntityType` (reuse from `server/src/schema/ontology.ts`)  
  - `source?: "selection" | "memory-hit" | "manual"` (provenance hint for UI chips)  
- `AnchorRelationship`  
  - `id: string`  
  - `type: RelationType` (aligned to ontology)  
  - `fromId: string`, `toId: string` (entity IDs)  
  - `label?: string` (humanized relationship name)  
- Derived views:  
  - `isRelevantToPage(url)`: true if `pageUrl` matches or `domain` matches current page host.  
  - `isRelevantToEntity(entityId)`: true if `entityId` in `anchors.entities`.  
  - Grouping keys: `pinned`, `lastTouched desc`, `entity label asc`.

## UX Flows
- **Entrypoints**  
  - Persistent launcher button in overlay chrome (opposite side of memory HUD to avoid conflicts).  
  - Inline CTA on ontology hover card: “Start chat about \<entity\>”.  
  - Context menu action on selected text/entity highlight: “Open chat (entity anchor)”.
- **Create from current page**  
  1) User opens launcher → “Start new chat” button.  
  2) Default anchors: `pageUrl` (required) + `domain`; pre-populate `entities` from current selection if available.  
  3) User can toggle one entity chip on/off (single-selection for MVP).  
  4) Chat appears in list under “Recent” and opens in detail view.  
- **Create from entity/relationship**  
  1) Triggered from hover card or selection with ontology context.  
  2) Required: chosen `AnchorEntity` or `AnchorRelationship`; optional `pageUrl`/`domain` captured if available.  
  3) Title defaults to entity/relationship label.  
  4) Detail view opens with anchor chips shown; page context chip if present.  
- **Browsing & opening**  
  - Default list shows two sections: `Pinned` (sorted `lastTouched desc`) then `Recent` (max 10, `lastTouched desc`).  
  - “By entity” tab groups chats under headings per `AnchorEntity.label` (alphabetical), showing up to 5 chats per entity; chats without entities fall under “Unanchored”.  
  - When overlay is opened on a page, auto-scroll/highlight chats where `isRelevantToPage` or matching entity IDs exist.  
- **Chat detail**  
  - Right drawer overlays list; header shows title (editable inline) + anchor chips (page/domain/entity/relationship).  
  - First message composer present; message send behavior unchanged from SPEC20 (single turn placeholder until later specs).  
  - Back button returns to list; ESC closes drawer; backdrop click closes drawer but keeps overlay shell visible.

## Panel Placement & Interaction
- Drawer anchored to right edge of overlay canvas; baseline width 360–420px, min 320px to preserve message readability.  
- Z-index sits above memory detail drawers but below global overlay shell controls; share token with existing overlay stack.  
- Focus trap inside drawer when open; tab cycles through header → list → composer; ESC closes and returns focus to launcher.  
- Opening the drawer shifts underlying content area but does not resize existing HUD badges; on narrow viewports drawer overlays instead of pushing.  
- Close affordances: ESC, backdrop click, close icon in header, and clicking launcher when already open (toggles).  
- Prevent scroll bleed: drawer scroll is independent; body/overlay scroll locked while drawer open.

## MVP Constraints
- No search/filter; only sections described above.  
- Visible chats capped at 10 in Recent and 5 per entity section; older chats hidden until persistence arrives.  
- Single anchor selection per creation flow (one entity OR one relationship chip active alongside page/domain).  
- No delete/archive/unpin via UI; pinned toggle is the only mutating action besides renaming.  
- State is in-memory per tab; reload or closing overlay clears chats and pin state.  
- Message history is placeholder references only; sending is stubbed or reuses SPEC20 popup handler without persistence.  
- One drawer instance at a time; opening chat detail closes other overlay subpanels that compete for space.

## Open Questions (defer)
- Storage backend: IndexedDB vs `chrome.storage.local`/`sync`; how to cap size and handle TTL.  
- Multi-page anchors: should chats be multi-home across URLs/domains; how to reconcile when user navigates mid-chat.  
- Migration strategy for SPEC20 popup conversations: import, link, or intentionally ignore for overlay.  
- Delete/archive semantics + retention policy; how pins interact with retention.  
- Cross-tab visibility: keep per-tab only or broadcast via runtime messaging.  
- How “entity grouping” should behave when ontology confidence is low or multiple labels map to same ID.

## Stretch / Next Steps (Optional)
- ASCII states for launcher/list/detail to validate layout before UI work.  
- A11y checks: ensure launcher is reachable via keyboard, provide `aria-expanded` on toggle, maintain focus order consistent with memory HUD, announce anchor chips to screen readers.

## Implementation Notes (guidance for future specs)
- Align anchor shapes with `EntityType`/`RelationType` enums from `server/src/schema/ontology.ts` to avoid drift.  
- When persistence lands, chat list queries should be keyed by `domain` + `entityIds` to reuse memory filter logic.  
- Keep message payloads lightweight to avoid bloating overlay state; paginate in future specs once persistence exists.
