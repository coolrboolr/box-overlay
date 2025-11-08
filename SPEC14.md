# SPEC14: Background Channel Hygiene & Anchor Hardening

## Objective
Eliminate noisy MV3 messaging warnings, make telemetry exports reliable inside third-party iframes, and keep overlays from leaking when anchors churn faster than rescans can recover.

## Scope
- **In scope:** extension background/content layers, telemetry store, associated tests/docs.
- **Out of scope:** server, batch API semantics, UI redesign.

## Workstreams

1. **Background Channel Hygiene**
   - Update `extension/src/background/index.ts` so `chrome.runtime.onMessage` acknowledges requests synchronously (no more `return true` without `sendResponse`).
   - Ensure the DEV harness “Force re-register” message (`DEV_FORCE_REGISTER`) also responds immediately.
   - Add regression coverage (extend `extension/src/__tests__/background-flow.spec.ts`) confirming the handler returns an acknowledgement and schedules work.

2. **Telemetry Store Fallback**
   - Harden `extension/src/content/logStore.ts` so the datastore gracefully degrades when `chrome.storage.session` is blocked (iframes like BuzzFeed quizzes).
   - Downgrade the storage warning to a one-time `console.debug`, expose a tiny test hook to reset store state, and add a dedicated spec verifying stats still increment without storage access.
   - Mention the behaviour in `docs/testing.md` under Troubleshooting.

3. **Anchor Recovery Hardening**
   - Add a bounded retry counter (e.g., 3 attempts) to `recoverMissingOverlayTarget` so repeated “missing target” events trigger one more rescan and then dismiss the overlay instead of looping forever.
   - Emit a `recordEvent("error", { reason: "anchor-miss-max" })` when we give up, clear the overlay/anchor, and allow future payloads with new summaries to re-render.
   - Expand `extension/src/__tests__/content-flow.spec.ts` (or a new spec) to cover aggressive DOM churn—assert retry telemetry increments and a terminal failure is recorded after the cap.

## Acceptance Criteria
- No `[content] sendMessage error … message channel closed` spam when browsing sites; the background handler always responds synchronously.
- HUD exports remain accurate (stats accumulate) even when `chrome.storage.session` is inaccessible, and only a single debug line notes the fallback.
- When BuzzFeed-style reflows delete anchors repeatedly, the content script performs at most N (≤3) rescans per overlay before dropping it, and telemetry reflects both the retries and the capped failure.
