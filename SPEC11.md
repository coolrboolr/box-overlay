# SPEC11: Backend Contract Hardening & Request Batching

## Objective
Make runtime messaging more resilient by stamping schema versions, improving error surfacing, and reducing backend load via batch analysis.

## Scope
- Version the `RuntimeMessage` payloads and validate incoming messages.
- Add optional batch endpoint support so the background worker can bundle multiple items per HTTP request when the backend enables it.
- Improve error propagation: include HTTP status, retry info, and backend diagnostics in `ANALYZE_ERROR`.

## Deliverables
- `extension/src/types/messages.ts` updates:
  - Add `schemaVersion = 1` constant.
  - Extend `ItemAnalysisRequest` with optional `sourceMeta` (profile name, anchor type).
  - Define `BatchAnalysisRequest` / `BatchAnalysisResponse`.
  - Update `RuntimeMessage` to include `{ type: "ANALYZE_BATCH_RESULT" }`.
- `extension/src/background/index.ts`:
  - Queue groups of up to N requests (configurable, default 4) and POST to `/api/analyze/batch` when available (`process.env.ENABLE_BATCH === "true"`).
  - Fall back to single-item endpoint otherwise.
  - Include `schemaVersion` in every payload.
  - Enhance `ANALYZE_ERROR` payload with `statusCode?: number`, `details?: string`.
- `server/src/routes/analyzeBatch.ts` (or similar):
  - Accept `{ schemaVersion, items: ItemAnalysisRequest[] }`, respond with aligned array of results/errors.
  - Update `server/src/index.ts` to register the route and reuse existing validation.
- Docs (`docs/testing.md` or new `docs/backend.md`) explaining how to enable batch mode and schema versioning.

## Implementation Notes
- Feature-flag batch behavior via env var on both client and server to ease rollout.
- When a batch partially fails, return individual `ANALYZE_ERROR` messages per item.
- Keep concurrency limits similar; batching should reduce HTTP calls, not increase outstanding work drastically.
- Ensure backwards compatibility: if backend is older, background should detect 404 and revert to single-item mode for rest of the session.

## Dependencies
- SPEC5/6 server groundwork; SPEC7–SPEC9 rely on reliable messaging.

## Acceptance Criteria
- Messages now include `schemaVersion` and optional `sourceMeta`.
- Batch endpoint handles at least 4 items per request; extension falls back gracefully when endpoint missing.
- Errors surfaced in overlays include status text (e.g., “Backend responded with HTTP 400”), helping debugging.
