# SPEC13: Resolve Persistent 403 Errors & Validate DEV Harness

## Objective
Stop the content script from spamming telemetry with permanent `HTTP 403` failures by making the backend consistently honor dev MV3 origins, auto-recovering in the background worker, and proving the fix via the local harness and smoke tooling.

## Scope
- **In scope:** backend dev-origin registry, error messaging, extension background retries, harness/dev-doc validation steps, and test coverage that prevents regressions.
- **Out of scope:** production OAuth/identity, remote deployment workflows, and non-local hostnames (keep target host `127.0.0.1`).

## Root Cause Summary
- Telemetry export from **Nov 8, 2025** shows 74 queued overlay requests, 70 `retryable: false` errors with `message: "Backend responded with HTTP 403"`; only four overlays completed.
- The backend stores dev extension origins only in-memory (`server/src/index.ts` keeps `dynamicExtensionOrigins`). When the server restarts, the allowlist resets but the MV3 background worker’s `devOriginRegistered` flag never clears, so every subsequent `/api/analyze` or `/api/analyze/batch` call receives `403`.
- Batch mode and the static harness route requests the same proxy, so a single misconfigured registration bricks all flows. There is currently no logging or tooling that highlights which origin was blocked nor any automated way to re-register.

## Workstreams & Deliverables

### 1. Backend — Extension Origin Stewardship & Diagnostics
- Create `server/src/utils/devExtensionRegistry.ts` encapsulating: in-memory Set, lazy persistence to `${repoRoot}/.cache/dev-extension-origins.json`, and helpers `load()`, `add(origin)`, `clear()`, `serialize()`.
- Extend config (`server/.env.example`, `server/src/env.ts`) with:
  - `DEV_EXTENSION_REGISTRY_FILE=.cache/dev-extension-origins.json`
  - `ENABLE_DEV_EXTENSION_REGISTRATION=true` (documented default) and comments explaining prod vs dev behavior.
- Update `server/src/index.ts` to:
  - Preload origins from the registry and hydrate `dynamicExtensionOrigins` before Express boots.
  - Inject a dedicated middleware `verifyExtensionOrigin` that returns a structured `403` JSON payload (`error: "EXTENSION_ORIGIN_BLOCKED"`, `message`, `origin`, `allowedIds`, `nextSteps`).
  - Promote `/api/dev/register-extension-origin` into its own router (`server/src/routes/devExtensions.ts`) so we can also expose `POST /api/dev/clear-extension-origins` (simulates restart) and `GET /api/dev/allowed-extension-origins` (diagnostics, dev-only and guarded by env flag).
  - Emit log lines `[server] 403 blocked origin` with origin, header info, and whether registration is enabled.
- Add automated coverage:
  - `server/src/__tests__/devExtensionRegistry.spec.ts` (unit) verifying persistence + dedupe.
  - `server/src/__tests__/devExtensionRoutes.spec.ts` (integration via Supertest) ensuring register → analyze succeeds, and `clear` reverts to 403 until re-registering.
- Provide `server/scripts/inspect-dev-origins.mjs` that prints current registry contents and the path being used (developers can run before filing bugs).

### 2. Extension Background Service Worker Hardening
- Update `extension/src/background/index.ts`:
  - Introduce `async function withDevRegistrationRetry<T>(fn, context)` that wraps both `sendToBackend` and `sendBatchToBackend` so that any `HTTP 401/403` response clears the `devOriginRegistered` flag, forces `ensureDevOriginRegistration({ force: true })`, and retries the request **once** before surfacing an `AnalyzeError`.
  - Extend `ensureDevOriginRegistration` to accept `{ force?: boolean }`, treat forced calls as bypassing the cached `devOriginRegistered` state, and remove `mode: "no-cors"` so the backend sees the `Origin` header (host permissions already cover `http://127.0.0.1:5000/*`).
  - When a final failure still returns 401/403, emit `retryable: true` and include `details: "FORBIDDEN_ORIGIN"` so telemetry distinguishes auth failures from model errors.
  - Reset `devOriginRegistered = false` on service worker activation (`chrome.runtime.onInstalled` + `self.onmessage` fallback) to avoid stale state after reloads.
  - Add Vitest coverage under `extension/src/__tests__/background.registration.spec.ts` that stubs `fetch` responses (success, 403-then-200, permanent 403) to confirm only one retry fires and telemetry payloads are shaped correctly.

### 3. Harness, Docs, and Smoke Tooling
- **Harness UI (`extension/static/harness/index.html`):**
  - Surface backend health (`/api/health`) and registration status (call new `GET /api/dev/allowed-extension-origins`).
  - Add buttons “Simulate backend restart” (calls `POST /api/dev/clear-extension-origins`) and “Re-register extension” (invokes the background worker via `chrome.runtime.sendMessage`).
  - Display the last five network results (id, status, retryable) so QA can confirm 403 recovery without DevTools.
- **Docs (`docs/testing.md`):**
  - New subsection “SPEC13 Validation Runbook” with step-by-step instructions: start backend (`npm run dev`), run `npm run watch` with/without `ENABLE_BATCH`, open harness URL, trigger restart simulation, observe auto-recovery, export telemetry HUD snapshot (from SPEC10) to confirm no lingering 403s.
  - Document new env vars, CLI inspection script, and curl smoke tests (single + batch endpoints).
- **Smoke script:** add `server/package.json` entry `"smoke:dev": "tsx scripts/smoke-dev.ts"` that (1) GETs `/api/dev/allowed-extension-origins`, (2) POSTs `/api/analyze` with valid payload, (3) exits non-zero on 4xx.

### 4. Telemetry & Observability Alignment
- Extend the dev HUD (SPEC10 deliverable in `extension/src/content/debugHud.ts`) to expose counters: `403Recoveries`, `ForbiddenErrors`, and `BatchFallbacks`.
- Emit structured logs on the backend (`console.warn`) whenever the new middleware denies a request, tying `requestId`, `origin`, and whether the extension attempted re-registration within the last minute.
- Update `docs/testing.md` with instructions for exporting HUD data plus log grep snippets (`rg "403" server/logs/dev.log`).

## Implementation Notes
- Keep persistence file optional: if `DEV_EXTENSION_REGISTRY_FILE` is unset, registry behaves in-memory but logs a warning so developers know restarts will wipe state.
- The registry file should be gitignored (add to root `.gitignore` if missing) and use atomic writes (`fs.promises.writeFile` to temp + rename) to avoid corruption on crash.
- Make the new dev endpoints available only when `ENABLE_DEV_EXTENSION_REGISTRATION=true`; otherwise return 404 to avoid exposing tooling in prod builds.
- Prefer reusable helpers over sprinkling logic: e.g., `shouldForceReRegistration(statusCode: number)` so both single and batch handlers stay in sync.
- Batch API parity: remember to wrap `sendBatchToBackend` and ensure `/api/analyze/batch` responds with the same structured 403 payload (update router + schema if needed).

## Validation & QA
- **Automated:** `npm test` in both `server/` and `extension/` must pass, including the new registry + background specs. `npm run smoke:dev` must pass after every backend change.
- **Manual harness walkthrough:**
  1. Start backend `cd server && npm run dev` and verify `[server] registered dev extension origin ...` log appears once harness re-registers.
  2. Run `cd extension && ENABLE_BATCH=true npm run watch`, load the unpacked build, open the harness URL, and confirm overlays resolve.
  3. Click “Simulate backend restart”: expect one transient 403, auto re-registration, and successful retries without manual reload.
  4. Toggle batching off (restart watch without `ENABLE_BATCH`) and repeat to ensure both endpoints behave.
- **Telemetry review:** export HUD counters after the restart simulation and attach screenshot + `server/logs` snippet to the PR per CONTRIBUTING checklist.

## Dependencies
- SPEC10 (Dev Debug HUD) — leveraged for the new counters.
- SPEC12 (Harness & Automation) — harness structure and docs section being extended.
- Existing Ollama proxy/service logic (SPEC6+) remains unchanged aside from accepting new metadata fields.

## Risks & Mitigations
- **File corruption:** mitigate via atomic writes and JSON schema validation before loading.
- **Infinite retry loops:** cap the forbidden retry logic to a single automatic retry and surface actionable `details` so QA can spot real auth issues quickly.
- **Accidental prod exposure:** guard new dev endpoints + registry file path behind `ENABLE_DEV_EXTENSION_REGISTRATION`; document defaults clearly.

## Acceptance Criteria
- Server logs show successful `204` registrations on startup and no `[server] blocked CORS origin` entries during harness runs, even after simulating restarts.
- Manual `curl` smoke test (`curl -X POST http://127.0.0.1:5000/api/analyze ...`) and the new `npm run smoke:dev` script both return `HTTP 200`.
- Triggering the harness restart flow results in **≤1** 403 per burst, followed by automatic recovery (verified via HUD counters and telemetry export).
- Batch mode behaves identically to single requests; if `/api/analyze/batch` is disabled, background gracefully falls back without emitting 403 errors.
- Documentation clearly describes the workflow so a new developer can reproduce the fix end-to-end in under 15 minutes.

## References
- `server/README.md` — backend setup + env vars.
- `docs/testing.md` — QA & harness instructions (to be updated).
- `extension/src/types/messages.ts` — schemaVersion + payload types.
- `extension/static/harness/index.html` — manual harness source.
