# SPEC20: Multi-Turn Memory Chat

## Objective
Layer a lightweight conversation experience on top of the memory query stack so users can ask follow-up questions that reference prior context without retyping filters.

## Scope
- **In scope:** backend session handling (short-lived), popup chat UI, conversation-aware prompts, history persistence (per browser session), telemetry/tests.
- **Out of scope:** cross-device sync of conversations, audio input, long-term transcript storage.

## Deliverables
1. **Backend Session Support**
   - `/api/memory/query` accepts optional `conversationId` + `history` references.
   - Introduce `/api/memory/conversation` helper module maintaining in-memory sessions keyed by UUID with `{ lastQuery, lastAnswer, appliedFilters }` (TTL ~10 minutes).
   - Answer prompt builder incorporates previous turns (limited to last 3) when available, with instructions to cite sources per turn.
2. **Popup Chat UI**
   - Replace single-shot panel with a chat-style layout (messages stacked newest last) including:
     - User bubbles (query text + applied filters summary).
     - Assistant bubbles (answer text, sources chips, “View results” link to existing cards).
     - Inline spinner while waiting.
   - Provide controls to reset conversation, edit filters mid-thread, and open the existing detailed results drawer.
   - Keep bundle modular so simple “Search” tab still exists for users preferring single-shot mode.
3. **Background Conversation Manager**
   - Maintains current `conversationId` per popup instance, appends turn summaries, and includes history references with each request.
   - Cancels in-flight requests on reset, clears history cache when popup closes or after inactivity.
4. **Telemetry & Persistence**
   - Log conversation metrics (avg turns, cancel count) locally.
   - Optionally persist last N turns per tab in `chrome.storage.session` so closing/reopening popup within the same tab restores context.
5. **Testing & Docs**
   - Unit tests for prompt history builder, background manager, chat UI state machine.
   - Manual QA checklist in docs covering multi-turn flows, reset, and fallback to single-shot mode.

## Implementation Notes
- Limit history tokens to stay within LLM context (truncate earliest turns when exceeding ~1k tokens).
- Provide a clear indicator when the answer references previous turns (“Using earlier context…”).
- Ensure privacy: history never leaves the machine and clears when the user toggles memory off.
- Chat UI should degrade gracefully on narrow popup widths (stacked layout, scrollable history).

## Dependencies
- SPEC17 (single-shot query) + SPEC18 (filters/highlight) must exist; SPEC19 tags supply richer metadata for conversation references.

## Acceptance Criteria
- Users can submit follow-up questions that reference earlier answers; responses stay contextually aware and cite sources.
- Resetting the conversation clears history and stops any pending requests.
- Session TTL enforces automatic cleanup, preventing unbounded memory use.
- Tests + docs cover conversation behaviors, and telemetry reflects chat usage metrics.
