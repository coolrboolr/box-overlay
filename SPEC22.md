# SPEC22: Implement Box-Overlay Chat Panel Shell

## Objective
Ship the visible chat panel shell in box-overlay with open/close behavior, stubbed chat list/detail, and ontology placeholder text, preparing the surface for real data.

## Scope
- In scope: React chat panel components; launcher in overlay chrome; split layout (list + detail); ontology context placeholder; keyboard/mouse accessibility; theming consistent with existing panels.
- Out of scope: Real persistence; search/filter; analytics; LLM message handling; delete/archive.

## Context
- Depends on IA decisions in SPEC21.
- Should follow overlay state patterns used in earlier specs (e.g., HUD controls from SPEC16–SPEC20) via global store (overlay state).
- Ontology context hook already used for memory features can provide stub anchors (page URL/domain, entities) for display.

## Implementation Plan
1) Add chat launcher control to overlay toolbar/header; wire a boolean `chatPanelOpen` in global overlay state; ESC/backdrop should close panel.
2) Implement `ChatPanel` component with split layout: left chat list (stub entries with title + pinned flag), right detail placeholder.
3) Apply focus management: focus trap while open, tab order through controls, ESC to close; set ARIA roles appropriate for modal/drawer.
4) Render stub "Anchored to: page URL, entities…" section using ontology context hook; stub entities when absent.
5) Style to match existing overlay panels; prevent overlap with memory HUD; ensure minimum width/responsive behavior.
6) Add basic smoke test/harness toggle if harness exists; no persistence yet so reload resets stubs.

## Files and Surfaces to Touch (best guess)
- `extension/src/components/chat/ChatPanel.tsx`
- `extension/src/components/chat/ChatList.tsx`, `ChatDetail.tsx` (or similar split)
- `extension/src/state/overlayStore.ts` (add `chatPanelOpen` flag + actions)
- `extension/src/hooks/useOntologyContext.ts` (read-only usage)
- `extension/src/styles/*` for panel theming

## Acceptance Criteria
- Chat panel opens/closes via launcher, ESC, and backdrop without console errors.
- Stub chat list and detail placeholders render, including ontology context text.
- Focus trap and keyboard interactions function; ARIA roles are set appropriately.
- Reloading returns to stub state (no persistence implied at this stage).

## Stretch / Next Steps (Optional)
- Optional resize handle for panel width.
- Skeleton shimmer placeholders for list/detail while loading in later specs.
