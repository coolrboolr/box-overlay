# SPEC3: Overlay UI & User Interaction

## Objective
Render unobtrusive overlays on each analyzed DOM item that display summaries, image tags, and ad flags returned from the backend.

## Scope
- Extend the content script to receive analysis responses and inject overlay elements.
- Define reusable CSS for overlay layout, typography, and ad/organic styling.
- Provide basic user controls (toggle visibility, dismiss per item).
- Handle updates when new analysis for the same item arrives (e.g. retries).

## Deliverables
- `extension/src/types/messages.ts` additions:
  ```ts
  export interface ItemAnalysisResponse {
    id: string;
    summary: string;
    image_tag?: string;
    is_ad: boolean;
  }
  export type RuntimeMessage =
    | { type: "ANALYZE_REQUEST"; payload: ItemAnalysisRequest }
    | { type: "ANALYZE_RESULT"; payload: ItemAnalysisResponse };
  ```
- `extension/src/content/overlay.ts` with:
  - `renderOverlay(target: Element, data: ItemAnalysisResponse): void`
  - `updateOverlay(id: string, data: ItemAnalysisResponse): void`
  - `removeOverlay(id: string): void`
- `extension/src/content/uiState.ts` storing toggle state and overlay references.
- `extension/src/styles/overlay.css` implementation:
  - Overlay card (bottom-right corner of target element by default).
  - Color accents: green for organic (`is_ad === false`), red outline/badge for ads.
  - Typography sized for readability (12–14px) without breaking layout.
  - Transition for fade-in/out to minimize jank.
- `extension/src/content/index.ts` updates:
  - Listen for `chrome.runtime.onMessage` results.
  - Attach overlay containers to `position: relative` targets (apply inline styles if necessary).
  - Provide a keyboard shortcut via the manifest `commands` API (default `Alt+L`) that the background relays to content scripts to toggle overlays globally.
- Manifest update (alongside SPEC1) adding:
  ```json
  "commands": {
    "toggle-overlays": {
      "suggested_key": {
        "default": "Alt+L"
      },
      "description": "Toggle analysis overlays"
    }
  }
  ```

## Implementation Notes
- Overlays should avoid interfering with page interaction:
  - Use `pointer-events: none` for the wrapper, with an inner button (`pointer-events: auto`) only when needed (e.g. “Dismiss”).
  - Ensure all overlay pieces share a single exported `OVERLAY_Z_INDEX` constant (e.g. 2147483000) so styles stay consistent and stay below native modals.
- Sanitize model output before injection (set `textContent`, not `innerHTML`).
- Persist global toggle state in `chrome.storage.session` so reload maintains user choice.
- Provide accessible labels (`aria-live="polite"`, `role="note"`).

## Dependencies
- SPEC1 (infrastructure) and SPEC2 (extraction/message request) must be complete.

## Acceptance Criteria
- When mock responses are sent via `chrome.runtime.sendMessage`, overlays appear on corresponding elements with correct styling.
- Global toggle hides/shows overlays without re-triggering analysis.
- Dismissed overlays do not reappear unless a fresh analysis result arrives.
- No layout shift or scrollbar flash is observed on tested sites.
