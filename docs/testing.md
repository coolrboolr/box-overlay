# Telemetry HUD & Log Export

These tools are dev-only (`isDev` builds). They never run in production bundles.

## Debug HUD

1. Run the extension in watch/dev mode: `cd extension && npm run watch`.
2. Load/reload the unpacked build. A floating panel titled **Overlay HUD (dev)** appears in the top-right corner of every page.
3. The panel shows rolling counters sourced from `logStore.ts`:
   - Nodes scanned
   - Requests queued
   - Overlays resolved
   - Retries (automatic rescan + user-triggered retry)
   - Errors received from the backend
4. Drag the panel by its header if it covers content. Dock mode styling is respected (Alt+Shift+D).
5. If you need to hide the HUD temporarily, reload the page with a production build or call `unmountDebugHud()` from DevTools.

## Exporting Logs

1. Reproduce the issue in a dev build.
2. Press **Alt+Shift+L**. The current telemetry JSON is copied to the clipboard (falls back to the console if clipboard access is blocked).
3. Paste the JSON into a file, e.g. `~/overlay-logs.json`.

## CLI Summary

1. Run `node server/scripts/dump-overlay-logs.mjs ~/overlay-logs.json`.
2. The script prints totals (scans, requests, successes, retries, errors), per-event counts, and the 10 most recent entries with timestamps.
3. Share the CLI output along with reproduction notes when filing bugs.

> Tip: The JSON mirrors what lives in `chrome.storage.session["overlayTelemetryLogs"]`, so you can also pull it straight from DevTools → Application → Session Storage when debugging without the export hotkey.

---

## Backend Smoke Tests

1. Install server deps and create your env file:
   ```bash
   cd server
   npm install
   cp .env.example .env
   ```
2. Ensure Ollama is running with a local model (`ollama pull llama3:8b` is a solid default) and start the backend:
   ```bash
   npm run dev
   ```
3. Send a sample request directly to the proxy to confirm schema validation and model connectivity:
   ```bash
   curl -X POST http://127.0.0.1:5000/api/analyze \
     -H "Content-Type: application/json" \
     -d '{"id":"smoke-1","text":"Sample article body for verification"}'
   ```
   A healthy response looks like:
   ```json
   {"id":"smoke-1","summary":"...","image":{"kind":"tag","tag":"..."},"isAd":false}
   ```
4. For ad-hoc health checks, hit `GET /health` or `GET /api/tags` to make sure the service is bound and responding.

### Toggling Mock Responses

- Set `MOCK_OLLAMA=true` in `.env` to bypass the model entirely and return deterministic fake data (useful when testing the extension on airplanes).
- Alternatively, keep real calls enabled but set `MOCK_OLLAMA_FALLBACK=true` so the server retries once against Ollama and then falls back to the mock payload if the model responds with invalid JSON or times out.
- Restart `npm run dev` after changing either flag; the new environment values are read on boot.

## Batch Mode & Schema Versioning

- The extension and backend both respect `SCHEMA_VERSION` (see `extension/src/types/messages.ts` and `server/src/schema.ts`). Keep the versions in sync whenever you evolve the message contract.
- To enable batched HTTP calls, set `ENABLE_BATCH_ANALYZE=true` in `server/.env` and rebuild/restart the backend. This exposes `POST /api/analyze/batch` which processes up to four items per request.
- Build the extension with `ENABLE_BATCH=true` in the environment (e.g., `ENABLE_BATCH=true npm run watch`) so the background worker fans out through the batch endpoint. It auto-detects 404s and falls back to single-item mode if the backend is older.
- Error payloads now include `statusCode` and optional `details`, so overlays display messages like “Backend responded with HTTP 400 (HTTP 400)” to simplify triage.

## Persistent Memory Smoke Test

1. Enable the feature flags in `server/.env`:
   ```bash
   MEMORY_ENABLED=true
   MEMORY_DB_PATH=.cache/memory-store.json
   MEMORY_EMBED_MODEL=mxbai-embed-large
   ```
   When running tests or CI without Ollama embeddings available, set `USE_FAKE_EMBEDDINGS=true` so the server skips real model calls.
2. Restart `npm run dev` and watch the logs for `[memory] store loaded …`.
3. Index sample content via curl:
   ```bash
   curl -X POST http://127.0.0.1:5000/api/memory/index \
     -H "Content-Type: application/json" \
     -d '{"items":[{"id":"mem-1","text":"Persistent memory smoke text","url":"https://example.com","title":"Example","capturedAt":"'$(date -Iseconds)'"}]}'
   ```
   A healthy response returns counts for `indexed`, `duplicate`, and `failed` along with stored chunk IDs.
4. Inspect stats:
   ```bash
   curl http://127.0.0.1:5000/api/memory/stats | jq
   ```
   Confirm the `items`, `vectors`, and `lastPersistedAt` fields reflect the ingested content.
5. Delete the `.cache/memory-store.json` file if you need a clean slate between manual tests; the server will recreate it on next boot.

## Local Harness

1. Run `cd extension && npm run watch` so `dist/content.js` stays synced.
2. Load the unpacked extension, then open `chrome-extension://<your-extension-id>/static/harness/index.html`.
3. The harness auto-mounts the content script and mock backend. Use the buttons to:
   - Add/remove feed cards and simulate React-style re-renders.
   - Toggle dock mode / global overlays (fires the same keyboard shortcuts).
   - Inject failures (“Fail next request”) and adjust the mock response delay.
   - Inspect backend health + origin registry via the new **Backend Status** panel.
   - Invoke the real background worker’s re-registration hook or simulate a backend restart without leaving the page.
4. Recommended QA sweep:
   - Confirm pending overlays show “Analyzing…” with spinner right after a card spawns.
   - Toggle the failure checkbox and use the inline “Retry” button to ensure errors resubmit successfully.
   - Re-render cards and verify overlays reattach without duplicate Analyze requests.
- Toggle dock mode to make sure the stack respects ordering and persists via session storage.

## Enabling Memory Capture

1. Enable the server feature flags (`MEMORY_ENABLED=true`, `USE_FAKE_EMBEDDINGS=true` if you
   don't want to run the embedding model) and restart `npm run dev` in `server/`.
2. In Chrome DevTools (any tab), run:
   ```js
   chrome.storage.sync.set({ memoryCaptureEnabled: true })
   ```
   This persists the flag so the content script can queue memory items.
3. Reload the extension/harness and browse a few mock cards. After ~3 seconds the background
   worker batches `/api/memory/index` requests; use **Alt+Shift+M** (or the harness “Save to
   memory” button) to flush immediately.
4. Inspect the background console for `[memory]` logs and check `curl /api/memory/stats` to
   confirm new items were stored.

## Querying Memory via Popup

1. Build/watch the extension (`npm run watch`) and load it in Chrome.
2. Click the extension action icon to open the popup. Enter a natural-language question and hit **Search**.
3. Use the filter pills:
   - **This domain** limits results to the active tab’s hostname.
   - **Past 7 days** restricts by capture timestamp.
   - **Entity filter** cycles through Article/Product/Person/Brand/Unknown to scope the ontology type.
   - **Concept filter** prompts for a concept identifier (e.g., `concept:product`) and only shows hits tagged with that ID.
4. Results show title, snippet, similarity, and actions to open the source or copy the snippet. When
   `ENABLE_MEMORY_ANSWERS=true` on the server, an “Answer” card appears summarizing the top matches.
5. Background devtools should log `/api/memory/query` calls; the popup console logs incoming
   `MEMORY_QUERY_RESULT` messages for debugging.

## Chrome Extension Workflow

1. In a separate terminal, build/watch the extension:
   ```bash
   cd extension
   npm install
   npm run watch
   ```
2. Load `extension/` as an unpacked extension from `chrome://extensions` and keep **Developer Mode** enabled so the background service worker console is accessible.
3. Use the bundled hotkeys during manual QA:
   - `Alt+L` — toggle overlays globally.
   - `Alt+Shift+D` — dock overlays to the bottom-right stack.
   - `Alt+Shift+L` — export telemetry JSON (dev builds only).
4. When you edit background/content code, click **Reload** on the extension card to rehydrate the MV3 worker; the watch task keeps `dist/` current so reloads are instant.

## Troubleshooting Checklist

- **CORS errors in background console** — confirm `ENABLE_DEV_EXTENSION_REGISTRATION=true` (default) so the service auto-whitelists your unpacked extension origin, or add the extension ID to `ALLOWED_EXTENSION_IDS`.
- **Model latency or failures** — verify `ollama serve` is running, the desired model is pulled, and `OLLAMA_BASE_URL` in `.env` matches the serve address. The server now retries once when Ollama emits invalid JSON before surfacing the error.
- **No overlays appear** — ensure the server is running, watch for `[content]` logs in the page console, and confirm `Alt+L` hasn’t been used to hide overlays (look for `[content] overlays start disabled`).
- **Service worker sleeping** — keep the devtools console open for the extension’s background worker to hold it in a running state while debugging queue/concurrency behavior.
- **Telemetry HUD storage warning** — iframe-heavy sites (BuzzFeed quizzes, embeds) block `chrome.storage.session`. The HUD now falls back to in-memory counters and prints a single debug line; exports remain accurate.

## SPEC13 Validation Runbook

1. **Start the backend.**
   ```bash
   cd server
   npm run dev
   ```
   Leave `ENABLE_DEV_EXTENSION_REGISTRATION=true` and `ALLOWED_EXTENSION_IDS=` in `.env` so dynamic origin registration is used.
2. **Run the smoke script** from another terminal to ensure `/api/analyze` is healthy and print the current registry path:
   ```bash
   npm run smoke:dev
   ```
3. **Launch the extension harness.** In Chrome, open `chrome-extension://<id>/static/harness/index.html`.
4. **Use the Backend Status panel** at the top of the harness to:
   - Refresh `/api/health` and `/api/dev/allowed-extension-origins`.
   - Click “Simulate backend restart” (calls `POST /api/dev/clear-extension-origins`).
   - Click “Force re-register” to ping the background worker via `DEV_FORCE_REGISTER`.
   - Watch the “Recent Requests” log (last five requests with retryable flag).
5. **Trigger overlay work** by adding cards in the harness and verifying the content script talks to the mock backend without 403 errors. Toggle `ENABLE_BATCH=true` in the terminal (restart `npm run watch`) and ensure the queue falls back gracefully when `/api/analyze/batch` is disabled.
6. **Export HUD telemetry** (Alt+Shift+L) after simulating backend restarts. Confirm the HUD now surfaces the additional counters (`403 recoveries`, `Forbidden errors`, `Batch fallbacks`). Attach the exported JSON and the server log snippet showing `registered dev extension origin` in your PR.
7. **Optional:** run `node server/scripts/inspect-dev-origins.mjs` to print the persisted registry file before/after the restart simulation.
