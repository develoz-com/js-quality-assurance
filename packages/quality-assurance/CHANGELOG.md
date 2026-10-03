# @develoz/quality-assurance

## 0.1.1

### Patch Changes

- c0e2e8a: Audit production dependencies only by default, make the ESLint and Stylelint upstream packages optional peers, and emit one SARIF run per tool for code scanning.
- Scope the duplication gate to code: scan `src` (or the project root) and only JavaScript/TypeScript formats, so lockfiles and generated JSON no longer fail a project's first run. Add `duplication.paths` and `duplication.formats`.
- Updated dependencies [c0e2e8a]
- Updated dependencies
  - @develoz/quality-assurance-config@0.1.1
