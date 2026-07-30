import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A changed reporting line becomes visible without reloading the page.
 *
 * The reported bug: a manager was changed, changed back, and the app kept
 * showing the first answer. The engine had persisted correctly — verified
 * against Mongo, `PRAMOD BISWAL (GR0108) → primaryManager RAKESH BISWAL
 * (GR0045)` — so nothing was lost. The directory and the derived tree were
 * cached for the repository's lifetime with NO invalidation path of any kind.
 *
 * Why a time bound and not an event: this application does not own the
 * mutation. There is no `setManager` here — reporting lines are edited in the
 * HR system — so there is no action to hang an invalidation off. Nothing inside
 * this app can know the tree changed; it can only stop believing an old answer
 * indefinitely.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const REPO = "lib/repositories/legacy/index.ts";

test("the people caches can be invalidated at all", () => {
  /* They could not. That is the bug, stated plainly. */
  const src = code(REPO);
  assert.match(src, /invalidatePeople\(\): void \{/);
  const fn = src.slice(src.indexOf("invalidatePeople(): void {"));
  assert.match(fn.slice(0, 400), /this\.#directory = null;/);
  assert.match(fn.slice(0, 400), /this\.#tree = null;/);
});

test("both caches expire, and expire together", () => {
  /* A fresh tree read against a stale directory would name people who no
     longer hold those lines. */
  const src = code(REPO);
  assert.equal(
    (src.match(/if \(this\.#peopleAreStale\(\)\) this\.invalidatePeople\(\);/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (src.match(/this\.#peopleFetchedAtMs = Date\.now\(\);/g) ?? []).length,
    2,
  );
});

test("the window is stamped on success, never on attempt", () => {
  /* Stamping before the fetch would start the window against an answer that
     might never arrive, and a failed read would then be trusted for a minute. */
  const src = code(REPO);
  const dir = src.slice(src.indexOf("async #employeesById("));
  const stampAt = dir.indexOf("#peopleFetchedAtMs = Date.now()");
  const returnAt = dir.indexOf("return map;");
  assert.ok(stampAt > 0 && returnAt > 0 && stampAt < returnAt);
  /* And a failed directory read still clears itself, as it always did. */
  assert.match(dir.slice(0, 1400), /this\.#directory = null;/);
});

test("the window is short enough to see your own edit", () => {
  /* Against what these cost and how often they change: the directory is one
     request, the tree is N, and a reporting line changes a few times a year. */
  const src = code(REPO);
  assert.match(src, /PEOPLE_TTL_MS = 60_000/);
});

test("a caller that knows better need not wait out the window", () => {
  /* A screen that has just edited a reporting line should refresh at once. */
  const src = code(REPO);
  assert.match(src, /invalidatePeople\(\): void/);
  assert.equal(
    /#invalidatePeople/.test(src),
    false,
    "the escape hatch is private and unusable",
  );
});

test("this app does not own the mutation, and does not pretend to", () => {
  /* If a `setManager` is ever added here, the TTL stops being the only
     mechanism and an explicit invalidation should hang off it — this test is
     the reminder. */
  const src = code(REPO);
  const types = code("lib/repositories/types.ts");
  for (const name of ["setManager", "updateManager", "assignManager"]) {
    assert.equal(src.includes(`${name}(`), false, `${name} exists — wire invalidatePeople to it`);
    assert.equal(types.includes(`${name}(`), false, `${name} declared — wire invalidatePeople to it`);
  }
});

test("the reporting tree is the one source, so there is no reverse list to sync", () => {
  /* No `teamMembers` array is stored anywhere: downward reach is DERIVED by
     inverting `my-managers`. That is why the reverse relationship cannot go out
     of step with the forward one — there is only one fact, read two ways. */
  const src = code(REPO);
  assert.match(src, /buildReportingTree\(answers\)/);
  assert.equal(
    /teamMembers/.test(src),
    false,
    "a stored downward list would need syncing and could disagree",
  );
});
