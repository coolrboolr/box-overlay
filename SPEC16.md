# SPEC16: Extension → Memory Ingestion Flow

## Objective
Teach the MV3 extension to capture high-value page content, package it with metadata, and send it to `/api/memory/index` without disrupting existing summarization overlays.

## Scope
- **In scope:** content-script extraction refinements, new runtime messages/contracts, background batching + rate limits, feature flags, tests, and docs.
- **Out of scope:** popup query UI, backend query logic, answer synthesis, advanced filters (future specs).

## Deliverables
1. **Content Capture Helper**
   - `extension/src/content/memory.ts` (or extend `extract.ts`) exporting `buildMemoryItems(root, options)` that returns chunked objects `{ id, sourceId, text, imageData?, url, title, language?, capturedAt, contentType }`.
   - Adds `data-memory-indexed` attributes (or `WeakSet`) to DOM nodes to avoid duplicate sends; stores `sourceId` aligning with overlay anchors for highlight flows later.
   - Harness fixture + Vitest spec validating chunking, metadata population, and dedupe tagging.
2. **Runtime Contract Updates**
   - `extension/src/types/messages.ts` gains:
     - `MemoryIndexItem`, `MemoryIndexRequest`, `MemoryIndexResultItem`.
     - Message union entries for `{ type: "MEMORY_INDEX_REQUEST" }` and `{ type: "MEMORY_INDEX_RESULT" }`.
   - Shared schema mirrored in `server/src/schema.ts` (spec15) so types stay aligned.
3. **Background Worker Plumbing**
   - `extension/src/background/index.ts` enhancements:
     - Listener for `MEMORY_INDEX_REQUEST` that queues payloads per-tab, batches up to configurable `MEMORY_BATCH_SIZE` (default 5), debounces submission (e.g., 2 s idle), and POSTs to `/api/memory/index` via existing fetch helper.
     - Support for `Alt+Shift+M` chrome command to bypass debounce and flush queue immediately.
     - Response routing: send `{ type: "MEMORY_INDEX_RESULT", payload: { items: [...] } }` back to originating tab/frame so overlays/UI can update state.
     - Feature flag `MEMORY_CAPTURE_ENABLED` stored in `chrome.storage.sync` with fallback to build-time env; background reads value once per tab session and watches for changes.
4. **Content Script Wiring & UX Hooks**
   - `extension/src/content/index.ts` (or new controller) triggers `buildMemoryItems` after overlays render and when user invokes the save hotkey.
   - Adds lightweight HUD/console events (reusing telemetry store from SPEC10) to log `{ status: 'indexed' | 'duplicate' | 'failed' }` counts per batch.
5. **Docs & Harness**
   - `docs/testing.md` + README updates describing how to enable memory capture, use the keyboard shortcut, inspect background logs, and verify via curl `GET /api/memory/stats`.
   - Harness (`extension/static/harness/index.html`) gets a “Save to Memory” button that dispatches `MEMORY_INDEX_REQUEST` with fixture data so QA can validate without browsing live sites.

## Implementation Notes
- Clean text to ≤1 k chars per chunk (split on sentence boundaries) to match spec15 chunking behavior; include language detection via `navigator.language` fallback.
- Defer sending until the user spends ≥3 s on the page or scrolls 30% down; expose constants for tuning.
- If backend responds with duplicates, tag DOM nodes accordingly so we don’t requeue later even if overlays rerender.
- Respect privacy: never send content when the page is in incognito unless the user explicitly allows extension access.
- Ensure feature flag path is cheap (content script should bail quickly when disabled).

## Dependencies
- SPEC2/3 (DOM extraction + overlays) and SPEC15 (memory endpoints) must be complete; SPEC10 telemetry hooks provide optional logging.

## Acceptance Criteria
- With the flag on, navigating to harness or live pages posts batched `/api/memory/index` requests containing chunked data + metadata, and the backend logs the matching schema version.
- Background queue enforces batch size and debounce; manual hotkey flush sends immediately and logs success/duplicate counts per response.
- With the flag off, no new messages or network calls occur and overlays behave exactly as before.
- Vitest specs cover extraction/messaging, and docs clearly describe enabling, verifying, and troubleshooting the ingestion flow.
