## Local Summarization Overlay

Manifest V3 Chrome extension plus a local Express proxy that summarizes DOM content with Ollama. The extension scans pages for article-like cards, shows inline overlays, and never ships data off-device.

### Workspace Layout

- `extension/` — MV3 background + content scripts bundled with tsup.
- `server/` — Express proxy that validates requests and calls Ollama.
- `docs/` — Architecture and dev workflow references.
- `SPEC*.md` — Incremental roadmap; check the relevant spec before making changes.

### Quickstart

1. **Backend**
   ```bash
   cd server
   npm install
   cp .env.example .env
   ollama pull llama3:8b     # pick any compatible local model
   npm run dev
   ```
   - `PORT`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, and mock flags live in `.env`.
   - Use `curl -X POST http://127.0.0.1:5000/api/analyze ...` to smoke-test before wiring up the extension.
2. **Extension**
   ```bash
   cd extension
   npm install
   npm run watch
   ```
   Load the workspace root (`extension/`) via **Load unpacked** in `chrome://extensions`. Keep Developer Mode on so you can open the background service worker console for logs.

### Mock & Retry Modes

- `MOCK_OLLAMA=true` — always return canned responses (fast UI/dev loop).
- `MOCK_OLLAMA_FALLBACK=true` — try the real model first, fall back to the mock payload if Ollama times out or emits invalid JSON (the server now retries once with a strict JSON reminder before giving up).

### Optional Batch Mode

- Backend: set `ENABLE_BATCH_ANALYZE=true` in `server/.env` and restart `npm run dev` to expose `POST /api/analyze/batch`.
- Extension: build/watch with `ENABLE_BATCH=true` (e.g., `ENABLE_BATCH=true npm run watch`) so the background worker bundles up to four requests per HTTP call. It auto-detects 404s and reverts to single-item mode if the backend doesn’t support batching.
- Both sides enforce `SCHEMA_VERSION` (defined in `extension/src/types/messages.ts` and `server/src/schema.ts`). Bump it intentionally when you change the request/response contract.

### Developer Ergonomics

- Hotkeys: `Alt+L` toggles overlays, `Alt+Shift+D` docks cards, `Alt+Shift+L` exports telemetry JSON (dev builds only).
- Telemetry HUD + CLI log tooling are documented in `docs/testing.md`, which now also covers backend smoke tests, cURL snippets, and troubleshooting tips.
- Open the local harness at `chrome-extension://<id>/static/harness/index.html` (after running `npm run watch`) to exercise the content script without leaving localhost—use the panel controls to add/remove cards, fake backend failures, and toggle dock mode.
- Run `npm test` inside each workspace for unit coverage (Vitest for extension code, TBD for the server as tests are added).

### Contributing

- Follow the repository guidelines in `AGENTS.md`.
- Reference the SPEC documents to understand acceptance criteria for each milestone.
- Keep overlay/schema changes in sync between `extension/src/types/messages.ts` and `server/src/schema.ts`.
