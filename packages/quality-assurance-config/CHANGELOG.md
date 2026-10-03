# @develoz/quality-assurance-config

## 0.3.0

### Minor Changes

- Align the shared presets with the Rails defaults they were ported from, and support Rails apps.
  
  - `biome/base` now uses lineWidth 120 and `semicolons: "asNeeded"`, adds `assist.organizeImports`, and matches the Rails linter severities (unused imports/variables warn; `useIterableCallbackReturn`, `noAssignInExpressions` and `noDocumentCookie` off).
  - `stylelint/tailwind` carries the Tailwind at-rule/function relaxations and rule overrides from the Rails preset, so `@apply`, `@tailwind`, `theme()` and friends are accepted.
  - Bundle `stylelint`, the `stylelint-config-*` presets and `postcss-scss` so `qa styles` works with no app-side install.
  - Detect Tailwind from `tailwindcss-rails` (Gemfile or `app/assets/tailwind`) so Rails apps enable `qa styles`.
  - Auto-gate `qa deadcode` on a knip config; without one knip flags every file. Default `qa duplication` to `app/javascript` when it exists.
  - Mask Yarn classic's `audit` severity bitmask to high|critical, matching the Rails gem instead of failing on low/moderate advisories.
  - Gate `qa typecheck` on a `tsconfig.json` and `qa ci`'s coverage step on actual JS test files. npm auto-installs the `typescript` and `vitest` peers, so tool presence alone ran `tsc` against projects with no TypeScript and vitest against projects with no tests.

## 0.2.2

### Patch Changes

- Release via npm trusted publishing (OIDC) with provenance, replacing the bootstrap token.

## 0.2.1

### Patch Changes

- Do not exclude build output from the bun coverage gate by default. lcov only lists files the tests loaded, so excluding `dist/` silently dropped the main logic of any project whose tests run against a built bundle. Colocated `.test.`/`.spec.` files are now excluded.

## 0.2.0

### Minor Changes

- Support projects that test with Bun. The runner is detected from `bun:test` imports (or a bunfig.toml without vitest) and can be forced with `test.runner`. Bun has no threshold enforcement that works across versions and no branch data, so `qa coverage` writes lcov and a follow-up `coverage:check` step enforces line and function thresholds uniformly, excluding test files by default (`coverage.exclude`).

## 0.1.1

### Patch Changes

- c0e2e8a: Audit production dependencies only by default, make the ESLint and Stylelint upstream packages optional peers, and emit one SARIF run per tool for code scanning.
- Scope the duplication gate to code: scan `src` (or the project root) and only JavaScript/TypeScript formats, so lockfiles and generated JSON no longer fail a project's first run. Add `duplication.paths` and `duplication.formats`.
