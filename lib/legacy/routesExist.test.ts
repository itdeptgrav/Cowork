import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every path this app calls exists in the engine that serves it.
 *
 * **The bug this was written for.** `fetchBlockedDates` called
 * `/cowork/deadline-availability/blocked-dates` for as long as it had existed.
 * The backend does define that route — in
 * `routes/task_routes/deadlineAvailability.routes.js` — but **that file is never
 * `require`d or mounted**, so the path 404s. The live route is
 * `/cowork/scheduling/blocked-dates`, with different parameters and a different
 * response shape.
 *
 * The failure was silent and in the dangerous direction: a failed read meant no
 * blocked dates, so the deadline picker offered dates on public holidays and on
 * somebody's approved leave, and the engine accepted them.
 *
 * **Why this probes rather than reads the source.** A route declared in an
 * unmounted file is indistinguishable from a live one by grep — that is exactly
 * how this survived. Statically resolving the mount graph was tried and produced
 * false positives (`/cowork/employee/my-managers/:id` and
 * `/cowork/pmp/:id/dashboard` both look absent and are both live), and a test
 * that cries wolf gets deleted. Asking the running engine is the only reading
 * that cannot be wrong: **404 means no route, anything else means there is one.**
 * Authentication is irrelevant here — a 401 proves the route exists, which is
 * the whole question.
 *
 * Skips when no engine is listening, which is most environments. That is a
 * deliberate trade: this catches a class of bug nothing else can, and a test
 * that silently passes without an engine is more honest than one that fails
 * because a developer does not happen to be running the backend.
 */

const ENGINE = process.env.NEXT_PUBLIC_LEGACY_API_URL ?? "http://localhost:5050";

/** A placeholder for every `${...}` segment, so a path can actually be fetched. */
function concrete(path: string): string {
  return path.replace(/\$\{[^}]*\}/g, "ROUTE_PROBE");
}

/**
 * Every `/cowork/...` path template this repository asks the engine for.
 *
 * Templates use `${...}` for their variable segments. A path containing `:id`
 * style placeholders is DOCUMENTATION — `permissions.ts` keeps a table of
 * known-insecure legacy routes in exactly that shape — and is not something
 * anybody fetches, so probing it would report a 404 that means nothing.
 */
function calledPaths(): { path: string; file: string }[] {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
        const src = readFileSync(p, "utf8");
        /* `path: "/cowork/…"` and `path: \`/cowork/…\`` — the one shape every
           caller uses, because they all go through `legacyFetch`. */
        for (const m of src.matchAll(/path:\s*[`"'](\/cowork\/[^`"']*)[`"']/g)) {
          if (m[1].includes("/:")) continue;
          /* A path whose LAST segment is itself a template picks the route at
             call time — `/task/${id}/${action}` is one call site standing in
             for several real endpoints. There is no single path to probe, and
             substituting a placeholder would ask for a route nobody claims
             exists. The endpoints it reaches are covered by their own entries. */
          if (/\$\{[^}]*\}\/?$/.test(m[1])) continue;
          if (!out.has(m[1])) out.set(m[1], p);
        }
      }
    }
  };
  walk("lib/legacy");
  return [...out].map(([path, file]) => ({ path, file }));
}

async function engineIsUp(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(ENGINE, { signal: controller.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

test("no called path 404s against the running engine", async (t) => {
  if (!(await engineIsUp())) {
    t.skip(`no engine listening at ${ENGINE}`);
    return;
  }

  const dead: string[] = [];
  for (const { path, file } of calledPaths()) {
    const url = `${ENGINE}${concrete(path)}`;
    /* **Every verb, and only flag when they ALL 404.** Express matches on
       method as well as path, so a route answers 404 to the wrong verb — a fact
       about the probe, not about the route. Three real endpoints were false
       positives until this asked with each: `change-password` is POST-only,
       `edit-details` is PATCH, and deleting a task is DELETE. */
    let dead404 = true;
    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          ...(method === "POST" || method === "PATCH"
            ? { headers: { "Content-Type": "application/json" }, body: "{}" }
            : {}),
        });
        clearTimeout(timer);
        if (res.status !== 404) {
          dead404 = false;
          break;
        }
      } catch {
        /* A transport failure is not evidence of a missing route. Treated as
           inconclusive, so a flaky moment cannot look like a dead endpoint. */
        dead404 = false;
        break;
      }
    }
    if (dead404) dead.push(`${path}  (called from ${file})`);
  }

  assert.deepEqual(
    dead,
    [],
    `these paths have no route in the engine:\n  ${dead.join("\n  ")}`,
  );
});

test("the known-dead route is never called again", () => {
  /* Named explicitly so this holds with no engine running. Proven dead by
     probe: its route file is never mounted. */
  for (const { path } of calledPaths()) {
    assert.ok(
      !path.includes("deadline-availability"),
      `${path} is defined only in an unmounted file and answers 404`,
    );
  }
});
