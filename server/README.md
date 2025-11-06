# Local Analysis Backend

This workspace hosts the Express server that the Chrome extension talks to via `POST /api/analyze`.

## Setup

```bash
cd server
npm install
cp .env.example .env
```

Update `.env` with your extension ID (for CORS) and Ollama settings if needed.

## Development

- `npm run dev` – start the server with hot reload (`ts-node-dev`).
- `npm run build` – compile TypeScript to `dist/`.
- `npm start` – run the compiled server.
- `npm run typecheck` – run TypeScript in no-emit mode.

## API

```
POST /api/analyze
Content-Type: application/json
```

Example:

```bash
curl -X POST http://127.0.0.1:5000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"id":"demo-1","text":"Sample article"}'
```

If Ollama is not running locally, set `MOCK_OLLAMA=true` (or `MOCK_OLLAMA_FALLBACK=true` to fall back only when the call fails) for deterministic responses.
