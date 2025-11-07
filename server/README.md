# Local Analysis Backend

This workspace hosts the Express server that the Chrome extension talks to via `POST /api/analyze`.

## Setup

```bash
cd server
npm install
cp .env.example .env
```

### Environment Variables

| Key | Purpose | Default |
| --- | --- | --- |
| `PORT` | Express listen port (binds to `127.0.0.1`) | `5000` |
| `OLLAMA_BASE_URL` | Address of your local Ollama daemon | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Model name passed to `ollama generate` | `llama3` |
| `OLLAMA_TIMEOUT_MS` | Request timeout before aborting | `20000` |
| `ALLOWED_EXTENSION_IDS` | Comma-separated Chrome IDs allowed via CORS | *(empty → dynamic registration)* |
| `ENABLE_DEV_EXTENSION_REGISTRATION` | Allow unpacked extensions to register themselves | `true` |
| `MOCK_OLLAMA` | Force canned responses for every request | `false` |
| `MOCK_OLLAMA_FALLBACK` | Retry real model once, then fall back to mock payload | `false` |
| `ENABLE_BATCH_ANALYZE` | Expose `POST /api/analyze/batch` for grouped requests | `false` |

During local development you can keep `ALLOWED_EXTENSION_IDS` empty and rely on
`ENABLE_DEV_EXTENSION_REGISTRATION=true`, which lets the unpacked MV3 build post its
origin to `/api/dev/register-extension-origin`.

### Model Setup

```bash
ollama pull llama3:8b        # or another compatible model
ollama serve                 # keep this running in a separate terminal
```

Then start the proxy:

```bash
npm run dev
```

Hit `curl -X POST http://127.0.0.1:5000/api/analyze ...` to confirm end-to-end flow
before loading the extension.

## Development

- `npm run dev` – start the server with hot reload (`ts-node-dev`).
- `npm run build` – compile TypeScript to `dist/`.
- `npm start` – run the compiled server.
- `npm run typecheck` – run TypeScript in no-emit mode.

## API


### Endpoints

- `GET /health` – returns `{ status, model, mock }` for monitoring.
- `POST /api/analyze` – accepts the summarized payload used by the extension.
- `POST /api/analyze/batch` – (optional, gated by `ENABLE_BATCH_ANALYZE`) processes up to four items per request for faster local analysis.
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

If Ollama is not running locally, set `MOCK_OLLAMA=true` (or
`MOCK_OLLAMA_FALLBACK=true` to fall back only after a real attempt) for
deterministic responses.
