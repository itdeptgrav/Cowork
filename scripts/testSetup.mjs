import { register } from "node:module";

/**
 * Test-run setup, loaded through `node --import`.
 *
 * Registers the `@/*` resolver so `node --test` can load modules that use the
 * tsconfig path alias. Kept separate from the resolver itself because
 * `register` runs on the main thread while the hooks it installs run on their
 * own — putting both in one file makes that boundary easy to cross by accident.
 */
register("./testAliasResolver.mjs", import.meta.url);
