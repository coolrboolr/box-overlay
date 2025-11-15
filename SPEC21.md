# SPEC21: Memory Chat & Annotation Fixups

## Objective
Address regressions and polish items discovered during review of SPEC19/20 integration, ensuring chat history handling, image validation, and schema alignment are correct.

## Scope
- **Required fixes:**
  - Prevent current chat turn from being sent inside `history` when issuing a new memory query.
  - Accept `ImageRef` objects in background ANALYZE validation so image-tag/dataUri/url payloads flow through.
- **Nice-to-have cleanups:**
  - Remove unused imports in popup to keep bundles lean.
  - Keep future overlay note affordance behind flag once added.

## Deliverables
1. **Chat history hygiene**
   - Popup chat submission should send only *previous* turns in the `history` payload; current user turn travels as `query`.
   - Result: first-turn answers no longer prepend “Using earlier context…” and prompts avoid duplicate questions.
2. **Image validation parity**
   - Background `isValidRequest` accepts `ImageRef` union (tag/dataUri/url objects) instead of string-only guard.
   - Prevents ANALYZE requests with image refs from being dropped.
3. **Minor cleanup**
   - Remove unused imports revealed during review to avoid dead code.

## Acceptance Criteria
- First chat turn answers are not prefixed with earlier-context messaging; payload `history` excludes the current user question.
- Background ANALYZE requests succeed when `image` is an object matching `ImageRef`.
- Popup builds without unused-import warnings related to the above changes.

## QA Checklist
- Chat tab: send first question → answer arrives without “Using earlier context…”.
- Send follow-up question → answer includes context prefix and respects prior turn.
- Trigger ANALYZE with `image: { kind: "tag", tag: "example" }` from content script; background accepts and forwards.
