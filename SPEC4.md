# SPEC4: Background Messaging & Request Coordination

## Objective
Implement the Manifest V3 background service worker that brokers requests between content scripts and the local backend, enforces request concurrency limits, and delivers results (or errors) back to the correct tab/frame. This spec builds on SPEC1–SPEC3 and prepares the ground for SPEC5 (backend).

## Scope
- Receive `RuntimeMessage{ type: "ANALYZE_REQUEST" }` from content scripts (SPEC2/SPEC3).
- Forward `ItemAnalysisRequest` payloads to the local backend (`POST http://127.0.0.1:5000/api/analyze`).
- Enforce concurrency control (promise-pool, default parallelism 3), retries, and per-request timeouts.
- Deliver success responses as `RuntimeMessage{ type: "ANALYZE_RESULT" }` and failures as `RuntimeMessage{ type: "ANALYZE_ERROR" }` to the originating tab/frame.
- Relay the `"toggle-overlays"` command (Alt+L) to content scripts as `RuntimeMessage{ type: "TOGGLE_OVERLAYS" }`.
- Stay background-only: no DOM access, no backend prompt logic (handled by SPEC5/SPEC6).

## Data Types & Messages
- Extend `src/types/messages.ts` with:
  ```ts
  export interface AnalyzeError {
    id: string;
    error: string;
    retryable: boolean;
  }

  export type RuntimeMessage =
    | { type: "ANALYZE_REQUEST"; payload: ItemAnalysisRequest }
    | { type: "ANALYZE_RESULT"; payload: ItemAnalysisResponse }
    | { type: "ANALYZE_ERROR"; payload: AnalyzeError }
    | { type: "TOGGLE_OVERLAYS" };
  ```
- `AnalyzeError.retryable` is `true` for transient failures (network errors, HTTP ≥ 500) that exhausted retries; `false` for validation or client-side errors.

## Background Responsibilities & Modules
- `extension/src/background/index.ts`
  - **Listeners**
    - `chrome.runtime.onMessage`:
      - Accepts `ANALYZE_REQUEST` messages. Capture `tabId` / `frameId` from the sender; push into the queue.
      - Return `true` to keep the message channel open while the promise resolves.
    - `chrome.commands.onCommand`:
      - When command name is `"toggle-overlays"`, send `{ type: "TOGGLE_OVERLAYS" }` to the active tab(s) via `chrome.tabs.sendMessage`.
  - **Queue manager**
    - Promise pool with configurable `MAX_CONCURRENT_REQUESTS` (default 3).
    - Each job: `{ id, payload, tabId, frameId }`.
    - Dequeue when slots free; rejected jobs surface as `ANALYZE_ERROR`.
  - **Backend call**
    - `async function sendToBackend(payload: ItemAnalysisRequest): Promise<ItemAnalysisResponse>`.
    - POST to `http://127.0.0.1:5000/api/analyze`.
    - `Content-Type: application/json`, body `JSON.stringify(payload)`.
    - Timeout 25 s (use `AbortController`).
    - Retry up to 2 times with exponential backoff (500 ms, 1000 ms) for retryable errors (network failure, HTTP 5xx, aborted requests). Stop immediately for 4xx.
  - **Response routing**
    - On success: `chrome.tabs.sendMessage(tabId, { type: "ANALYZE_RESULT", payload: response }, { frameId })`.
    - On failure: `chrome.tabs.sendMessage(tabId, { type: "ANALYZE_ERROR", payload: { id, error, retryable } }, { frameId })`.
    - Log errors via a helper that is gated on `process.env.NODE_ENV !== "production"` (configure bundler to inline this constant).
- Optional helper modules (e.g., `queue.ts`) may be introduced; document their purpose if added (e.g., generic promise-pool implementation). Omit if not necessary.

## Implementation Notes
- Use `fetch`; do not depend on Node-specific APIs.
- Ensure all async message handlers `return true` so Chrome keeps the port alive.
- No queue persistence is required: if the service worker sleeps, content scripts will resubmit on next scan.
- Validate backend responses (shape/type) before forwarding; discard unexpected structures and emit `ANALYZE_ERROR`.
- Propagate `id` consistently so overlays correlate responses with DOM elements.
- Remember to add `"tabs"` permission (already part of SPEC1 manifest).

## Deliverables
- `extension/src/background/index.ts`
  - Message listener, command listener, request queue, retry/timeout logic, and response routing.
- `extension/src/types/messages.ts`
  - Add `AnalyzeError` and extend `RuntimeMessage` with `ANALYZE_ERROR` and `TOGGLE_OVERLAYS`.
- (Optional) helper module(s) supporting the queue; only include if used and documented.

## Acceptance Criteria
- With the backend mocked, injecting an `ANALYZE_REQUEST` from a content script enqueues the job, logs queue activity in development, and responds with a synthetic `ANALYZE_RESULT`.
- With SPEC5 backend running, real requests flow end-to-end; overlays update promptly and no uncaught errors appear in the background console.
- Transient backend failures (e.g., forced 503 or network abort) trigger up to two retries before emitting `ANALYZE_ERROR` with `retryable: true`. Validation failures produce `retryable: false`.
- `chrome://extensions` background inspection shows no uncaught exceptions; MV3 service worker remains active without violating timeouts.
- Pressing Alt+L (or invoking the `"toggle-overlays"` command) sends a `TOGGLE_OVERLAYS` message to the relevant tab(s), and the content script toggles overlays without re-scraping.

## Hardening Tips (Optional)
- Add unit tests (Jest/Vitest) for:
  - Queue behavior (max concurrency, retry timing, timeout aborts).
  - `sendToBackend` error classification and the emitted `ANALYZE_ERROR` payloads.
- Introduce structured logging helpers that gate verbose logs on a debug flag or `process.env.NODE_ENV`, enabling grouped/leveled logs without polluting production consoles.
- Consider tracking request metrics (success/failure counts, average latency) for future diagnostics; store locally and surface via `console.table` when debugging.
