# SPEC7: Stable Overlay Anchoring & Recovery

## Objective
Ensure overlays stay attached to dynamic DOM nodes by caching resilient anchor elements and retrying when the page re-renders before results arrive.

## Scope
- Capture a persistent anchor for every extracted item before sending `ANALYZE_REQUEST`.
- Update result handling to reuse cached anchors and retry once when nodes disappear.
- Expose lightweight metrics/logging so we can observe anchor churn.

## Deliverables
- `extension/src/content/anchors.ts` with:
  - `resolveAnchor(element: Element): Element` that walks up to the nearest stable ancestor (`main`, `[data-*]`, section with height, etc.).
  - `rememberAnchor(id: string, anchor: Element)` / `getAnchor(id: string)` / `clearAnchor(id: string)`.
- `extractItems` integration that calls `resolveAnchor` and stores the anchor alongside the `ItemAnalysisRequest`.
- Background/content messaging update so `handleAnalyzeResult` first checks the cached anchor, falling back to `findTargetElementById`.
- `handleAnalyzeResult` retry path:
  - If no anchor is found, call `resetProcessed()`, rescan just once, resend pending requests for missing ids, then log `[content] anchor-miss` if still unresolved.
- Dev-only counter in the console showing how many retries happened per page load (no UI requirement yet).

## Implementation Notes
- Use `WeakMap<Element, Element>` to avoid memory leaks.
- “Stable ancestor” heuristics:
  - Prefer nodes with `data-*` attributes, explicit `id`, or role landmarks.
  - Avoid anchoring to `body`/`html`; fall back to the element itself if nothing better exists.
- When retrying, debounce to avoid a loop on infinite reflows.
- Make sure anchors are cleared when overlays are dismissed or elements removed.

## Dependencies
- Builds on SPEC1–SPEC6 (existing extraction + overlay rendering).

## Acceptance Criteria
- Reloading highly dynamic pages (e.g., Bellroy PDP) results in overlays attaching successfully without “no target found” logs.
- Anchor retry fires at most once per overlay and logs in dev mode.
- No memory leaks (anchors removed when overlays are removed).
