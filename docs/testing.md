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
   {"id":"smoke-1","summary":"...","image_tag":"...","is_ad":false}
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
