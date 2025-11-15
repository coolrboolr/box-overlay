# Overlay Coverage Map (SPEC1–25)

Declarative mapping of specs to automated coverage. “Gap” means no direct automated test yet; manual QA still required.

| SPEC | Automated coverage | Notable gaps / TODOs |
| --- | --- | --- |
| SPEC1–3 (overlay shell, injection safety) | `extension/src/__tests__/overlay.spec.ts`, `content-flow.spec.ts` smoke DOM mounting | Gap: no explicit teardown/race-condition cases |
| SPEC4–6 (HUD/tooling) | `logStore.spec.ts` (telemetry HUD storage fallback) | Gap: HUD UI rendering/assertions |
| SPEC7–9 (classification & ads) | `highlight.spec.ts`, `sandwich` flows in `content-flow.spec.ts` | Gap: ad/organic styling assertions in overlay |
| SPEC10 (telemetry) | `logStore.spec.ts`, background registration tests | Gap: event schema validation |
| SPEC11–12 (popup IA) | `popup.spec.ts` | Gap: none noted |
| SPEC13 (failure handling) | `background.registration.spec.ts` forbidden/403 retry coverage | Gap: network flake/backoff timing |
| SPEC14–16 (memory capture/index) | `memoryCapture.spec.ts`, `extract.spec.ts`, `anchors.spec.ts` | Gap: large payload/perf limits |
| SPEC17–18 (memory query/render) | `siteProfiles.spec.ts`, `background-flow.spec.ts`, `popup.spec.ts` query happy path | Gap: answer suppression edges |
| SPEC19–20 (popup chat & multi-turn) | `popup.spec.ts` basic chat reset | Gap: history threading + answers |
| SPEC21 (overlay chat IA) | `overlay.spec.ts` basic launcher + shell present | Gap: cross-overlay coexistence |
| SPEC22 (overlay wiring scaffolding) | `content-flow.spec.ts` mounts overlay shell | Gap: none noted |
| SPEC23 (chat persistence schema) | **New:** `chat-store.spec.ts` CRUD seed/persistence + scope filtering | Gap: migration/evolution tests |
| SPEC24 (chat creation/org) | `ChatPanel.spec.tsx` selection/focus/empty/error; `chat-filters.spec.ts` grouping sorts | Gap: pin/rename flows (UI wiring) |
| SPEC25 (search/filter/perf) | **New:** `chat-filters.spec.ts` (search semantics), `ChatFilters.spec.tsx` (UX), `useChats.spec.ts` (plumbing/telemetry), `ChatPanel.spec.tsx` (debounce/state), `chat-store.spec.ts` (limit/truncation/scope) | Gap: virtualization guardrail when >200 results |

Notes:
- Background/server smoke tests remain in `docs/testing.md`; this map focuses on extension overlay behavior.
- When adding new specs, append rows here and link the responsible tests.*** End Patch
