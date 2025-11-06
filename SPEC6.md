# SPEC6: Prompt Design, Ollama Integration & Operational Hardening

## Objective
Finalize the AI interaction layer, security posture, and developer workflows needed to ship a reliable local summarization overlay.

## Scope
- Produce the prompt template and model configuration consumed by SPEC5.
- Handle structured JSON responses from Ollama with validation and fallbacks.
- Document and implement security settings (CORS, manifest permissions, environment configuration).
- Establish developer tooling for testing end-to-end flows.

## Deliverables
- `server/src/prompt.ts` exporting:
  - `buildPrompt({ text, imageTagHint }: { text: string; imageTagHint?: string })`
  - Default system prompt: `"You are a local assistant that summarizes content and identifies ads."`
  - User prompt template instructing 1–2 sentence summary, optional 2–3 word image tag, `is_ad` boolean, JSON output.
- `server/src/ollama.ts` updates:
  - Send payload `{ model, prompt, format: "json", stream: false, images: image ? [image] : undefined }` (allow swapping `format` for a JSON schema object when models support structured outputs).
  - Parse JSON safely, providing fallback when model emits invalid JSON (retry once with strict reminder).
  - Enforce output schema via Zod (reuse from SPEC5).
- `server/src/security.ts`:
  - Helper to configure CORS origins from env `ALLOWED_EXTENSION_IDS` (comma-separated).
  - Document when Ollama CORS is needed: proxy-only flow does not require changes; direct browser calls use `OLLAMA_ORIGINS=chrome-extension://<id> ollama serve`.
- `docs/testing.md`:
  - cURL examples for backend.
  - Instructions for using Chrome “Extensions Reloader” and devtools to inspect content/background scripts.
  - Guidance on seeding mock responses when Ollama is offline.
- README updates covering:
  - Required local model download command (`ollama pull llama3:8b` or preferred).
  - Environment variable setup, including optional `MODEL_NAME`, `TIMEOUT_MS`.
  - Troubleshooting (CORS errors, service worker restarts, high latency).

## Implementation Notes
- Structured Output:
  - First attempt: standard prompt with `format: "json"` or a minimal JSON schema (leveraging Ollama structured outputs for stricter enforcement).
  - On parse failure, send follow-up prompt with explicit JSON schema reminder.
  - Trim whitespace and coerce booleans from strings if necessary (log warning).
- Performance:
  - Document recommendation to downgrade to `llama3:8b` or `mistral:7b` if latency high.
  - Support `MAX_TOKENS` env for shorter responses.
- Security:
  - Keep backend bound to loopback.
  - Encourage running extension with precise `host_permissions` narrowed to sites user cares about when ready.
  - Mention prompt-injection awareness; log potential malicious snippets for future tuning (no automated execution).
- Dev UX:
  - Provide npm script `npm run mock` in server to return canned responses for UI testing.
  - Suggest using `chrome://extensions` keyboard shortcut (Command+Shift+X) and integrate `console.groupCollapsed` logging.

## Dependencies
- Builds on SPEC5 backend foundation and SPEC1–SPEC4 client behaviors.

## Acceptance Criteria
- Ollama calls succeed end-to-end, returning validated JSON with `summary`, `image_tag`, `is_ad`.
- Invalid JSON responses trigger a single retry then a structured error to the extension.
- Documentation enables a new developer to install models, start services, and exercise mock/testing flows within 15 minutes.
- Security section covers all localhost + extension origin considerations noted in the architecture PDF.
