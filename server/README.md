# Local Analysis Backend

This workspace hosts the Express server that the Chrome extension talks to via `POST /api/analyze`.

## Setup

```bash
cd server
npm install
cp .env.example .env
```

Update `.env` with your extension ID (for CORS) and Ollama settings if needed. During
local development you can leave `ALLOWED_EXTENSION_IDS` blank and rely on
`ENABLE_DEV_EXTENSION_REGISTRATION=true` (default) so the extension can register
itself automatically.

## Development

- `npm run dev` – start the server with hot reload (`ts-node-dev`).
- `npm run build` – compile TypeScript to `dist/`.
- `npm start` – run the compiled server.
- `npm run typecheck` – run TypeScript in no-emit mode.

## API


### Endpoints

- `GET /health` – returns `{ status, model, mock }` for monitoring.
- `POST /api/analyze` – accepts the summarized payload used by the extension.
- `POST /api/dev/register-extension-origin?id=<extensionId>` – (dev only) allows
  an unpacked extension to register its Chrome origin dynamically so CORS checks
  pass. The background service worker calls this endpoint automatically using a
  `no-cors` request; no manual action is required unless you disable
  `ENABLE_DEV_EXTENSION_REGISTRATION`.

Example:

```bash
curl -X POST http://127.0.0.1:5000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"id":"demo-1","text":"Sample article"}'
```

If Ollama is not running locally, set `MOCK_OLLAMA=true` (or `MOCK_OLLAMA_FALLBACK=true` to fall back only when the call fails) for deterministic responses.
