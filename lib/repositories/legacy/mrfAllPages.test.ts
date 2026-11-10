import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * "Some MRFs do not come" (10 Nov 2026): the engine pages both MRF lists — 20
 * rows unless told otherwise — and this app read only page one. Anybody with
 * more than twenty requests, and any approver whose queue passed twenty, lost
 * the rest. Every page is read now.
 */

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

const TOTAL = 120;
const rows = Array.from({ length: TOTAL }, (_, i) => ({
  _id: `mrf${i}`,
  mrfNumber: `MRF/2026-27/${String(i).padStart(4, "0")}`,
  status: "PENDING",
  requestType: "USES_BASED",
  priority: "NORMAL",
  reason: "x",
  requestedForId: "GR0108",
  requestedForName: "Pramod",
  items: [],
  statusHistory: [],
  createdAt: new Date(2026, 9, 1 + (i % 28)).toISOString(),
}));

/** A fake engine that pages exactly like the real routes: `page`, `limit`
 *  (default 20), and `pagination.total`. Records every page asked for. */
function engine(failOnPage?: number) {
  const asked: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = new URL(String(input));
    asked.push(url.pathname + url.search);
    const page = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    if (failOnPage === page)
      return new Response(JSON.stringify({ success: false, message: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    const slice = rows.slice((page - 1) * limit, page * limit);
    return new Response(
      JSON.stringify({
        success: true,
        mrfs: slice,
        stats: { total: TOTAL },
        pagination: { total: TOTAL, page, limit, totalPages: Math.ceil(TOTAL / limit) },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  return { asked, fetchImpl };
}

async function repo() {
  const { LegacyRepository } = await import("./index.ts");
  return new LegacyRepository({
    getToken: async () => "token",
    employeeId: "GR0108",
    legacyRole: "employee",
    archetype: "employee",
    hasManager: true,
  } as never);
}

async function withEngine<T>(e: ReturnType<typeof engine>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = e.fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("My requests reads every page, not the first twenty", async () => {
  const e = engine();
  const r = await repo();
  const out = await withEngine(e, () => r.listMyMrfs());
  assert.equal(out.requests.length, TOTAL);
  assert.equal(new Set(out.requests.map((m) => m.id)).size, TOTAL, "a request was read twice");
  assert.equal(e.asked.length, 3, "120 rows in pages of 50 is three reads");
  assert.ok(e.asked.every((u) => u.includes("limit=50")));
});

test("the approval queue reads every page too", async () => {
  const e = engine();
  const r = await repo();
  const out = await withEngine(e, () => r.listMrfApprovals("all"));
  assert.equal(out.requests.length, TOTAL);
  assert.ok(e.asked.every((u) => u.startsWith("/api/cowork/mrf/approvals") && u.includes("status=ALL")));
});

test("a first page that fails is still an error, never an empty list", async () => {
  const e = engine(1);
  const r = await repo();
  await assert.rejects(() => withEngine(e, () => r.listMyMrfs()));
});

test("a later page failing keeps what was read", async () => {
  const e = engine(2);
  const r = await repo();
  const out = await withEngine(e, () => r.listMyMrfs());
  assert.equal(out.requests.length, 50);
});
