/**
 * Opinionated Prettier config. Mirrors the Biome formatting defaults so switching
 * formatters does not reflow the codebase.
 */
export default {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "es5",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
};
