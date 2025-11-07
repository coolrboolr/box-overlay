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
