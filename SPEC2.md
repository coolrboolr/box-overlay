# SPEC2: DOM Extraction Pipeline

## Objective
Implement the content-script logic that discovers article-like DOM nodes, extracts clean text and optional images, and packages data for analysis.

## Scope
- Work within `extension/src/content/`.
- Detect candidate elements (e.g. `<article>`, `[role="article"]`, `.post`, `.card`, `.feed-item`).
- Normalize text content by stripping HTML, collapsing whitespace, and truncating to a configurable maximum.
- Gather optional metadata (stable DOM id/index) and inline image data.
- De-duplicate items already processed during the current session.
- Prepare a message payload conforming to `ItemAnalysisRequest` defined in `src/types/messages.ts`.

## Deliverables
- `extension/src/content/domSelectors.ts`: exports selector lists and heuristics.
- `extension/src/content/extract.ts`: 
  - `extractItems(root: Document | Element): ItemAnalysisRequest[]`
  - `cleanText(node: Element): string`
  - `collectImageData(node: Element): Promise<string | undefined>`
- `extension/src/content/state.ts`: lightweight registry to mark processed DOM nodes (e.g. WeakSet or data attribute).
- Updates to `extension/src/types/messages.ts`:
  ```ts
  export interface ItemAnalysisRequest {
    id: string;
    text: string;
    image?: string;
  }
  ```
- `extension/src/content/index.ts` orchestrating:
  - Initial scan on script load.
  - Periodic rescan every 5s (configurable) as v1 alternative to MutationObserver.
  - Emitting `ItemAnalysisRequest` messages via `chrome.runtime.sendMessage`.

## Implementation Notes
- Use a deterministic `id` (e.g. hash of text or incremental counter stored in `state.ts`).
- `collectImageData` should:
  - Locate the first `<img>` descendant with a visible `src`.
  - If `src` is data URL, return as-is.
  - Otherwise, fetch blob and convert to Base64 string (`FileReader.readAsDataURL`), catching CORS failures and returning `undefined` instead of throwing.
- Cap text length to ~1,500 characters to control model latency.
- Keep aggregate payloads comfortably below the backend’s `2mb` JSON limit (raise the cap alongside SPEC5 if batching is introduced later).
- Skip elements whose cleaned text is shorter than 40 characters after normalization.
- Ensure message payload omits the `image` field when no image is available (keeps JSON compact).
- The 5-second rescan timer is the v1 compromise; call out in comments where a `MutationObserver` could drop in when optimization time comes.

## Dependencies
- SPEC1 must be complete (build pipeline, TypeScript types available).

## Acceptance Criteria
- Manual testing on a sample news page logs structured payloads to the console.
- Duplicate elements are not reprocessed during a single visit.
- Message payloads match the defined TypeScript interface.
- No uncaught promise rejections when image fetch fails.
