# SPEC15: Persistent Memory Core API

## Objective
Stand up the backend-only foundation for persistent local semantic memory: configurable embedding generation, a durable vector store plus metadata persistence, deduplication logic, and the initial `/api/memory` surface the extension will call later.

## Scope
- **In scope:** server config/env toggles, embedding adapter, storage layer, Express routes, schema validation, automated tests, and README/docs describing how to enable the feature.
- **Out of scope:** Chrome extension messaging/UI, popup changes, answer generation, metadata filtering (handled by later specs).

## Deliverables
1. **Configuration Surface**
   - `server/.env.example` + docs entries for `MEMORY_ENABLED` (default `false`), `MEMORY_DB_PATH`, `MEMORY_EMBED_MODEL`, `MEMORY_DEDUP_THRESHOLD` (default `0.9`), `MEMORY_MAX_CHARS_PER_CHUNK`, and `USE_FAKE_EMBEDDINGS` (test helper).
   - Wiring in `server/src/config.ts` (or equivalent) so all modules consume a single source of truth.
2. **Embedding Adapter**
   - `server/src/services/embedding.ts` exporting `generateEmbedding(text: string): Promise<Float32Array>`.
   - Calls Ollama’s embedding endpoint (`/api/embeddings`) with retries + 20 s timeout, normalizes vectors, and supports deterministic fake mode (hash text → vector) for CI.
   - Shared constants for dimension + similarity metrics exported for reuse.
3. **Memory Store**
   - `server/src/memory/store.ts` implementing `MemoryStore` with methods `load()`, `ingest(items)`, `queryById`, and `stats()`.
   - Stores `{ id, vector, textSnippet, url, title, capturedAt, contentType, imageTag }` records in memory plus serializes to `MEMORY_DB_PATH` (JSON or `vectra` file) after each ingest using atomic writes.
   - Deduplication (cosine ≥ threshold or identical URL) and chunking (~1 k chars per chunk with sentence boundary awareness).
   - Light locking (promise queue) so concurrent ingests don’t corrupt state.
4. **HTTP Surface**
   - `server/src/routes/memory.ts` registered under `/api/memory` with:
     - `POST /api/memory/index`: `{ schemaVersion, items: MemoryIndexItem[] } → { indexed[], duplicates[], failed[] }`.
     - `GET /api/memory/stats`: exposes totals, schema version, file size, lastPersistedAt.
   - Routes short-circuit with `501` when `MEMORY_ENABLED=false` and reuse existing CORS restrictions (localhost only, extension origin allowlist).
   - Shared Zod schemas in `server/src/schema.ts`.
5. **Tests & Docs**
   - `server/src/__tests__/memory-store.spec.ts` (chunking, dedup, persistence reload) and `memory-routes.spec.ts` (index + stats happy/error paths) using fake embeddings.
   - README + `docs/testing.md` sections explaining how to toggle memory mode, run `curl` smoke checks, and switch to fake embeddings during CI.

## Implementation Notes
- Keep schema versioned via `MEMORY_SCHEMA_VERSION` constant stored both alongside persisted data and exported for the extension.
- Snippets stored with each vector should be trimmed (≤280 chars) to keep persistence files compact.
- Persist metadata + vectors in one file for now; log file size and number of records on startup for observability.
- If load fails (corrupt file), back up the old file (append `.bak-<timestamp>`) before reinitializing an empty store to avoid silent data loss.
- All logging should include `memoryStore` prefix so later telemetry can grep easily.

## Dependencies
- SPEC5/6 must already provide the Express server scaffold and shared schema utilities.

## Acceptance Criteria
- Backend boots cleanly with `MEMORY_ENABLED=false` (routes return `501`) and with it enabled (store loads or initializes and logs item count).
- `POST /api/memory/index` indexes unique chunks, skips duplicates (`cosine ≥ threshold`) and surfaces per-item statuses; `GET /api/memory/stats` reflects live totals.
- Restarting the server after indexing retains items (confirmed via stats comparisons) and fake embedding mode keeps all tests deterministic (no Ollama dependency).
- README/docs clearly describe enabling the feature and running smoke tests; CI executes the new test suites.
