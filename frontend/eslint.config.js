/**
 * Linting for the ComplyTrack frontend.
 *
 * The rules are the ones the codebase was written against: the TypeScript and
 * React recommended sets, the React Hooks rules, and `jsx-a11y` — the last
 * because the PRD holds the UI to WCAG 2.1 AA and an unenforced accessibility
 * guideline is a guideline nobody keeps.
 *
 * `npm run lint` runs this against the whole repository, so `eslint .` from the
 * frontend directory is the same check the Makefile's `lint` target runs.
 */

import js from "@eslint/js";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "e2e/.artifacts/**",
      "e2e/.report/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,

      // The underscore is the signal that a binding is deliberately unused —
      // destructuring a key away, or an argument a signature requires. Naming
      // it and keeping the convention is clearer than the alternatives.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Advisory, not enforced. The rule (React 19) is aimed at effects that
      // mirror derived state and cause a second render pass. The effects here
      // are the other kind: closing the mobile menu when the route changes,
      // re-seeding a dialog's fields when a different record is opened, and
      // moving the visible search box when a saved view is applied. Each is a
      // deliberate push of an external change into local state, and the
      // alternatives — a `key` on a component boundary, or a render-time
      // comparison — would spread the same logic further for no behavioural
      // gain. Kept visible rather than switched off so new instances are still
      // seen and judged.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  {
    // Build and test configuration runs in Node, not the browser.
    files: ["*.config.{js,ts}", "vite.config.ts", "playwright.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
