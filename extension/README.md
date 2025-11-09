# Extension Workspace

## Setup
```bash
cd extension
npm install
```

## Development
- `npm run watch` – generate placeholder icons, bundle background/content scripts, and rebuild on change.
- `npm run build` – production build into `dist/`.
- `npm run typecheck` – run the TypeScript compiler without emitting files.
- `npm run lint` – lint the TypeScript sources with ESLint.

## Loading in Chrome
1. Run `npm run build`.
2. Open `chrome://extensions` in Chrome 123+.
3. Enable **Developer mode** in the top-right.
4. Click **Load unpacked** and select the `extension/` directory.
5. Confirm the background service worker logs appear in the extensions page console and that the content script logs on any visited page.

## Debugging tips
- Use the page DevTools console to verify `[content]` logs – the first log on
  each page will report the URL, then every DOM scan batch and `ANALYZE_REQUEST`
  that goes out.
- Open the extension's service worker console from `chrome://extensions` to see
  `[background]` logs. You should see origin-registration messages followed by
  one log per `/api/analyze` request/response pair.
- Option/Alt+L toggles overlays on the active page. The hotkey is blocked while
  focus is inside text inputs, selects, or editable regions.
- Option/Alt+Shift+D toggles dock mode, pinning overlays to the bottom-right
  stack for quick triage (state persists per session).
- Experimental memory capture: run `chrome.storage.sync.set({ memoryCaptureEnabled: true })`
  from DevTools (or use the harness toggle) and make sure the backend sets
  `MEMORY_ENABLED=true`. With the feature on, the extension queues page content
  for `/api/memory/index`; use **Alt+Shift+M** (or the harness button) to flush
  immediately when you want to save the current page.
