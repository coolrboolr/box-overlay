# Chat IA / UX Notes (SPEC21)

Working notes that summarize the overlay chat information architecture defined in **SPEC21: Overlay Chat IA & UX Skeleton**. Intended as a quick reference for implementers before wiring storage or UI in later specs.

## Domain Model (high level)
- Chat: `chatId`, `title`, `messages[]` (ID refs only), `anchors`, `pinned`, `createdAt`, `updatedAt`, `lastTouched`.
- Anchors: optional `pageUrl`, optional `domain`, `entities[]`, `relationships[]`.
- Anchor entity: `id`, `label`, `type`, optional `source` (`selection | memory-hit | manual`).
- Anchor relationship: `id`, `type`, `fromId`, `toId`, optional `label`.
- Relevance helpers (future): match by `pageUrl`/`domain` or entity IDs for grouping and highlighting.

## Key UX Flows
- Create from page: launcher → “Start new chat”, auto-anchor page/domain, allow one entity chip from current selection.
- Create from entity/relationship: entry from hover card/selection, anchor required, optional page/domain capture, title seeded from label.
- Browse & open: sections for `Pinned` (by `lastTouched`) and `Recent` (max 10), plus “By entity” tab grouping chats under entity labels.
- Chat detail: right drawer view with editable title, anchor chips, composer stub (SPEC20 behavior), back/ESC/backdrop closes.

## Panel Placement & Interaction
- Right-edge drawer inside overlay; baseline width 360–420px (min 320px); overlays on narrow viewports.
- Focus trap while open; ESC/backdrop/close icon/launcher toggle all close the drawer and return focus.
- Drawer sits above memory detail panes but below global overlay chrome; body scroll locked to avoid bleed.

## MVP Constraints
- No search/filter; cap Recent at 10 and entity group rows at 5.
- Single anchor selection per creation flow; no delete/archive; pinned toggle only mutation besides rename.
- State is in-memory per tab—reload clears chats; messages are placeholder references (no persistence yet).
- Only one drawer at a time; opening closes competing overlay subpanels.

## Open Questions to Revisit
- Storage backend (IndexedDB vs `chrome.storage.*`) and sync expectations.
- Multi-page anchoring and navigation between pages/tabs.
- Migration/ignoring of SPEC20 popup history for overlay.
- Delete/archive semantics and retention policy; interaction with pins.
- Cross-tab visibility and how to group when ontology confidence is low or labels collide.
