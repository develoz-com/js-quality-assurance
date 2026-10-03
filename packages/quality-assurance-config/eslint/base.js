import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Generic TypeScript / Node flat config. Type-aware rules use the project
 * service so no per-project `parserOptions.project` list is required.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "*.config.js"],
  }
);
