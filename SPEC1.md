# SPEC1: Extension Scaffold & Tooling

## Objective
Set up the Manifest V3 Chrome extension skeleton and developer tooling so later specs can focus on features instead of plumbing.

## Scope
- Create an `extension/` workspace structured for TypeScript-based MV3 development.
- Configure a build pipeline (e.g. `tsup` or `esbuild`) that emits production files to `extension/dist/`.
- Author a minimal `manifest.json` with required permissions/placeholders for background and content scripts.
- Provide npm scripts for `build` and `watch`, plus documentation on how to load the unpacked extension.

## Deliverables
- `extension/package.json` with dev dependencies (`typescript`, `tsup` or `esbuild`, `@types/chrome`).
- `extension/tsconfig.json` targeting Chromium (ES2022 modules).
- `extension/manifest.json` containing:
  - `manifest_version: 3`
  - `name`, `version`, `description` placeholders
  - `background.service_worker`: compiled background bundle path (e.g. `"dist/background.js"`)
  - `action` with default icon (temporary placeholder acceptable)
  - `permissions`: `["storage", "tabs"]`
  - `host_permissions`: `["http://localhost:5000/*"]`
  - Content script registration pointing at `dist/content.js` for `<all_urls>` (narrow later if desired)
- Source entry points:
  - `extension/src/background/index.ts`
  - `extension/src/content/index.ts`
  - `extension/src/styles/overlay.css` (empty placeholder)
  - `extension/src/types/messages.ts` defining request/response interfaces (exported but empty bodies allowed for now)
- `README.md` section describing how to run `npm install`, `npm run watch`, and load the unpacked extension from `extension/dist`.

## Implementation Notes
- Use TypeScript for all extension code; enable strict mode.
- Configure bundler to:
  - Emit background/content scripts separately into `dist/`.
  - Copy static assets (icons) from `extension/static/` via build step.
  - Trigger rebuild on file change for local development.
- Ensure generated files are not committed (update root `.gitignore` if needed).
- Document Chromium version required (`minimum_chrome_version` set to `123` is recommended for MV3 service worker stability).

## Dependencies
None. This spec should be completed before starting SPEC2.

## Acceptance Criteria
- Running `npm install && npm run build` inside `extension/` produces `dist/background.js` and `dist/content.js` without errors.
- Manifest validates via Chrome extension loader and background service worker registers (visible in Chrome `chrome://extensions` console).
- Source tree matches deliverables list.
- README instructions allow a teammate to replicate setup without additional context.
