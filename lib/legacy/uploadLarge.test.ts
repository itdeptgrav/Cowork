import assert from "node:assert/strict";
import { test, before, after } from "node:test";
/**
 * Set BEFORE either module is loaded.
 *
 * `publicEnv.ts` snapshots `process.env` when it is first evaluated — that is
 * the whole point of it, so Next can inline the values at build time — and a
 * static import would be hoisted above these lines. Both uploaders are
 * therefore imported dynamically, after the environment they read exists.
 * Without this the session call throws `LegacyConfigError` and every test
 * below reports "Could not start the upload", which says nothing about the
 * upload.
 */
process.env.NEXT_PUBLIC_LEGACY_API_URL ??= "https://engine.example";
process.env.NEXT_PUBLIC_API_URL ??= "https://engine.example";
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "test";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??= "test";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= "test";
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??= "test";
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??= "test";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??= "test";

const { putToSession } = await import("./driveUpload.ts");
const { uploadAttachment } = await import("./attachments.ts");

/**
 * **A gigabyte, through the real code.** Asked for 28 September 2026, in these
 * words: *are u test or not lik 1 gb files in summbsion time test all*.
 *
 * The honest answer was no. Everything about uploads up to that point had been
 * asserted on the SOURCE — that a resume exists, that a 308 is read as
 * progress, that the finalize asks for a fresh token. None of it had ever been
 * executed, and the two faults that were actually reported are both arithmetic
 * and sequencing at a scale no source-read reaches: 128 chunks that must cover
 * every byte exactly once, and a token that expires between the first chunk
 * and the last call.
 *
 * So this runs `putToSession` and `uploadAttachment` for real, against a
 * scripted Google and a scripted engine, with a 1 GiB file.
 *
 * **What is faked and what is not.** The file is a structural stand-in — `size`
 * and `slice` — because allocating a gigabyte to prove `Blob.slice` works
 * would be testing Node. Everything under test is ours: the chunk boundaries,
 * the `Content-Range` headers, the resume offset after a drop, the progress
 * arithmetic, the retry budget, and which token the finalize sends. The
 * existing `driveUpload.test.ts` warns that a fake this elaborate "mostly
 * proves the fake works"; that is true of a fake that ALSO decides the
 * protocol, so this one only records and replays — every decision about what
 * to send next is made by the code being tested.
 */

const MiB = 1024 * 1024;
const CHUNK = 8 * MiB;
const GIB = 1024 * MiB;

/** A file the size of a feature film, without the bytes. */
function bigFile(size: number, name = "Vishwanath.and.Sons.2026.1080p.mkv"): File {
  return {
    name,
    size,
    type: "video/x-matroska",
    slice: (start: number, end: number) => ({ size: end - start }),
  } as unknown as File;
}

interface Reply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Google's resumable endpoint, as far as this code can tell.
 *
 * It answers the protocol and nothing else: 308 with a `Range` for a partial
 * upload, 200 with an id when it has the lot, and whatever fault the script
 * asks for. It never tells the caller what to do next.
 */
function scriptedGoogle(total: number, script: { dropAt?: number; expireAt?: number } = {}) {
  let received = 0;
  let dropped = false;
  let expired = false;
  const puts: { range: string | undefined; length: number }[] = [];

  return {
    puts,
    get received() {
      return received;
    },
    handle(headers: Record<string, string>, length: number): Reply {
      const range = headers["Content-Range"];

      /* `bytes STAR/total` — the "how much do you have" query. */
      if (range && range.includes("*/")) {
        if (expired) return { status: 410 };
        return received === 0
          ? { status: 308, headers: {} }
          : { status: 308, headers: { Range: `bytes=0-${received - 1}` } };
      }

      puts.push({ range, length });

      if (script.expireAt !== undefined && !expired && received + length > script.expireAt) {
        expired = true;
        return { status: 410 };
      }
      if (script.dropAt !== undefined && !dropped && received + length > script.dropAt) {
        dropped = true;
        /* A dropped connection is not a rejected chunk: Google keeps whatever
           reached it, which is the whole reason a resume is possible. */
        received = script.dropAt;
        return { status: 0 };
      }

      received += length;
      return received >= total
        ? { status: 200, body: JSON.stringify({ id: "drive-file-1" }) }
        : { status: 308, headers: { Range: `bytes=0-${received - 1}` } };
    },
  };
}

type Google = ReturnType<typeof scriptedGoogle>;
let google: Google;

class FakeXhr {
  status = 0;
  responseText = "";
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  #sent: Record<string, string> = {};
  #received: Record<string, string> = {};

  open(): void {}
  setRequestHeader(key: string, value: string): void {
    this.#sent[key] = value;
  }
  getResponseHeader(key: string): string | null {
    return this.#received[key] ?? null;
  }
  abort(): void {
    this.onabort?.();
  }
  send(body?: { size?: number }): void {
    const length = body?.size ?? 0;
    const reply = google.handle(this.#sent, length);
    setTimeout(() => {
      this.status = reply.status;
      this.responseText = reply.body ?? "";
      this.#received = reply.headers ?? {};
      if (reply.status === 0) {
        this.onerror?.();
        return;
      }
      if (length > 0) {
        this.upload.onprogress?.({ lengthComputable: true, loaded: length });
      }
      this.onload?.();
    }, 0);
  }
}

const realXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
before(() => {
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
});
after(() => {
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = realXhr;
});

/** Every byte, once, in order — the property the chunking has to have. */
function coverage(puts: { range: string | undefined }[], total: number) {
  let expected = 0;
  let resends = 0;
  for (const put of puts) {
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(put.range ?? "");
    assert.ok(m, `a chunk went out with no Content-Range: ${put.range}`);
    const [, from, to, size] = m.map(Number);
    assert.equal(size, total, "the total on a chunk disagrees with the file");
    assert.ok(to >= from, "a chunk ends before it starts");
    assert.ok(to - from + 1 <= CHUNK, "a chunk is bigger than the chunk size");
    if (from < expected) resends += expected - from;
    expected = Math.max(expected, to + 1);
  }
  return { reached: expected, resends };
}

/* ── One gigabyte, start to finish ────────────────────────────────────────── */

test("a 1 GiB file goes up in 128 chunks that cover it exactly once", async () => {
  google = scriptedGoogle(GIB);
  const result = await putToSession("https://upload.example/session", bigFile(GIB));

  assert.equal("expired" in result, false);
  assert.deepEqual(result, { ok: true, data: { id: "drive-file-1" } });

  /* 1 GiB / 8 MiB is exactly 128. A file that needed 129 requests, or 127,
     would mean the boundary arithmetic is off by a chunk. */
  assert.equal(google.puts.length, 128);
  assert.equal(google.received, GIB);

  /* The first and last ranges written out, because an off-by-one at either end
     is the failure this is really guarding: `Content-Range` counts inclusively
     and `slice` does not. */
  assert.equal(google.puts[0].range, `bytes 0-${CHUNK - 1}/${GIB}`);
  assert.equal(google.puts[127].range, `bytes ${GIB - CHUNK}-${GIB - 1}/${GIB}`);

  const { reached, resends } = coverage(google.puts, GIB);
  assert.equal(reached, GIB, "the chunks do not reach the end of the file");
  assert.equal(resends, 0, "a byte was sent twice on a clean run");
});

test("the bar moves across the whole file, never the slice", async () => {
  /* Reported as "it uploads and then starts again": progress reported against
     the CHUNK restarts at zero 128 times. */
  google = scriptedGoogle(GIB);
  const seen: number[] = [];
  await putToSession("https://upload.example/session", bigFile(GIB), (f) => seen.push(f));

  assert.equal(seen.length, 128);
  assert.ok(
    seen.every((f, i) => i === 0 || f >= seen[i - 1]),
    "progress went backwards",
  );
  assert.ok(seen[0] > 0 && seen[0] < 0.01, `the first report was ${seen[0]}`);
  assert.equal(seen[seen.length - 1], 1);
});

/* ── A drop most of the way through ───────────────────────────────────────── */

test("a connection that drops at 60% resumes rather than restarting", async () => {
  /**
   * The fault this whole path exists for. A 1 GiB file that failed at 600 MB
   * used to be re-sent from zero — which on a link that just proved it can
   * drop is how "big files never upload" happens.
   */
  const dropAt = 600 * MiB;
  google = scriptedGoogle(GIB, { dropAt });
  const result = await putToSession("https://upload.example/session", bigFile(GIB));

  assert.deepEqual(result, { ok: true, data: { id: "drive-file-1" } });
  assert.equal(google.received, GIB);

  const { reached, resends } = coverage(google.puts, GIB);
  assert.equal(reached, GIB);

  /**
   * At most ONE chunk is sent twice — the one that was in flight when the
   * connection died. Restarting would re-send 600 MB, which is what the
   * numbers here are chosen to make visible: 600 MB of resends and 8 MB of
   * resends are not a difference of degree.
   */
  assert.ok(
    resends <= CHUNK,
    `${(resends / MiB).toFixed(1)} MiB was re-sent — it restarted rather than resumed`,
  );

  /* And the first request after the drop asks Google where it got to, rather
     than assuming. */
  const afterDrop = google.puts.findIndex((p) => (p.range ?? "").startsWith(`bytes ${dropAt}-`));
  assert.ok(afterDrop > 0, "nothing resumed from the offset Google reported");
});

test("a session Google has forgotten is reported, not retried for ever", async () => {
  /* 410 means nothing can be resumed onto it. The caller opens a new one; this
     layer must say so rather than spend its retries on a dead session. */
  google = scriptedGoogle(GIB, { expireAt: 100 * MiB });
  const result = await putToSession("https://upload.example/session", bigFile(GIB));
  assert.deepEqual(result, { expired: true });
});

/* ── The hour ─────────────────────────────────────────────────────────────── */

/**
 * **The reported failure: 100%, then "failed".**
 *
 * A sign-in token lives one hour. It was read once, before the first chunk,
 * and the finalize — the small call that records the file — still carried it
 * an hour later. Every byte arrived and the transfer was thrown away.
 */

/** The engine, as far as the uploader can tell. `expiredTokens` are refused. */
function scriptedEngine(expiredTokens: string[]) {
  const seen: { path: string; token: string }[] = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    const token = String(
      (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
    ).replace("Bearer ", "");
    seen.push({ path, token });

    if (path.endsWith("/resumable-session")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sessionUrl: "https://upload.example/session" }),
      } as unknown as Response;
    }
    if (path.endsWith("/finalize")) {
      if (expiredTokens.includes(token)) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: "Session expired." }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          attachment: { id: "at-1", name: "file.mkv", type: "video/x-matroska", size: GIB },
        }),
      } as unknown as Response;
    }
    throw new Error(`unexpected call: ${path}`);
  };
  return { seen, fetchImpl };
}

test("a 1 GiB upload that outlives its token still finalizes", async () => {
  google = scriptedGoogle(GIB);
  /* "old" is the token read before the bytes. By the time 1 GiB has gone up
     the hour is spent, and the engine refuses it. */
  const engine = scriptedEngine(["old"]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = engine.fetchImpl as typeof fetch;
  try {
    const r = await uploadAttachment({
      token: "old",
      file: bigFile(GIB),
      entityType: "submission",
      entityId: "t-1:submission",
      freshToken: async () => "fresh",
    });
    assert.equal(r.ok, true, `the upload failed: ${JSON.stringify(r)}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(google.puts.length, 128, "the whole file did not go up");

  const finalize = engine.seen.filter((c) => c.path.endsWith("/finalize"));
  assert.equal(finalize.length, 1, "it should not have needed a second attempt");
  assert.equal(finalize[0].token, "fresh", "the finalize used the expired token");

  /* The session was opened with the token that was current THEN, which is
     correct — that call happens before any of this. */
  const session = engine.seen.find((c) => c.path.endsWith("/resumable-session"));
  assert.equal(session?.token, "old");
});

test("a finalize refused for its token is tried once more, and lands", async () => {
  /**
   * The gap this closes is real and small: a token can be valid when the
   * request is assembled and spent by the time the server reads it. One more
   * request is nothing against a transfer that took an hour.
   */
  google = scriptedGoogle(GIB);
  const engine = scriptedEngine(["old", "stale"]);
  const tokens = ["stale", "fresh"];
  const realFetch = globalThis.fetch;
  globalThis.fetch = engine.fetchImpl as typeof fetch;
  try {
    const r = await uploadAttachment({
      token: "old",
      file: bigFile(GIB),
      entityType: "submission",
      entityId: "t-1:submission",
      freshToken: async () => tokens.shift() ?? "fresh",
    });
    assert.equal(r.ok, true, `the upload failed: ${JSON.stringify(r)}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  const finalize = engine.seen.filter((c) => c.path.endsWith("/finalize"));
  assert.deepEqual(
    finalize.map((c) => c.token),
    ["stale", "fresh"],
    "it did not try again with a new token",
  );
});

test("without a way to refresh, the old failure is exactly reproduced", async () => {
  /**
   * The regression, executed rather than described. Same 1 GiB, same expired
   * token, no `freshToken` — every byte reaches Google and the upload is
   * reported as failed. This is what people were seeing.
   */
  google = scriptedGoogle(GIB);
  const engine = scriptedEngine(["old"]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = engine.fetchImpl as typeof fetch;
  let result: { ok: boolean };
  try {
    result = await uploadAttachment({
      token: "old",
      file: bigFile(GIB),
      entityType: "submission",
      entityId: "t-1:submission",
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(result.ok, false);
  assert.equal(google.received, GIB, "the bytes did arrive — that is the point");
});
