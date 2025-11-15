# SPEC25: Search, Filtering, Quality Bar, and UX Polish

## Objective
Add search/filter and UX polish so the overlay chat is performant, discoverable, and reliable at scale, enabling quick retrieval by title or ontology anchors.

## Scope
- In scope: search/filter by title, page URL/domain, entity/relationship labels/types, and optionally short message snippets; extended `useChats` filtering; UI search input + filter chips; empty/loading/error states; performance guardrails; optional logging/telemetry hooks.
- Out of scope: cloud sync or multi-user search; semantic/vector search; heavy analytics setup; delete/archive.

## Context
- Builds on functional flows from SPEC24 and storage from SPEC23.
- Can reuse telemetry/logging utilities introduced in earlier specs (SPEC10, SPEC18) if present; must no-op safely otherwise.
- Should maintain grouping semantics (pinned first, then recent/relevant) while filtering.

## Implementation Plan
1) Add in-memory search helpers over chat datasets to filter by title, page URL/domain, entity/relationship labels/types, and optional message snippets; keep operations fast for MV3 constraints.
2) Extend `useChats` to accept filter params and return filtered + grouped results while preserving pin ordering.
3) Add search input and filter chips (page/domain/entity/relationship) to `ChatPanel` list header; default filters reflect current page/context.
4) Implement empty-state variants: no chats at all, no search results, no ontology context; provide retry UI for recoverable errors.
5) Add loading indicators for initial load and during search; consider basic list virtualization when counts exceed a threshold (e.g., 200 chats) and cap rendered results as a guardrail.
6) Ensure responsiveness: avoid blocking main thread; debounce input; measure basic timing and log warnings if outliers detected.
7) If logging/telemetry util exists, emit non-fatal events for search/filter usage and performance outliers; otherwise no-op without errors.

## Files and Surfaces to Touch (best guess)
- `extension/src/components/chat/ChatPanel.tsx`, `ChatList.tsx`, `ChatFilters.tsx` (new)
- `extension/src/hooks/useChats.ts` (add filter params)
- `extension/src/services/chat-store.ts` (search helpers/indexing)
- `extension/src/utils/*` telemetry/logging module if present

## Acceptance Criteria
- Users can narrow chats by title and ontology anchors (page/domain/entity/relationship); results update within ~200ms on typical datasets.
- Filter chips/toggles reflect current context defaults; clearing filters restores grouped list with pinned first.
- Empty, loading, and error states are explicit and navigable; no console errors or silent failures.
- UI remains responsive with dozens to hundreds of chats; guardrails (capping/virtualization) prevent jank.
- Telemetry events emit when a logging utility exists; otherwise feature operates without logging errors.

## Stretch / Next Steps (Optional)
- Basic full-text search with snippet highlighting.
- Export/import chats for backup or migration.
