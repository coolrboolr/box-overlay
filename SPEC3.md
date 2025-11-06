# SPEC3: Overlay UI & User Interaction

## Objective
Build the client-side overlay system that reacts to analysis results, manages per-item UI state, and exposes a global enable/disable toggle. SPEC3 assumes SPEC1 (scaffold) and SPEC2 (DOM extraction + `ANALYZE_REQUEST`) are complete.

## Data Types
- `ItemAnalysisRequest` already exists from SPEC2.
- Define the response and message union in `src/types/messages.ts`:
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

## Deliverables
- `src/types/messages.ts`
  - Add `ItemAnalysisResponse` and `RuntimeMessage` as above.
- `src/content/uiState.ts`
  - Maintain a `Map<string, OverlayRecord>` containing `{ id, target, container, data, dismissed }`.
  - Track `dismissed` ids so identical results do not recreate a dismissed overlay.
  - Track the latest `ItemAnalysisResponse` per id to detect changed payloads.
  - Store the global overlay enabled flag in `chrome.storage.session` under a single key.
  - Expose helpers: `registerOverlay`, `getOverlay`, `updateOverlayRecord`, `removeOverlayRecord`, `markDismissed`, `clearDismissed`, `forEachOverlay`, `getLastPayload`, `wasDismissed`, `getGlobalEnabled`, `setGlobalEnabled`, `toggleGlobalEnabled`.
- `src/content/overlay.ts`
  - Export `OVERLAY_Z_INDEX = 2147483000`.
  - Provide `renderOverlay(target, data)`, `updateOverlay(id, data)`, `removeOverlay(id)`.
  - Ensure `renderOverlay`:
    - Forces `target` to `position: relative` if it is `static`.
    - Appends a wrapper `div.llm-overlay-wrapper` absolutely positioned at bottom-right with `pointer-events: none`, `role="note"`, `aria-live="polite"`.
    - Creates a card `div.llm-overlay-card` with summary text, optional image tag pill, optional “Ad” badge, and a dismiss button. All text must use `textContent`.
    - Applies modifier classes `llm-overlay-card--organic` / `llm-overlay-card--ad` based on `is_ad`.
    - Registers the overlay via `uiState.registerOverlay`.
  - `updateOverlay` updates copy and modifiers for existing overlays (no re-render).
  - `removeOverlay` removes DOM node and unregisters it.
  - Inject overlay styling by inserting a `<style>` tag once; this is the canonical styling source for SPEC3. The stylesheet should define the classes mentioned above, including transitions and accent colors. `overlay.css` can be kept for future overrides but is not required here.
- `src/content/index.ts`
  - Continue SPEC2 behavior: run extraction every 5 s and send `RuntimeMessage{ type: "ANALYZE_REQUEST" }`.
  - On load, read the global enabled flag from `uiState`; default true.
  - Listen for `chrome.runtime.onMessage`:
    - `type: "ANALYZE_RESULT"`: locate or infer the DOM element for `payload.id`, then:
      - If an overlay exists and is not dismissed, call `updateOverlay`.
      - If an overlay exists but was dismissed, only re-render when the payload changes (`summary`, `image_tag`, or `is_ad` differs).
      - If no overlay exists and overlays are enabled, call `renderOverlay`.
    - `type: "TOGGLE_OVERLAYS"`: call `uiState.toggleGlobalEnabled()`, add/remove a `.llm-overlay-hidden` class on all overlay containers, and log state. Do not destroy overlays; hidden overlays should reappear when re-enabled unless individually dismissed.
- `src/styles/overlay.css`
  - Optional helper stylesheet for future theming. For SPEC3 the authoritative styles are injected by `overlay.ts`; keep this file minimal (e.g., placeholder comment) or synchronize it with the injected CSS without duplicating conflicting instructions.

## Dependencies
- SPEC1 (infrastructure) and SPEC2 (extraction/message request) must be complete.

## Acceptance Criteria
- Given synthetic `ANALYZE_RESULT` messages, overlays render on the correct elements with summary text, optional image tag, and ad badge styling.
- Summaries, tags, and badges are inserted with `textContent` (no `innerHTML` usage).
- Dismissing an overlay removes it, marks the record as dismissed, and prevents it from reappearing for identical payloads. Updated payloads (changed summary/image_tag/is_ad) recreate the overlay.
- Sending a `TOGGLE_OVERLAYS` message hides existing overlays via CSS while preserving state; toggling back on shows all non-dismissed overlays without re-triggering extraction or losing dismissed state.
- Overlays use absolute positioning inside the target (bottom-right) with a high z-index and do not cause noticeable layout shifts or block page interactions.
