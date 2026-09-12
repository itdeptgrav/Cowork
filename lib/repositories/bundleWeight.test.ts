import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The prototype repository must not travel to the browser.
 *
 * ## What this is guarding
 *
 * `lib/repositories/index.ts` once opened:
 *
 * ```ts
 * import { mockRepository } from "./mock";
 * let current: CoworkRepository = mockRepository;
 * ```
 *
 * One line, and a reasonable-looking one — something has to be there before the
 * real repository is installed. But `getRepository()` is reached from every
 * hook on every page, so that import dragged the whole prototype into the chunk
 * EVERY page downloads: `mock/index.ts` itself, the seed store behind it, and —
 * through `searchHelp` — all 500 KB of the help corpus, which is answered by a
 * server route in production and has no business in a browser at all.
 *
 * Measured on `/tasks`, production build, scripts actually executed on load:
 *
 * | | scripts | raw | gzip |
 * |---|---|---|---|
 * | before | 23 | 2,627 KB | 790 KB |
 * | after  | 26 | 1,906 KB | 565 KB |
 *
 * 721 KB of JavaScript, on every page, for code no signed-in person can reach.
 *
 * ## Why the fix is a dynamic import and not a deletion
 *
 * The prototype is real and still used: the whole test suite runs against it,
 * and `NEXT_PUBLIC_MOCK_SESSION=1` opens the workspace on it in development. It
 * just has exactly one runtime entrance now, and that entrance is an `import()`
 * — a genuine split point, so it becomes a chunk nobody fetches unless they are
 * about to use it.
 *
 * ## Why not a Proxy for the default
 *
 * The obvious alternative — a Proxy that lazily forwards every property to the
 * loaded mock — is wrong here, and quietly so. `CoworkRepository` has around
 * sixty OPTIONAL members, and the workspace asks about them by feature
 * detection: `typeof repo.uploadMessageAttachment === "function"`,
 * `repo.watchDutyRoster?.(…)`. A Proxy answers "yes" to every one of those, so
 * the interface would offer people controls the repository behind them cannot
 * honour. An empty object answers "no" — correct, and what those call sites are
 * already written to survive.
 */

const src = (path: string): string =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const code = (path: string): string =>
  src(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const INDEX = code("lib/repositories/index.ts");
const SESSION = code("components/features/auth/SessionProvider.tsx");

test("the selector does not statically import the prototype", () => {
  /* The whole point. A static import here is reachable from every page's
     entry, whatever the branch that would have used it. */
  assert.ok(
    !/import\s*\{[^}]*\}\s*from\s*["']\.\/mock["']/.test(INDEX),
    "lib/repositories/index.ts imports ./mock statically again",
  );
  assert.ok(
    !/from\s*["']\.\/mock\//.test(INDEX),
    "a submodule of ./mock is imported statically",
  );
});

test("it is reached through a real split point", () => {
  assert.match(INDEX, /import\("\.\/mock\/index\.ts"\)/);
  assert.match(INDEX, /export function installMockRepository\(\)/);
});

test("installing twice does not build two stores", () => {
  /* Two prototype stores would be two different worlds, and whichever was
     installed second would silently win. */
  assert.match(INDEX, /mockInstall \?\?= import\("\.\/mock\/index\.ts"\)/);
});

test("nothing is answered from a repository that was never installed", () => {
  /* The placeholder is empty on purpose — see the note at the top of this file
     for why it must not be a forwarding Proxy. */
  assert.match(INDEX, /let current: CoworkRepository = \{\} as CoworkRepository;/);
});

test("the prototype is fetched before it is read, on the one path that reads it", () => {
  const branch = SESSION.slice(
    SESSION.indexOf('process.env.NEXT_PUBLIC_MOCK_SESSION === "1"'),
  );
  const install = branch.indexOf("await installMockRepository()");
  const firstUse = branch.indexOf("getRepository()");
  assert.ok(install > 0, "the dev session no longer installs the prototype");
  assert.ok(
    install < firstUse,
    "getRepository() is read before the prototype has been fetched",
  );
});

test("that path is still gated to development builds", () => {
  /* Both constants are inlined at build time, which is what lets the bundler
     drop the call site — and with it the only reference to the chunk. */
  const branch = SESSION.slice(
    SESSION.indexOf("const load = useCallback"),
    SESSION.indexOf("await installMockRepository()"),
  );
  assert.match(branch, /process\.env\.NODE_ENV !== "production"/);
  assert.match(branch, /process\.env\.NEXT_PUBLIC_MOCK_SESSION === "1"/);
});

test("the help corpus reaches the browser through nothing else", () => {
  /* 500 KB of article prose. It is answered by `app/api/help/route.ts` on the
     server; the only client-side importer was the prototype's `searchHelp`, and
     a new one would put all of it back on every page. */
  const importers = [
    "components/layout/help/HelpAssistant.tsx",
    "components/layout/help/GuidedTour.tsx",
    "lib/repositories/types.ts",
  ];
  for (const path of importers) {
    const text = code(path);
    assert.ok(
      !/from\s*["']@\/lib\/help\/knowledge["']/.test(text) ||
        /import\s+type/.test(text),
      `${path} pulls the help corpus into the client bundle`,
    );
  }
});

test("the seed data has no other way in either", () => {
  /* `lib/seed/seed.ts` is the prototype's world. It is imported by the mock's
     store and must stay that way. */
  const store = code("lib/repositories/mock/store.ts");
  assert.match(store, /import \* as seed from "@\/lib\/seed\/seed"/);
});

test("the prototype still arrives, and answers, when it is asked for", () => {
  /* The source assertions above prove the wiring; this proves the wiring
     works. Installing must give `getRepository()` a real repository — a
     dynamic import that resolved to nothing would satisfy every test above
     and leave the development session reading from an empty object. */
  return (async () => {
    const mod = await import("./index.ts");
    assert.equal(
      typeof (mod.getRepository() as { listTasks?: unknown }).listTasks,
      "undefined",
      "something is installed before anyone installed it",
    );
    const repo = await mod.installMockRepository();
    assert.equal(typeof repo.listTasks, "function");
    assert.equal(mod.getRepository(), repo, "installed, but not made current");
    assert.equal(
      await mod.installMockRepository(),
      repo,
      "a second install built a second store",
    );
  })();
});
