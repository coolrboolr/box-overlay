# SPEC9: Overlay UX Polish & Placeholder States

## Objective
Improve user experience by providing immediate visual feedback (placeholder cards, smooth transitions) and better positioning options on dense layouts.

## Scope
- Render a “Analyzing…” placeholder card as soon as an item is queued.
- Animate overlays in/out, and support a “dock” mode for narrow layouts.
- Ensure uncategorized overlays use the light translucent card introduced earlier, with clear messaging.

## Deliverables
- `uiState` updates:
  - Track per-id status (`pending`, `resolved`, `error`).
  - Expose `setStatus(id, status)` helpers consumed by renderer.
- `overlay.ts`:
  - Create placeholder cards immediately with spinner + “Analyzing…” label.
  - Replace placeholder content when results arrive, preserving fade/scale animation.
  - Add CSS classes for `pending`, `error`, `resolved`.
- `styles/overlay.css`:
  - Keyframe for fade/slide.
  - `.llm-overlay-card--pending` (semi-transparent white with spinner).
  - Dock mode styles (`.llm-overlay-wrapper--dock`) that pin overlays to a corner stack when `document.body.dataset.llmDock = "true"`.
- `content/index.ts`:
  - Add keyboard shortcut (e.g., Alt+Shift+D) to toggle dock mode via dataset + persisted session storage.
  - When backend errors, show inline error message with retry button (that re-sends the request once).

## Implementation Notes
- Placeholder should be created from the same anchor to avoid layout jumps.
- Use CSS `prefers-reduced-motion` to disable animations when set.
- Retry button should respect the queue/backoff logic—just enqueue the same request with new id (or maintain attempt count).
- Dock state persistence can reuse `chrome.storage.session` helper from SPEC1.

## Dependencies
- SPEC7 (anchors) and existing overlay styles.

## Acceptance Criteria
- Users see a placeholder overlay within ~200 ms of extraction.
- Animations run, but disable when `prefers-reduced-motion` is true.
- Dock toggle works per-tab and persists while the tab remains open.
- Error overlays provide a retry affordance; repeated failures log a warning.
