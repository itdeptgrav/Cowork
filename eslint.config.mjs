import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /**
     * Hooks copied verbatim from `cowork-old-frontend`.
     *
     * These are the FUNCTIONAL SOURCE OF TRUTH for a behavioural re-skin: the
     * running product's Firestore listeners and timer state, copied so that the
     * new interface behaves identically. They are evidence, not code to be
     * corrected.
     *
     * They trip rules this project holds itself to — reading refs during
     * render, incomplete effect dependencies. Those are genuine observations
     * about the old code, and every one of them is a change to *behaviour*: a
     * ref read at a different moment is a different value, and a corrected
     * dependency array re-runs an effect the old app did not re-run. Fixing them
     * would produce a timer that disagrees with the commits it measures.
     *
     * So the rules are off here and nowhere else. Anything in this directory is
     * a copy; anything written for this project lives outside it and is held to
     * the full standard.
     */
    files: ["lib/legacy-ui/**"],
    /* The copies carry their own eslint-disable comments. With the rules off
       here those become "unused directives" — reported against a file we must
       not edit, so the reporting is disabled rather than the comments removed. */
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-unused-vars": "off",
      /* The copies include TypeScript that predates this project's stricter
         settings. `any` in a copied file is a fact about the old code, not a
         decision made here — and narrowing it means reading the value
         differently, which is a behavioural change however small it looks. */
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored tooling, not application source.
    ".claude/**",
    ".agents/**",
    ".impeccable/**",
  ]),
]);

export default eslintConfig;
