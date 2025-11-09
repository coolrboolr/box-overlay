# SPEC17: Memory Query API & Popup UX

## Objective
Enable users to search their local semantic memory through a lightweight assistant-style popup by adding a `/api/memory/query` endpoint, retrieval logic, optional answer synthesis, and an interactive popup connected through the background worker.

## Scope
- **In scope:** backend query endpoint + answer scaffolding, background orchestration, popup UI, tests, documentation.
- **Out of scope:** ingestion changes (SPEC16), advanced metadata filters (handled in SPEC18), highlight callbacks (next spec).

## Deliverables
1. **Backend Query Endpoint**
   - Extend `server/src/memory/store.ts` with `search({ vector, topK, filters })` returning `{ items: MemoryHit[] }` where each hit carries similarity, snippet, metadata, and stored IDs.
   - `server/src/routes/memory.ts` gains `POST /api/memory/query` accepting `{ schemaVersion, query, topK?, filters? }`:
     - Uses embedding adapter from SPEC15 to embed the query.
     - Calls `MemoryStore.search`, trims snippets (≤320 chars), redacts base64 blobs, and returns ordered hits.
     - Honors optional filters: `domain`, `since`, `until`, `limit`.
   - Optional answer generation when `ENABLE_MEMORY_ANSWERS=true`: call Ollama chat endpoint with query + top hits, cap to ~120 words, and include `answer` + `sourceIds`.
   - Add supertest coverage with fake embeddings/LLM stubs.
2. **Runtime Contract & Background Logic**
   - `extension/src/types/messages.ts` gains `MemoryQueryRequest`, `MemoryQueryResponse`, `MemoryQueryError` message types.
   - Background worker update:
     - Listen for `{ type: "MEMORY_QUERY" }` from popup.
     - Use `AbortController` per request so newer queries cancel in-flight fetches.
     - Forward normalized responses (or errors) back via `{ type: "MEMORY_QUERY_RESULT" }` / `{ type: "MEMORY_QUERY_ERROR" }`.
     - Emit telemetry (`recordEvent("memory-query", { duration, results, error })`).
3. **Popup UI/UX**
   - Rebuild `extension/src/popup` (TS/React or vanilla) with:
     - Query input + submit button.
     - Filter pills for “This domain” (prefill using `chrome.tabs.query`), “Past 7 days”, and `topK` dropdown.
     - Result list cards showing title/domain, snippet, capture age, similarity rank, and buttons: `Open`, `Copy Snippet` (clipboard), `Highlight` placeholder (disabled until SPEC18 wiring).
     - Optional answer panel at top with sources list (IDs referencing result titles).
     - Loading, empty, and error states.
   - CSS that reuses overlay palette and supports dark mode via `prefers-color-scheme`.
4. **Testing & Docs**
   - Popup unit/component tests verifying state transitions, filter toggles, copy/open actions, and answer rendering.
   - Background tests for cancellation + error handling.
   - `docs/testing.md` section: “Querying Memory” (how to enable feature, sample queries, interpreting answers) and troubleshooting (no results, backend offline).

## Implementation Notes
- Limit `topK` to ≤8 to keep payloads small; default to 4.
- Format dates via `Intl.RelativeTimeFormat` for readability (e.g., “Saved 3 days ago”).
- When answer generation fails, surface non-blocking toast/inline note rather than breaking results.
- Provide keyboard shortcuts inside popup (Enter to search, `Cmd/Ctrl+L` to focus input).
- Keep popup bundle size modest (<200 kB) by reusing existing utilities; lazy-load heavy components if needed.

## Dependencies
- SPEC15 (memory backend foundation) and SPEC16 (ingestion) must be complete.

## Acceptance Criteria
- `/api/memory/query` returns ranked results within expected latency, honors filters, and optionally includes an answer referencing source IDs.
- Popup allows users to submit queries, see loading/empty/error states, open/copy results, and view synthesized answers when available.
- Rapid consecutive queries cancel older in-flight requests (verified via tests and manual inspection).
- Documentation and automated tests cover backend search, background messaging, and popup rendering/UX flows.
