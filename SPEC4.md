# SPEC4: Background Messaging & Request Coordination

## Objective
Implement the Manifest V3 service worker that mediates between the content script and the local backend, enforcing rate/queue control and robust error handling.

## Scope
- Define the message contract for analyze requests/results (building on SPEC2/3 types).
- Implement background listeners that forward requests to `http://localhost:5000/api/analyze`.
- Queue concurrent requests to avoid overwhelming the local model (default parallelism: 3).
- Route responses back to the originating tab and handle retries/backoff.

## Deliverables
- `extension/src/background/index.ts` containing:
  - `chrome.runtime.onMessage` handler for `"ANALYZE_REQUEST"`.
  - `chrome.commands.onCommand` handler for `"toggle-overlays"` that notifies active tabs (per SPEC3).
  - `sendToBackend(payload: ItemAnalysisRequest): Promise<ItemAnalysisResponse>`.
  - Request queue manager with configurable concurrency (e.g. simple promise pool).
  - Retry logic: up to 2 retries with exponential backoff starting at 500 ms for transient network errors (HTTP ≥500 or fetch failures).
  - Timeout guard (abort fetch at 25 s to prevent worker stalling).
- `extension/src/background/ports.ts` (optional helper) for tab-specific response routing.
- `extension/src/types/messages.ts` updates:
  ```ts
  export interface AnalyzeError {
    id: string;
    error: string;
    retryable: boolean;
  }
  export type RuntimeMessage =
    | { type: "ANALYZE_REQUEST"; payload: ItemAnalysisRequest }
    | { type: "ANALYZE_RESULT"; payload: ItemAnalysisResponse }
    | { type: "ANALYZE_ERROR"; payload: AnalyzeError };
  ```
- Use `chrome.tabs.sendMessage` or responder callback to deliver result/error.
- Background logging utility with `console.debug`/`console.error` gated by `process.env.NODE_ENV`.

## Implementation Notes
- Use the Fetch API available in MV3 workers; include `headers: { "Content-Type": "application/json" }`.
- Include `tabId` and `frameId` in queue items so the correct context receives results.
- Async message handlers must `return true` to keep response channels open while awaiting promises.
- Handle worker lifetime:
  - Rehydrate queue after service worker wakes by persisting pending jobs in `chrome.storage.session` or simply let content script resubmit upon startup (document choice).
- Ensure network errors propagate as user-visible overlays (SPEC3 should render fallback message when `ANALYZE_ERROR` arrives).
- Validate responses match schema before forwarding; discard unexpected payloads.
- Configure the bundler to replace `process.env.NODE_ENV` with a literal so the worker does not rely on a runtime `process` object.

## Dependencies
- SPEC1–SPEC3 must be complete.
- SPEC5 (backend endpoint) should be available for end-to-end tests but background code can be developed with mocked fetch.

## Acceptance Criteria
- Manual test: content script sends fake request; background logs queue operations and responds with mock data.
- With local backend running, real requests succeed and overlays update within expected time.
- After backend failure, background retries twice then emits `ANALYZE_ERROR`.
- Service worker passes Chrome extension MV3 linting (`chrome://extensions` > `Inspect views` shows no uncaught errors).
