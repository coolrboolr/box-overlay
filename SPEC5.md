# SPEC5: Local Backend Service (Express + Ollama Proxy)

## Objective
Deliver a lightweight Node.js backend that accepts analyze requests from the extension, calls the local Ollama API, and returns structured JSON responses.

## Scope
- Create a `server/` workspace using TypeScript + Express.
- Expose `POST /api/analyze` listening on `http://127.0.0.1:5000`.
- Validate incoming payloads against the shared schema and forward to Ollama with the configured prompt.
- Format the model output into `ItemAnalysisResponse` objects expected by the extension.

## Deliverables
- `server/package.json` with dependencies:
  - `express`, `cors`, `zod`, `dotenv`
  - Dev deps: `typescript`, `ts-node-dev`, `eslint` (optional), `@types/*` packages (include `undici` only if opting out of Node’s built-in `fetch`).
- `server/tsconfig.json` targeting ES2020, module commonjs.
- `server/src/index.ts`:
  - Initialize Express app.
  - Enable JSON body parsing and CORS (derive allowed origins from env-provided extension IDs; default to the unpacked ID during dev).
  - Load env (PORT, OLLAMA_BASE_URL, MODEL_NAME, TIMEOUT_MS).
  - Register `/api/analyze` route.
  - Bind to `127.0.0.1`.
- `server/src/schema.ts` exporting Zod validators for `ItemAnalysisRequest` and response.
- `server/src/ollama.ts`:
  - `callOllama({ text, image }: { text: string; image?: string }): Promise<ItemAnalysisResponse>`
  - Compose request to Ollama’s `/api/generate` using Node 18’s built-in `fetch` (or `undici` if more control is needed) with `format: "json"` and prompt template from SPEC6.
  - Handle streaming or blocking mode (`stream: false`).
- `server/.env.example` with `PORT=5000`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `MODEL_NAME=llama3:8b`.
- npm scripts:
  - `dev`: `ts-node-dev --respawn src/index.ts`
  - `build`: `tsc`
  - `start`: `node dist/index.js`
- Update root README with instructions to start backend before loading extension.

## Implementation Notes
- Use `express.Router()` to isolate API routes for future expansion.
- Enforce request size limits (e.g. `express.json({ limit: "2mb" })`) to accommodate Base64 images while preventing abuse.
- On validation failure, respond with HTTP 400 and standardized JSON `{ error: string; details?: unknown }`.
- Wrap Ollama call in timeout (respect `TIMEOUT_MS`, default 20000 ms).
- Normalize model output: ensure `summary` trimmed to ≤ 280 chars, `image_tag` to ≤ 3 words, `is_ad` boolean.
- Log errors with request id context for troubleshooting.

## Dependencies
- SPEC1–SPEC4 provide shared schema expectations.
- SPEC6 will define final prompt and safety constraints (stub acceptable until SPEC6 delivered).

## Acceptance Criteria
- `npm run dev` starts server on `127.0.0.1:5000` without TypeScript errors.
- `curl -X POST http://127.0.0.1:5000/api/analyze` with sample payload returns JSON structure matching schema (mock Ollama response if service unavailable).
- CORS allows Chrome extension origin while rejecting others by default.
- Graceful shutdown with `SIGINT` (Ctrl+C) without hanging processes.
