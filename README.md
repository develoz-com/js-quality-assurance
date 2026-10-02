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

## License

MIT
