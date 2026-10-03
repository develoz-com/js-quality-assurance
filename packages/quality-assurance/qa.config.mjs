// Dogfood config for this package itself. The published default stays at 100%
// coverage; this repo's current numbers are lower while the suite grows.
export default {
  coverage: {
    lines: 85,
    branches: 70,
    functions: 95,
    statements: 85,
  },
  duplication: {
    threshold: 1,
  },
  // The CLI bundles stylelint so `qa styles` works with no app install, which
  // pulls `braces` (GHSA-vfj7-8cjw-p6xm) into this workspace's production audit
  // with no upstream fix. Consumers install the CLI as a devDependency, so
  // `qa audit --prod` excludes it there and this ignore is self-only.
  audit: {
    ignoreAdvisories: ["GHSA-vfj7-8cjw-p6xm"],
  },
};
