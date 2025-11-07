# Site Profiles

Site profiles let the extractor tailor selectors and heuristics for specific domains or page archetypes. Each profile is defined in `extension/src/content/siteProfiles.ts` and includes:

- `name`: human-readable identifier (used in dev console logs).
- `selectors`: CSS selectors scanned for candidate elements.
- `minTextLength`: baseline text length gate before relaxed heuristics apply.
- `relaxedAttributePattern`: regex applied to data attributes/class names for fallback matching.
- `blockedClassFragments`: class-name fragments that should be skipped (e.g., navigation, menus).

## Adding/Updating a Profile

1. Open `extension/src/content/siteProfiles.ts`.
2. Add a new `ProfileConfig` entry with a hostname matcher. Prefer `/(^|\.)example\.com$/i` to cover subdomains.
3. Use `withDefault({ ... })` to inherit default selectors and override what you need. Set `extraSelectors` for domain-specific cards.
4. Run `npm test` inside `extension/` to ensure profile logic is covered, then reload the extension in Chrome.
5. Visit the target site with `npm run watch` running; the dev console should log `[content] using site profile: your-profile-name`.

Profiles are lightweight and evaluated locally—no network fetches—which keeps the content script deterministic and easy to reason about.
