import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Expected completion has to follow the QUEUE, not only its own task.
 *
 * **The reported fault: "it increases correctly, but only after a refresh."**
 * The field fetched its answer through a hand-rolled `useEffect` whose
 * dependencies were all local — the task id, the subject, this task's own
 * budget, its requested date. None of those moves when the queue moves.
 *
 * And the queue is what the answer is made of. Credit an offline span and only
 * the HEAD of the queue's window grows; every task behind it should slide, but
 * their own fields are byte-identical, so the effect never re-ran. Reloading the
 * page ran it fresh, which is why the number was right — eventually.
 *
 * `useQuery` subscribes to the repository's version through
 * `useSyncExternalStore`, so any mutation anywhere re-runs it. Re-implementing
 * the fetch beside it opted this one field out of the mechanism built for it.
 */

const FIELD = "components/features/tasks/ExpectedCompletion.tsx";
const HOOKS = "lib/hooks/useRepository.ts";

const src = readFileSync(FIELD, "utf8");

test("the field fetches through useQuery, not its own effect", () => {
  assert.match(
    src,
    /const preview = useQuery\(/,
    "Expected completion fetches its own way again, so it no longer re-runs " +
      "when anything else in the queue changes.",
  );
  assert.ok(
    !/useEffect\(/.test(src),
    "a hand-rolled fetch effect is back beside the query",
  );
});

test("useQuery is the thing that watches for changes", () => {
  /* The premise. If `useQuery` ever stopped subscribing to the version, this
     field would go stale again and the test above would still pass. */
  const hooks = readFileSync(HOOKS, "utf8");
  const at = hooks.indexOf("export function useQuery");
  assert.ok(at > 0, "useQuery was renamed");
  const body = hooks.slice(at, at + 1200);
  assert.match(body, /useSyncExternalStore\(/);
  assert.match(body, /subscribeToRepository/);
  assert.match(
    body,
    /\$\{version\}/,
    "the version no longer forms part of the query key",
  );
});

test("the field still asks only when there is something to ask", () => {
  /* A task with no queue answer, no assignee or no agreed budget must not
     issue a preview at all — the guard moved into the fetcher and has to still
     be there. */
  assert.match(
    src,
    /chained \|\| !subject \|\| budgetSecs <= 0/,
    "the preview is requested even when there is nothing to compute against",
  );
});
