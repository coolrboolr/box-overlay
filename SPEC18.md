# SPEC18: Memory Polishing — Filters, Answers, & Quality Gates

## Objective
Refine the memory experience with richer metadata filters, highlight callbacks back into the page, answer-quality safeguards, maintenance tooling, and telemetry so the feature is production-ready.

## Scope
- **In scope:** backend filter/query enhancements, popup filter UI, highlight plumbing, answer guardrails, maintenance endpoints, schema-version enforcement, telemetry/tests/docs.
- **Out of scope:** new ingestion sources, cross-device sync, multi-user profiles.

## Deliverables
1. **Filterable Query Surface**
   - Extend `/api/memory/query` schemas with `domains: string[]`, `tags: string[]`, `since`, `until`, `limit`.
   - Update `MemoryStore.search` to apply filters server-side before ranking.
   - Popup UI gains filter chips/dropdowns for domain(s), date range presets, and tag selector (populated from stored metadata once SPEC19 lands; for now allow free text).
   - Harness receives a “Filter Builder” panel to exercise combinations.
2. **Open & Highlight Flow**
   - Background worker handles `{ type: "MEMORY_HIGHLIGHT" }` from popup cards, finds the active tab containing the matching URL (or opens a new one), and sends `{ type: "MEMORY_HIGHLIGHT_RENDER", payload: { sourceId, snippet } }` to the content script.
   - Content script module `extension/src/content/highlight.ts` scrolls to target anchor (using stored `sourceId` fallback to text search), applies temporary highlight styles (reuse overlay palette), and auto-clears after timeout.
3. **Answer Guardrails & Source Chips**
   - Backend answer generation pipeline enforces snippet truncation, includes explicit citation instructions, and rejects answers that repeat the query verbatim.
   - Popup renders an answer box with capped text (~120 words) plus source chips linking to result cards; show a neutral message when answer suppressed.
4. **Maintenance & Versioning Utilities**
   - Backend routes (flagged by `ENABLE_MEMORY_ADMIN=true`):
     - `POST /api/memory/clear { confirm: string }` (requires `confirm === "ERASE"`).
     - `POST /api/memory/export` returning a JSON download (set `Content-Disposition`).
   - Implement periodic compaction: after every N (configurable) ingests, rewrite persistence file to remove tombstones.
   - Add shared `MEMORY_SCHEMA_VERSION` exported by both extension + server plus a CI unit test asserting equality; mismatch should log error and block startup.
5. **Telemetry & Tests**
   - Extend telemetry HUD/event stream with counters for `memoryFilters`, `memoryHighlights`, `memoryAnswerFailures`.
   - Backend unit/integration tests for filters, highlight routing stub, maintenance endpoints, guardrail behaviors; popup/content tests for filter UX + highlight rendering.
   - Docs updates covering filters, highlight UX, maintenance endpoints usage, telemetry signals, and troubleshooting steps.

## Implementation Notes
- Highlighting should no-op gracefully if the page/tab is unavailable; surface a toast in popup when highlight fails.
- Limit filter combinations to prevent expensive searches (e.g., cap `domains` to 3 values, date ranges to ≤90 days).
- Maintenance endpoints must remain localhost-only and logged prominently; ensure responses never include raw embeddings.
- Export payload should include schema version + timestamp so users can import later if needed.
- Telemetry logs should avoid storing actual content; focus on IDs and statuses only.

## Dependencies
- SPEC15–SPEC17 must be complete (memory store, ingestion, query/popup UI).

## Acceptance Criteria
- Users can apply domain/date/tag filters via popup, see the query reflected in backend logs, and receive filtered results accordingly.
- Clicking “Open & Highlight” opens/focuses the relevant tab and highlights the snippet within the page for a few seconds.
- Answer guardrails ensure every answer cites sources; low-confidence responses are replaced with a neutral message while results still show.
- Maintenance endpoints support clearing/exporting memory (behind guard flag) and schema-version mismatches are caught automatically (CI + runtime logs).
- Telemetry counters/logs capture filter/highlight/answer events and automated tests cover the new functionality end-to-end.
