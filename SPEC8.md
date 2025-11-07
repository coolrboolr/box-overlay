# SPEC8: Site Profiles & Relaxed Extraction Heuristics

## Objective
Increase coverage on diverse layouts by introducing site-aware selector profiles and smarter text heuristics while keeping false positives manageable.

## Scope
- Detect page archetypes (feed vs. detail) and choose the appropriate selector set automatically.
- Allow per-domain overrides without touching core code.
- Improve text-length gating by considering structure (number of paragraphs, presence of media).

## Deliverables
- `extension/src/content/siteProfiles.ts` exporting:
  - `resolveProfile(url: string): SiteProfile` (default + optional domain overrides stored in JSON or TS map).
  - Each profile defines selectors, minimum text length, and attribute hints.
- Update `domSelectors.ts` / `extract.ts` to consume the active profile instead of hard-coded arrays.
- Add `extension/docs/site-profiles.md` documenting how to add new domains (e.g., Drop, Bellroy).
- Heuristic tweaks:
  - If an element contains ≥3 `<p>` or `<li>`, allow text down to 20 chars.
  - If the node contains an image or video, allow shorter text but ensure there is any descriptive text.
  - Skip nodes whose text is >40% numbers/symbols (price grids).

## Implementation Notes
- Profiles can specify `extraSelectors`, `blockedClasses`, `requiresDataAttr`, etc.
- Domain detection should use `location.hostname` and support wildcard subdomains.
- Keep the profile data lightweight; no network fetches.
- Provide a dev-only console log when a profile overrides defaults.

## Dependencies
- SPEC7 (anchor caching) so broader extraction doesn’t break overlays.

## Acceptance Criteria
- Drop.com feed and Bellroy PDP both produce ≥1 overlay without manual selector tweaks.
- Adding a new profile requires editing only `siteProfiles.ts`.
- Dev console logs show which profile is active; default remains silent.
