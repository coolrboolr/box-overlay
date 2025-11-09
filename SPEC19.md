# SPEC19: User Notes & Tagging

## Objective
Let users annotate saved content with free-form notes and tags, persist those annotations locally, and reuse them as filters in the popup and highlight flows.

## Scope
- **In scope:** memory schema updates for `userNote`/`tags`, backend mutation endpoints, popup + overlay affordances for editing, telemetry/tests/docs.
- **Out of scope:** collaborative tagging, cloud sync, automated topic labeling (future work).

## Deliverables
1. **Schema & Persistence Updates**
   - Extend memory metadata (SPEC15 store) with `userNote?: string`, `tags: string[]`, plus `updatedAt` timestamp.
   - Persist new fields in the on-disk file and bump `MEMORY_SCHEMA_VERSION`; add migration or reset strategy.
   - Update `GET /api/memory/stats` to include counts of tagged items.
2. **Mutation API**
   - Add `PATCH /api/memory/items/:id` accepting `{ userNote?, tags? }`.
   - Validate tags (≤20 chars, alphanumeric + `-/_`, case-insensitive) and limit to e.g. 10 tags per item.
   - Respond with the updated record and broadcast a lightweight server-sent event (or log) for debugging.
3. **Extension Messaging & UI**
   - New runtime messages:
     - `{ type: "MEMORY_UPDATE_REQUEST", payload: { id, userNote?, tags? } }`
     - `{ type: "MEMORY_UPDATE_RESULT" | "MEMORY_UPDATE_ERROR" }`
   - Background worker posts to the new endpoint, handles optimistic updates, and surfaces errors via telemetry/HUD.
   - Popup UI:
     - Result cards get an “Edit” affordance that opens inline form (note textarea ≤200 chars, tag token input with suggestions from existing tags across store).
     - Display tags as chips on cards and inside filter UI (SPEC18) with counts.
   - Content overlays gain an optional “Add note” icon in dev builds (only visible when overlays expanded) to open a minimal textarea anchored to the overlay; reuse popup editor component to avoid duplicate logic.
4. **Tag Suggestions & Storage**
   - Maintain a local `tagsIndex` (Map tag → count) derived from stats endpoint or background caching to power autocomplete in popup.
   - Provide `chrome.storage.local` cache so tag suggestions appear immediately while background fetch syncs actual stats.
5. **Docs, Telemetry & Tests**
   - Telemetry events: `memoryNoteSaved`, `memoryTagAdded`, `memoryTagRemoved` with anonymized counts.
   - Tests covering backend validation, mutation endpoint, popup editor UX, optimistic UI rollback, and overlay note entry.
   - `docs/testing.md` section for “Annotating memory” with QA checklist.

## Implementation Notes
- Notes should be trimmed, markdown-free plain text; escape when rendering to avoid XSS.
- Apply optimistic UI updates but revert if backend call fails (show inline error state).
- Support keyboard shortcuts: `Cmd/Ctrl+Enter` to save, `Esc` to cancel editing.
- When schema version bumps, ensure older files without note/tag fields either migrate (add empty fields) or trigger a one-time upgrade.
- Keep overlay note UI optional behind `ENABLE_OVERLAY_NOTES` so we can ship popup editing first if needed.

## Dependencies
- SPEC18 filters/highlights rely on tag metadata; implement after SPEC15–SPEC18 are complete.

## Acceptance Criteria
- Users can add/edit/remove notes and tags from popup result cards (and optionally overlays); changes persist across restarts and appear on subsequent queries/filters.
- Backend mutation endpoint validates payloads, updates metadata, and stats endpoint reflects tag counts.
- Tag filters in popup include the new user-defined tags; highlighting/answer flows include updated metadata.
- Telemetry + tests cover note/tag flows end-to-end, and documentation explains how to use and verify the feature.
