# SPEC10: Telemetry & Dev Debug HUD

## Objective
Give developers insight into scanner activity, queue health, and failures without needing Chrome DevTools open, while keeping all data local.

## Scope
- Implement a dev-only floating HUD overlay summarizing extraction stats.
- Log anonymized counters to `chrome.storage.session` for later export.
- Provide a CLI command to dump the counters for troubleshooting.

## Deliverables
- `extension/src/content/debugHud.ts`:
  - Renders a small draggable panel (only when `isDev`).
  - Shows counts: nodes scanned, requests queued, successful overlays, retries, errors.
  - Hooks into events exposed by `domScan`, `overlay`, and `background` message listener.
- `extension/src/content/index.ts` integration to create/destroy HUD depending on `isDev`.
- `extension/src/content/logStore.ts` storing rolling stats (max 100 entries) in `chrome.storage.session`.
  - Provide `exportLogs()` function (trigger via `Alt+Shift+L`) that copies JSON to clipboard or logs to console.
- `server/scripts/dump-overlay-logs.mjs` (Node) reads the session storage dump from a provided file (instructions in docs) and prints a readable summary.
- Docs update (`docs/testing.md`) describing how to use the HUD and export logs.

## Implementation Notes
- HUD should respect z-index (use `OVERLAY_Z_INDEX + 10`).
- Keep performance overhead minimal: batch updates with `requestAnimationFrame`.
- Use feature flag so the HUD never ships in production (guarded by `isDev` constant).
- For clipboard export, use `navigator.clipboard.writeText` when available, else fallback to console.

## Dependencies
- SPEC7/SPEC8 improvements (HUD consumes their metrics).

## Acceptance Criteria
- When `npm run watch` bundles the extension, the HUD automatically appears and updates.
- On prod build, no HUD code runs.
- Export hotkey produces JSON with counts for the current tab session.
