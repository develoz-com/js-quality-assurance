# @develoz/quality-assurance-config

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
