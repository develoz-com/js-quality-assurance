# @develoz/quality-assurance — Implementation Plan

Port of [`develoz-com/rails-quality-assurance`](https://github.com/develoz-com/rails-quality-assurance)
to TypeScript. The gem's value is orchestration, not any single linter: shared
presets, a fail-fast step pipeline, a cross-process run lock, coverage
precedence, security gates, and a pre-commit generator. This repository keeps
that design and swaps the Ruby tools for JS/TS ones.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Location | Separate repo, published to npm | The gem is a distribution package. `race-control` consumes it as a devDependency, never bundled. |
| Packaging | pnpm monorepo, Changesets | Mirrors the gem shipping shared configs other projects inherit. |
| Linter / formatter | **Biome-first** | One fast tool for lint and format by default. ESLint and Prettier ship as opt-in presets where Next 16 / React Compiler rule parity matters. |
| Versioning | `0.x` at launch | Package is pre-1.0. |

## Non-goals

- No QA dependency may enter `race-control/plugins/opencode/dist/race-control.js`.
  That asset is served to arbitrary OpenCode clients and must stay dependency-light.
- No custom compiler, bundler, or AST engine. Tools run as subprocesses.
- No Jest legacy path. Vitest 5 is the test runner.
- No Husky runtime. A tracked `.githooks/pre-commit` is generated instead.

## Packages

| Package | Role |
| --- | --- |
| `@develoz/quality-assurance` | CLI, pipeline engine, run lock, stack adapters, reporters, generators |
| `@develoz/quality-assurance-config` | Shared presets: Biome (`biome/base`, `biome/react`, `biome/next`), ESLint (`eslint/base`, `eslint/react`, `eslint/next`), Prettier (`prettier`), Stylelint (`stylelint/base`, `stylelint/tailwind`, `stylelint/scss`) |

Consolidating the presets into one package keeps config-only consumers from
installing the whole toolchain, and removes the duplicated Biome fallback that
the CLI previously bundled. `linked` versioning in Changesets keeps the two in
step.

## CLI surface

| Command | Runs |
| --- | --- |
| `qa ci` | Full fail-fast pipeline |
| `qa lint [--staged] [--fix]` | Biome check by default, ESLint if configured |
| `qa format [--staged] [--write]` | Biome format by default, Prettier if configured |
| `qa typecheck` | `tsc --noEmit` |
| `qa test` | `vitest run` (no coverage) |
| `qa coverage` | `vitest run --coverage` with thresholds |
| `qa audit` | `npm`/`pnpm`/`yarn audit --audit-level=<level>` |
| `qa deadcode` | `knip` |
| `qa boundaries` | `dependency-cruiser` |
| `qa hooks install` | Writes tracked `.githooks/pre-commit` and sets `core.hooksPath` |

## Pipeline

`qa ci` acquires a run lock, then runs steps in order and stops at the first
failure. The failing child's exit code becomes the process exit code.

```
audit → typecheck → biome check → boundaries → deadcode → vitest run --coverage
```

`biome check` covers lint **and** format in one step; there is no separate
format step in CI. `qa format` exists only for a format-only developer check or
Prettier projects.

### Coverage precedence

`ENV` > `qa.config.*` > opinionated default (100% lines, branches, functions,
statements). Thresholds are injected as
`--coverage.thresholds.lines=<n>` and friends and enforced by Vitest.

### Run lock

Atomic `mkdir` acquisition (no native addon), holder metadata
(`pid`, `command`, `timestamp`, `user`) in
`node_modules/.cache/@develoz/quality-assurance/run.lock/holder.json`. A lock whose PID is dead
or whose age exceeds 30 minutes is reclaimed. Contention prints the holder and
exits 1.

## Configuration

`qa.config.mjs` / `qa.config.js` (TypeScript config needs a TS loader and lands
with the adapter milestone). See `packages/qa/src/config.ts` for the schema.

## Corrections carried from review

These are the review findings folded into the design, not left ambiguous:

1. **Staged typecheck is unsound.** `tsc` ignores `tsconfig.json` when given
   explicit files, and a subset check misses cross-file errors. The pre-commit
   hook runs full `tsc --noEmit` when any `.ts`/`.tsx` is staged. Only lint and
   format take a `--staged` file list.
2. **Pre-commit budget is seconds, not milliseconds.** With `tsc --noEmit`, the
   hook is 1–3s, not <500ms. No fabricated budget.
3. **Unified SARIF needs a converter.** Knip and Biome emit SARIF; 
   `dependency-cruiser` emits JSON only and is converted to SARIF by an internal
   reporter before merging. **Done:** see Reporting. Also verified that
   dependency-cruiser with `--output-type json` exits 0 even on error
   violations, so the JSON run is artifact-only and the gate stays on
   `--output-type err`.
4. **One Biome step.** `biome check` already includes formatting, so CI runs it
   once instead of `biome check` + `biome format`.
5. **Start at 0.x.** All packages begin at `0.1.0`.

## Reporting

Report artifacts are written to `dist/qa` (configurable via
`report.directory`) and enabled by default when `CI` or `GITHUB_ACTIONS` is set,
or explicitly via `report.enabled`.

| Artifact | Produced by | Flags |
| --- | --- | --- |
| `biome.sarif` | `qa lint` | `--reporter=default --reporter=sarif --reporter-file=…` |
| `biome-smells.sarif` | `qa smells` | same |
| `jscpd-report.sarif` | `qa duplication` | `--reporters console,sarif --output …` |
| `stylelint.json` | `qa styles` | `--formatter=json --output-file …` |
| `dependency-cruiser.json` | `qa boundaries:report` | `--output-type json --output-to …` |
| `junit.xml` | `qa coverage` | `--reporter=junit --outputFile.junit=…` |

`qa report` merges the SARIF files and converts the dependency-cruiser and
stylelint JSON into `qa.sarif` for GitHub code scanning. Knip is not included:
it writes SARIF to stdout only and the pipeline does not redirect.

### Styles

`qa styles` is opt-in and auto-detected: it runs when the project has a
stylelint config, Tailwind, or SCSS. It uses the project's stylelint config when
present, otherwise the shipped `@develoz/quality-assurance-config` preset (`tailwind`
when Tailwind is detected, `scss` when SCSS, else `base`). The presets are
lint-only on purpose: Biome owns formatting, so `@stylistic` rules are not
included and the two tools cannot disagree. Biome also lints CSS, but stylelint
adds rule depth, Tailwind coverage and SCSS, which Biome does not support.

## Milestones

- **M1 — Core engine & run lock. DONE.** Pipeline runner (subprocess, fail-fast,
  exit-code propagation), run lock with stale reclamation, CLI `ci`,
  `--help`/`--version`. 19 unit and integration tests, including a real
  multi-process lock contention test. Chief-mechanic review findings addressed:
  atomic stale-lock reclamation by rename, ownership check on release, spawn
  failures and throwing conditions surfaced as failed steps, signal exit codes
  mapped to `128 + N`, `prepack` builds `dist`.
- **M2 — Presets.** Validate `@develoz/quality-assurance-config` Biome
  (base/react/next), the opt-in ESLint flat configs against ESLint 10, and
  Prettier.
- **M3 — Adapters & gates. DONE.** Stack detection (node/react/next) and
  workspace-root discovery; `qa lint|format|typecheck|test|coverage|deadcode|
  boundaries|duplication|smells|audit`. Single-pass coverage with
  `ENV > config > 100%` precedence. `smells` runs the project's Biome lint
  rules (suspicious **and** complexity) over source with warnings as errors.
  `--only` is deliberately avoided: it forces a rule group on and overrides
  rules a project set to `off`. Projects scope the gate through their own
  `biome.json` overrides (this repo turns `noConsole` off for the CLI). The QA
  tools ship as dependencies and resolve from the package's own install, so a
  consumer's `node_modules` layout does not matter. Verified end-to-end: `qa ci`
  runs all seven gates and passes on this repository.
- **M4 — Hooks. DONE.** `qa hooks install` writes a tracked, executable
  `.githooks/pre-commit` and sets `core.hooksPath`, with a conflict guard when
  another hook manager (Husky) already owns it. The hook delegates to
  `qa pre-commit`: staged lint, staged format only for non-Biome formatters, and
  a **full** `tsc --noEmit` when TypeScript is staged (never a file list).
  Verified end-to-end in a real repository.
- **M5 — Publishing & adoption.** Changesets + npm trusted publishing (OIDC),
  `@develoz/quality-assurance` as a devDependency of `race-control/plugins/opencode`, a
  `make qa` target, asset-drift assertion, and an OpenCode agent-pack QA skill.

## Open assumptions

- The `@develoz` npm scope is assumed available; npm publishing requires auth
  that this checkout does not have. GitHub org `develoz-com` exists. Until the
  scope has npm **trusted publishing** configured, the release workflow is
  `workflow_dispatch` only — an automatic publish was attempted on the first
  push and failed with `404 Not found` from npm.
- Tool versions are pinned from the npm registry as of Oct 2026 (Biome 2.5.15,
  ESLint 10.12, typescript-eslint 8.71, Vitest 5.0.3, TypeScript 5.9.3,
  knip 6.39, dependency-cruiser 18.5, jscpd 5.4). TypeScript is pinned to the
  5.x line because the 7.x compiler is check-first and does not emit.
