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
| `DEV_EXTENSION_REGISTRY_FILE` | Where to persist dynamically registered origins | `.cache/dev-extension-origins.json` |
| `MOCK_OLLAMA` | Force canned responses for every request | `false` |
| `MOCK_OLLAMA_FALLBACK` | Retry real model once, then fall back to mock payload | `false` |
| `ENABLE_BATCH_ANALYZE` | Expose `POST /api/analyze/batch` for grouped requests | `false` |
| `MEMORY_ENABLED` | Enable persistent memory endpoints (`/api/memory/*`) | `false` |
| `MEMORY_DB_PATH` | File path for the on-disk vector store | `.cache/memory-store.json` |
| `MEMORY_EMBED_MODEL` | Embedding model name passed to Ollama | `mxbai-embed-large` |
| `MEMORY_DEDUP_THRESHOLD` | Cosine similarity threshold for skipping duplicates | `0.9` |
| `MEMORY_MAX_CHARS_PER_CHUNK` | Max characters per chunk when splitting long text | `1000` |
| `USE_FAKE_EMBEDDINGS` | Return deterministic fake vectors (testing/CI) | `false` |
| `ENABLE_MEMORY_ANSWERS` | Allow `/api/memory/query` to call the LLM for a synthesized answer | `false` |

During local development you can keep `ALLOWED_EXTENSION_IDS` empty and rely on
`ENABLE_DEV_EXTENSION_REGISTRATION=true`, which lets the unpacked MV3 build post its
origin to `/api/dev/register-extension-origin`.

To inspect or reset the registry manually:

- `node scripts/inspect-dev-origins.mjs` — print the static + dynamic allowlists.
- `curl -X POST http://127.0.0.1:5000/api/dev/clear-extension-origins` — simulate a backend restart.
- `npm run smoke:dev` — sanity check that `/api/analyze` accepts requests and report diagnostics.

### Model Setup

```bash
ollama pull llama3:8b        # or another compatible model
ollama serve                 # keep this running in a separate terminal
```

To try the persistent memory feature locally, set `MEMORY_ENABLED=true` in `.env` and (optionally) run with `USE_FAKE_EMBEDDINGS=true` during tests so no embedding model is needed.

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
- `npm run test` – execute Vitest suites (registry + dev routes).
- `npm run smoke:dev` – ping `/api/dev/allowed-extension-origins` (if enabled) and run a real `/api/analyze` request.

## API


### Endpoints

- `GET /health` – returns `{ status, model, mock }` for monitoring.
- `POST /api/analyze` – accepts the summarized payload used by the extension.
- `POST /api/analyze/batch` – (optional, gated by `ENABLE_BATCH_ANALYZE`) processes up to four items per request for faster local analysis.
- `POST /api/memory/index` – (optional, gated by `MEMORY_ENABLED`) ingests one or more cleaned content items and stores embeddings locally.
- `GET /api/memory/stats` – (optional) exposes the item/vector counts, file size, and last persistence timestamp for diagnostics.
- `POST /api/memory/query` – (optional) searches the local semantic store, returning ranked snippets (and, when `ENABLE_MEMORY_ANSWERS=true`, a short synthesized answer).
- `POST /api/dev/register-extension-origin?id=<extensionId>` – (dev only) allows an unpacked extension to register its Chrome origin dynamically so CORS checks pass. Call this after loading the unpacked build.
- `POST /api/dev/clear-extension-origins` – wipes the in-memory + persisted dev registry, simulating a backend restart.
- `GET /api/dev/allowed-extension-origins` – returns both static (`ALLOWED_EXTENSION_IDS`) and dynamically registered origins for diagnostics.

Example:

```bash
curl -X POST http://127.0.0.1:5000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"id":"demo-1","text":"Sample article"}'
```

If Ollama is not running locally, set `MOCK_OLLAMA=true` (or
`MOCK_OLLAMA_FALLBACK=true` to fall back only after a real attempt) for
deterministic responses.
