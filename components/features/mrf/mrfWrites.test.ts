import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Every material-request write was refused before it reached a handler.
 *
 * The inventory routes run through the store-purchase middleware
 * (`grav-backend/Middlewear/storePurchaseTenant.js` → `withIdempotency`), which
 * refuses any mutation carrying no `Idempotency-Key`:
 *
 *   "This action needs an Idempotency-Key header so a retry cannot repeat it."
 *
 * `legacyFetch` had no way to send one, so creating a request, approving one,
 * rejecting one, cancelling one and posting to its chat all failed — and the
 * message landed on the form as if the form were at fault.
 *
 * The second half of the same report — "nothing shows in requests or
 * approvals" — was a different fault with the same shape: both list reads
 * answered a FAILED request with `[]`, so the page drew four zeroes and "no
 * requests yet". A confident wrong answer, indistinguishable from having none.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const HTTP = code("lib/legacy/http.ts");
const REPO = code("lib/repositories/legacy/index.ts");
const AREA = code("components/features/mrf/MrfArea.tsx");

/* ── Sending the key ──────────────────────────────────────────────────────── */

test("the fetch layer can send an Idempotency-Key", () => {
  assert.match(HTTP, /idempotencyKey\?: string;/);
  assert.match(
    HTTP,
    /if \(request\.idempotencyKey\) headers\["Idempotency-Key"\] = request\.idempotencyKey;/,
  );
});

test("the header is only sent when a caller asks for it", () => {
  /* Sending one on every request would put a key on reads, which the engine
     does not want and which would make every GET look like a mutation. */
  assert.match(HTTP, /if \(request\.idempotencyKey\)/);
});

test("every guarded MRF write sends one", () => {
  /* create, cancel, tl-approve/tl-reject, and chat — the five operations
     `coworkMrfRoutes.js` wraps in `withIdempotency`. */
  const writes = ["createMrf", "cancelMrf", "decideMrf", "sendMrfChat"];
  for (const name of writes) {
    const at = REPO.indexOf(`async ${name}(`);
    assert.ok(at !== -1, `${name} moved`);
    const fn = REPO.slice(at, at + 2600);
    assert.match(
      fn,
      /idempotencyKey: this\.#idempotencyKey\(\),/,
      `${name} still writes without an idempotency key, so the engine refuses it`,
    );
  }
});

test("the key is per press, not per record", () => {
  /* Deriving it from the record would make a second, deliberate press a replay
     of the first — or a 409, since the engine refuses a reused key whose
     payload changed. Double-submit is closed by `useAction`, not by this. */
  const at = REPO.indexOf("#idempotencyKey(): string {");
  assert.ok(at !== -1, "the key generator is gone");
  const fn = REPO.slice(at, at + 400);
  assert.match(fn, /randomUUID/);
  assert.doesNotMatch(fn, /\bid\b/, "the key is derived from the record");
});

test("it does not assume randomUUID exists", () => {
  const at = REPO.indexOf("#idempotencyKey(): string {");
  const fn = REPO.slice(at, at + 400);
  assert.match(fn, /typeof c\.randomUUID === "function"/);
  assert.match(fn, /Math\.random/);
});

/* ── Not turning a failure into an empty list ─────────────────────────────── */

test("a failed MRF read is raised, not answered with an empty list", () => {
  for (const name of ["listMyMrfs", "listMrfApprovals"]) {
    const at = REPO.indexOf(`async ${name}(`);
    assert.ok(at !== -1, `${name} moved`);
    const fn = REPO.slice(at, at + 2000);
    assert.match(
      fn,
      /if \(!r\.ok\) throw new Error\(r\.error\.message\);/,
      `${name} still turns a refused request into "you have none"`,
    );
    assert.doesNotMatch(
      fn,
      /const requests = r\.ok\s*\?/,
      `${name} still branches the list on r.ok`,
    );
  }
});

test("the page renders that failure instead of four zeroes", () => {
  /* It destructured only `data`, `isLoading` and `refetch`, so an error had
     nowhere to go even once the repository raised one. */
  assert.match(AREA, /if \(requests\.error\)/);
  assert.match(AREA, /if \(approvals\.error\)/);
  assert.match(AREA, /Your material requests could not be loaded\./);
  assert.match(AREA, /The approval queue could not be loaded\./);
  assert.match(AREA, /queries=\{\[requests\]\}/);
  assert.match(AREA, /queries=\{\[approvals\]\}/);
});
