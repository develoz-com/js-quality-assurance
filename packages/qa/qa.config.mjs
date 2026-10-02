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
};
