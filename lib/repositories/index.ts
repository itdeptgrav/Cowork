/**
 * Repository selection.
 *
 * The single place that knows which implementation is in use. Swapping to a
 * production API is a one-line change here plus a new class satisfying
 * `CoworkRepository` — no component, hook or page changes.
 *
 * ## Why the prototype is not imported here any more
 *
 * It used to be, as the starting value of `current`:
 *
 * ```ts
 * import { mockRepository } from "./mock";
 * let current: CoworkRepository = mockRepository;
 * ```
 *
 * `getRepository()` is reached from every hook, so that one line put the whole
 * 12,000-line prototype — every method, and the seed data it answers from —
 * into the chunk EVERY page downloads. Measured on `/tasks`: **2,627 KB of
 * JavaScript executing on load, of which 728 KB was this**, on a page that
 * cannot reach the prototype at all. A bundler follows imports, not intentions,
 * and an import used as a default value is as real as any other.
 *
 * Nobody in production was reading it. `SessionProvider` installs the
 * legacy-backed repository before it reports `authenticated`, and
 * `WorkspaceShell` renders nothing without a session — so between page load and
 * the real repository arriving, this value is not consulted. The prototype is
 * reached on exactly one path, guarded by two build-time constants:
 * `NODE_ENV !== "production"` and `NEXT_PUBLIC_MOCK_SESSION === "1"`.
 *
 * So it is now fetched by that path, and only by it — `installMockRepository()`
 * below. A dynamic `import()` is a real split point, so the prototype becomes a
 * chunk of its own that nothing downloads unless it is actually going to be
 * used.
 *
 * The test suite is untouched: its 43 files import `./mock` directly, which is
 * the honest thing for a test to do and costs a browser nothing.
 *
 * ## What `current` holds before anything is installed
 *
 * Nothing — an empty object wearing the interface's type. That is a truthful
 * description of the state it represents: no repository has been installed, so
 * there is nothing to answer with. It is deliberately not a Proxy that forwards
 * on demand, because the interface has ~60 OPTIONAL members and the workspace
 * asks about them by feature detection — `typeof repo.uploadMessageAttachment
 * === "function"`, `repo.watchDutyRoster?.(…)`. A Proxy answers "yes" to every
 * such question, which would offer people controls the repository behind them
 * cannot honour. An empty object answers "no", which is both correct and what
 * those call sites are already written to survive.
 */

import type { CoworkRepository } from "./types";

export type { CoworkRepository } from "./types";
export * from "./types";

let current: CoworkRepository = {} as CoworkRepository;

export function getRepository(): CoworkRepository {
  return current;
}

/** Used by tests and, later, by the production bootstrap. */
export function setRepository(repo: CoworkRepository): void {
  current = repo;
}

/**
 * Fetch the prototype repository and make it the current one.
 *
 * The only runtime route to the mock store. Awaited by the caller, because a
 * dynamic import is the whole point — the prototype travels in its own chunk
 * and is fetched when somebody is about to use it, rather than by everybody on
 * every page.
 *
 * Idempotent: the second call returns the same instance rather than installing
 * a second store over the first.
 */
let mockInstall: Promise<CoworkRepository> | null = null;
export function installMockRepository(): Promise<CoworkRepository> {
  mockInstall ??= import("./mock/index.ts").then(({ mockRepository }) => {
    setRepository(mockRepository);
    return mockRepository;
  });
  return mockInstall;
}
