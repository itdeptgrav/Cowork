import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The wire contract for a department decision.
 *
 * The reported failure — *"decision must be 'approve' or 'reject'."* — on every
 * click. This helper sent `{ approved: boolean }`; `taskForward.js:1023` reads
 * `req.body.decision` and validates it against `["approve", "reject"]`. Wrong
 * field, wrong shape.
 *
 * These capture the REAL body by intercepting fetch, rather than asserting on
 * source text: the fault was in what went over the wire, so that is what is
 * checked.
 */

/* Set before the module is loaded, and loaded dynamically for that reason:
   `publicEnv.ts` snapshots `process.env` when it is first evaluated, and a
   static import would be hoisted above this line. */
for (const [k, v] of Object.entries({
  NEXT_PUBLIC_LEGACY_API_URL: "https://example.invalid",
  NEXT_PUBLIC_FIREBASE_API_KEY: "k",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "a",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "s",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "m",
  NEXT_PUBLIC_FIREBASE_APP_ID: "i",
})) {
  process.env[k] ??= v;
}

async function writer() {
  return (await import("./taskWrites.ts")).departmentApprove;
}

/** Captures the outgoing request and answers 200. */
async function capture(
  run: () => Promise<unknown>,
): Promise<{ url: string; body: Record<string, unknown> }> {
  const original = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | null = null;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    seen = {
      url: String(input),
      body: JSON.parse(init?.body ?? "{}") as Record<string, unknown>,
    };
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(seen, "no request was made");
  return seen!;
}

test("Approve sends decision: \"approve\"", async () => {
  const { body } = await capture(async () =>
    (await writer())({ token: "t", taskId: "T631", decision: "approve" }),
  );
  assert.equal(body.decision, "approve");
  assert.equal("approved" in body, false, "the old boolean field is still sent");
});

test("Refuse sends decision: \"reject\"", async () => {
  const { body } = await capture(async () =>
    (await writer())({
      token: "t",
      taskId: "T631",
      decision: "reject",
      rejectionReason: "No capacity",
    }),
  );
  assert.equal(body.decision, "reject");
  assert.equal(body.rejectionReason, "No capacity");
});

test("a reason is always present, because the route destructures it", async () => {
  /* `const { decision, rejectionReason = "" } = req.body` tolerates its
     absence, but sending the field keeps the two shapes identical. */
  const { body } = await capture(async () =>
    (await writer())({ token: "t", taskId: "T631", decision: "approve" }),
  );
  assert.equal(body.rejectionReason, "");
});

test("the only values the engine accepts are the only ones sendable", () => {
  /* The union is the guard. A plain `string` here is how the mismatch got in,
     and how it would come back. */
  const src = readFileSync("lib/legacy/taskWrites.ts", "utf8");
  assert.match(src, /export type DepartmentDecision = "approve" \| "reject";/);
  const fn = src.slice(src.indexOf("export async function departmentApprove("));
  assert.match(fn.slice(0, 500), /decision: DepartmentDecision;/);
  assert.equal(
    /decision\??: string/.test(fn.slice(0, 500)),
    false,
    "a bare string would let any verb through again",
  );
});

test("the past-participle forms never reach the wire", async () => {
  /* The domain says `approved`/`rejected` — a state — and the engine says
     `approve`/`reject` — an act. One letter apart, different meanings. */
  for (const decision of ["approve", "reject"] as const) {
    const { body } = await capture(async () =>
      (await writer())({ token: "t", taskId: "T631", decision }),
    );
    for (const wrong of ["approved", "rejected", "Approve", "Reject", "refuse"]) {
      assert.notEqual(body.decision, wrong);
    }
    assert.equal(typeof body.decision, "string", "a boolean reached the wire");
  }
});

test("the composite approval id is decoded before the URL is built", async () => {
  /* `T631#approval-0` in the path would 404. The decode lives in
     `decideApproval`; this pins that the helper is given a bare task id and
     encodes it unchanged. */
  const { url } = await capture(async () =>
    (await writer())({ token: "t", taskId: "T631", decision: "approve" }),
  );
  assert.match(url, /\/cowork\/task\/T631\/department-approve$/);
  assert.equal(url.includes("%23"), false, "an encoded # reached the path");
});

test("the review endpoints keep their booleans", () => {
  /* Not an oversight and not to be harmonised: `review-completion` and
     `ceo-review` both validate `typeof approved !== "boolean"`. Three sibling
     endpoints, two booleans and one verb — the inconsistency is the engine's,
     and matching it is the contract. */
  const src = readFileSync("lib/legacy/taskWrites.ts", "utf8");
  for (const fn of ["reviewCompletion", "ceoReviewCompletion"]) {
    const block = src.slice(src.indexOf(`export async function ${fn}(`));
    /* Window widened: these helpers now also carry `reworkRequirements`, whose
       doc comment pushed the assertion out of a 600-character slice. The claim
       is unchanged — both still send a boolean. */
    assert.match(block.slice(0, 1600), /approved: input\.approved/, `${fn} changed shape`);
  }
});

/* ── The time budget ──────────────────────────────────────────────────────── */

async function hoursWriter() {
  return (await import("./taskWrites.ts")).setDepartmentHours;
}

test("the budget is sent as hoursValue and hoursUnit", async () => {
  /* The route destructures `{ hoursValue, hoursUnit }` and then does
     `Number(hoursValue) || 0`, refusing `<= 0`. This once sent `{ windowSecs,
     hours }`, so every submission arrived as 0 and came back "Enter a valid
     number of hours."

     Now sent in MINUTES so a budget with minutes survives exactly — 4h is 240
     minutes, and the route reconstructs 240 × 60 = 14400 seconds. */
  const { body } = await capture(async () =>
    (await hoursWriter())({ token: "t", taskId: "T633", windowSecs: 4 * 3600 }),
  );
  assert.equal(body.hoursValue, 240);
  assert.equal(body.hoursUnit, "minutes");
  assert.equal("windowSecs" in body, false, "the old field is still sent");
});

test("the unit is one the route actually recognises", async () => {
  /* `val * (unit === "minutes" ? 60 : unit === "days" ? 86400 : 3600)` has no
     "seconds" case — anything unrecognised falls through to the HOURS
     multiplier. Sending seconds under a made-up unit would multiply the budget
     by 3600. */
  const { body } = await capture(async () =>
    (await hoursWriter())({ token: "t", taskId: "T633", windowSecs: 7200 }),
  );
  assert.ok(["hours", "minutes", "days"].includes(String(body.hoursUnit)));
  const unit =
    body.hoursUnit === "minutes" ? 60 : body.hoursUnit === "days" ? 86400 : 3600;
  assert.equal(
    Number(body.hoursValue) * unit,
    7200,
    "the engine would store a different budget than was chosen",
  );
});

test("a whole-hour budget survives the round trip exactly", async () => {
  for (const h of [1, 2, 3, 4, 6, 8, 12, 16, 24, 40]) {
    const { body } = await capture(async () =>
      (await hoursWriter())({ token: "t", taskId: "T633", windowSecs: h * 3600 }),
    );
    /* Minutes now: h hours is h × 60 minutes, and the route rebuilds the exact
       seconds as minutes × 60. */
    assert.equal(body.hoursValue, h * 60);
    assert.equal(body.hoursValue * 60, h * 3600);
  }
});

test("a budget WITH minutes survives the round trip exactly", async () => {
  /* The reason the unit changed. 4h 20m is 15600 seconds; the old hours path
     sent 15600 / 3600 = 4.3333, which the route turned back into 15599.88 and
     stored a budget one second short. As minutes it is 260, and 260 × 60 is
     15600 on the nose. */
  for (const [secs, mins] of [
    [15600, 260], // 4h 20m
    [2700, 45], //   45m
    [8100, 135], //  2h 15m
    [3900, 65], //   1h 05m
  ] as const) {
    const { body } = await capture(async () =>
      (await hoursWriter())({ token: "t", taskId: "T633", windowSecs: secs }),
    );
    assert.equal(body.hoursValue, mins, `${secs}s should send ${mins} minutes`);
    assert.equal(body.hoursValue * 60, secs, "the engine would store a different budget");
  }
});

test("the budget URL carries a bare task id", async () => {
  const { url } = await capture(async () =>
    (await hoursWriter())({ token: "t", taskId: "T633", windowSecs: 3600 }),
  );
  assert.match(url, /\/cowork\/task\/T633\/department-tl-set-hours$/);
});
