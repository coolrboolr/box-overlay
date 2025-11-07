# SPEC12: Testing Harness & Automation

## Objective
Provide automated coverage and a manual harness so contributors can validate overlay behavior without relying on live sites.

## Scope
- Create a static test page that simulates feeds, PDPs, and re-rendering behavior.
- Add Vitest suites covering anchor caching, scanner heuristics, and overlay state transitions.
- Document the workflow so a single developer can run all tests locally.

## Deliverables
- `extension/static/harness/index.html`:
  - Buttons to add/remove mock cards, simulate React-style re-render (remove + reinsert nodes), and toggle dock mode.
  - Includes sample cards with data attributes matching the new profiles.
- `extension/src/__tests__/` additions:
  - `anchors.spec.ts`: verifies `resolveAnchor`, caching, and cleanup.
  - `siteProfiles.spec.ts`: ensures profile resolution per hostname.
  - `overlay.spec.ts`: mounts DOM via jsdom, simulates placeholder → resolved flow, ensures classes toggle correctly.
  - Provide utilities/mocks for `chrome.runtime` messaging.
- `package.json` scripts:
  - `npm run test:watch` already exists; ensure instructions mention harness.
- Docs updates (`docs/testing.md`) covering:
  - How to open the harness via `chrome-extension://<id>/static/harness/index.html`.
  - Checklist for QA (placeholder visible, retry button works, dock mode toggles).

## Implementation Notes
- Harness should load compiled `dist/content.js` so it exercises real logic—set up instructions to run `npm run watch` beforehand.
- Use `MutationObserver` shims in tests if needed (`@webcomponents/mutation-observer` or jsdom built-in).
- For jsdom tests, stub `window.chrome` APIs minimally (sendMessage, storage.session) to avoid TypeScript errors.
- Keep snapshots lightweight; prefer explicit assertions.

## Dependencies
- Builds on specs introducing anchors, profiles, and UX polish (7–9).

## Acceptance Criteria
- `npm test` passes with the new suites.
- Harness demonstrates overlays end-to-end without network (mock backend responses).
- Documentation lets a new contributor run tests + harness in under 10 minutes.
