# js-quality-assurance

Opinionated quality-assurance toolkit for TypeScript and JavaScript projects.
Port of [`rails-quality-assurance`](https://github.com/develoz-com/rails-quality-assurance).

Biome-first defaults, a fail-fast CI pipeline, coverage and security gates, and
a generated pre-commit hook. Stack-aware for generic Node, React, and Next.js.

> Status: pre-1.0. Milestone 1 (pipeline engine, run lock, `qa ci`) is complete.
> See [`docs/plan.md`](docs/plan.md).

## Packages

| Package | Role |
| --- | --- |
| `@develoz/qa` | CLI, pipeline engine, run lock, adapters, reporters |
| `@develoz/biome-config` | Default lint and format presets |
| `@develoz/eslint-config` | Opt-in ESLint flat configs |
| `@develoz/prettier-config` | Opt-in Prettier preset |

## Development

```sh
pnpm install
pnpm --recursive run test
pnpm --recursive run typecheck
pnpm --recursive run build
pnpm exec biome check .
```

Requires Node >= 22.12 and pnpm >= 9.

## Checks

| Command | Tool | Notes |
| --- | --- | --- |
| `qa lint` | Biome by default, ESLint if configured | `--staged`, `--fix` |
| `qa format` | Biome by default, Prettier if configured | `--staged`, `--write` |
| `qa typecheck` | `tsc --noEmit` | |
| `qa test` | Vitest, no coverage | |
| `qa coverage` | Vitest + v8 coverage | thresholds: env > config > 100% |
| `qa deadcode` | knip | unused files, exports, dependencies |
| `qa boundaries` | dependency-cruiser | skipped without a rules file |
| `qa duplication` | jscpd | fails on any duplication by default |
| `qa smells` | Biome lint rules (project-configured) | source only, warnings fail |
| `qa audit` | npm/pnpm/yarn/bun audit | severity gate, default high |
| `qa ci` | all of the above | fail-fast, run-locked |
| `qa report` | merges SARIF + dependency-cruiser JSON | writes `dist/qa/qa.sarif` |
| `qa pre-commit` | staged gates for the hook | used by `qa hooks install` |

Configure via `qa.config.mjs`; see `packages/qa/src/config.ts`.

When the project has no `biome.json` of its own, the lint, format and smells
gates apply the preset shipped in `@develoz/qa/config/biome.default.json`. Add
your own `biome.json` (or extend `@develoz/biome-config`) to take over.

Install the pre-commit hook:

```sh
qa hooks install
```

## License

MIT
