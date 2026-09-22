import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The Firestore client API, answered by the server.
 *
 * 96 import sites were re-pointed at this module without their code changing,
 * so what is protected here is that this module BEHAVES like the SDK those
 * sites were written against — in the places where the two would otherwise
 * quietly differ.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

/* ── The swap itself ──────────────────────────────────────────────────────── */

test("no browser code imports the Firestore SDK any more", () => {
  /* The whole point. One left behind is a screen that still reads Google. */
  const files = [
    "lib/hooks/useFCMToken.ts",
    "lib/legacy/firebase.ts",
    "lib/legacy-ui/useCoworkNotifications.ts",
    "lib/legacy-ui/useCoworkTaskList.js",
    "lib/legacy-ui/useDutyStatus.js",
    "lib/legacy-ui/useMeetingTranscript.ts",
    "lib/legacy-ui/useTaskTimer.js",
    "lib/repositories/legacy/index.ts",
    "lib/repositories/legacy/taskWatch.ts",
    "components/features/tasks/NewAssignmentGate.tsx",
  ];
  for (const f of files)
    assert.ok(!code(f).includes('"firebase/firestore"'), `${f} still imports firebase/firestore`);
});

test("the session mounts the live connection once the repository is live", () => {
  const s = code("components/features/auth/SessionProvider.tsx");
  const watch = s.indexOf("taskWatchStop = startTaskWatch(");
  const sock = s.indexOf("connectAppSocket(data.employeeId)");
  assert.ok(watch > 0 && sock > watch, "the socket is not started after the task watch");
});

/* ── Behaviour, with the network replaced ─────────────────────────────────── */

test("the client behaves like the SDK where the two would differ", async () => {
  const m = await import("./firestoreClient.ts");
  const sent: Record<string, unknown>[] = [];
  const restore = m.setDataTransport(async (op) => {
    sent.push(op);
    switch (op.op) {
      case "get":
        return { doc: { id: (op.path as string[])[1], exists: true, data: { n: 1, at: { _seconds: 1_700_000_000, _nanoseconds: 0 } } } };
      case "query":
        return { docs: [{ id: "a", exists: true, data: { n: 1 } }, { id: "b", exists: true, data: { n: 2 } }] };
      case "add":
        return { id: "NEW1" };
      default:
        return { ok: true };
    }
  });
  try {
    const db = m.getFirestore();

    /* exists() is a METHOD — 65 call sites call it as one. */
    const snap = await m.getDoc(m.doc(db, "cowork_tasks", "T1"));
    assert.equal(typeof snap.exists, "function");
    assert.equal(snap.exists(), true);
    assert.equal(snap.id, "T1");

    /* Timestamps arrive as _seconds/_nanoseconds and answer toDate(). */
    const at = snap.data()!.at as InstanceType<typeof m.Timestamp>;
    assert.ok(at instanceof m.Timestamp);
    assert.equal(at.toDate().getTime(), 1_700_000_000_000);
    assert.equal(at.seconds, 1_700_000_000);

    /* Paths compose the way the SDK's do, including subcollections. */
    const chat = m.collection(db, "cowork_tasks", "T1", "chat");
    assert.deepEqual([...chat.segments], ["cowork_tasks", "T1", "chat"]);
    assert.equal(chat.path, "cowork_tasks/T1/chat", "path must be a string, as the SDK's is");
    assert.equal(chat.flatName, "cowork_tasks__chat");
    assert.equal(m.doc(chat).id.length, 20, "auto id is not Firestore-shaped");
    assert.throws(() => m.doc(db, "cowork_tasks"), /Invalid document path/);

    /* A query is sent as its constraints, with sentinels encoded. */
    const qs = await m.getDocs(
      m.query(m.collection(db, "cowork_tasks"), m.where("assigneeIds", "array-contains", "E1"), m.orderBy("updatedAt", "desc"), m.limit(10)),
    );
    assert.equal(qs.size, 2);
    assert.equal(qs.empty, false);
    assert.deepEqual(qs.docs.map((d) => d.id), ["a", "b"]);
    assert.equal(qs.docChanges().length, 2);
    const q = sent.find((o) => o.op === "query")!;
    assert.deepEqual(q.where, [{ field: "assigneeIds", op: "array-contains", value: "E1" }]);
    assert.deepEqual(q.orderBy, [{ field: "updatedAt", dir: "desc" }]);
    assert.equal(q.limit, 10);

    /* Writes: sentinels and dates go over the wire as tagged objects. */
    await m.updateDoc(m.doc(db, "cowork_tasks", "T1"), {
      at: m.serverTimestamp(),
      n: m.increment(2),
      tags: m.arrayUnion("x"),
      when: new Date(1_700_000_000_500),
      gone: m.deleteField(),
    });
    const u = sent.find((o) => o.op === "update")!;
    assert.deepEqual(u.data, {
      at: { __fv: "serverTimestamp" },
      n: { __fv: "increment", by: 2 },
      tags: { __fv: "arrayUnion", values: ["x"] },
      when: { __ts: { seconds: 1_700_000_000, nanoseconds: 500_000_000 } },
      gone: { __fv: "delete" },
    });

    /* documentId() is the SDK's spelling of "the id". */
    assert.equal(m.documentId(), "__name__");

    /* addDoc returns a reference carrying the id the server chose. */
    const added = await m.addDoc(chat, { text: "hi" });
    assert.deepEqual([...added.segments], ["cowork_tasks", "T1", "chat", "NEW1"]);

    /* A batch is one request. */
    const batch = m.writeBatch(db);
    batch.set(m.doc(db, "cowork_tasks", "T1"), { a: 1 });
    batch.delete(m.doc(db, "cowork_tasks", "T2"));
    await batch.commit();
    const b = sent.find((o) => o.op === "batch")!;
    assert.equal((b.ops as unknown[]).length, 2);

    /* runTransaction resolves to the callback's value. */
    const v = await m.runTransaction(db, async (tx) => {
      const s = await tx.get(m.doc(db, "cowork_tasks", "T1"));
      tx.update(m.doc(db, "cowork_tasks", "T1"), { n: (s.data()!.n as number) + 1 });
      return "done";
    });
    assert.equal(v, "done");

    assert.throws(() => m.collectionGroup(db, "chat"), /not supported/);
  } finally {
    m.setDataTransport(restore);
  }
});

test("onSnapshot reads once, then reads only what changed", async () => {
  /**
   * The behaviour this replaces re-ran the whole query on every notice. On an
   * open conversation that was 444 messages, 212 KB, per message either side
   * sent. Firestore never did that: after the first snapshot it delivered the
   * documents that changed and nothing else.
   */
  const m = await import("./firestoreClient.ts");
  const sock = await import("@/lib/realtime/appSocket");
  const reads: string[] = [];
  const restore = m.setDataTransport(async (op) => {
    reads.push(op.op as string);
    if (op.op === "get") {
      const id = (op as unknown as { path: string[] }).path[3];
      return { doc: { id, exists: true, data: { text: `${id}!` } } };
    }
    return { docs: [{ id: "m1", exists: true, data: { text: "first" } }] };
  });
  const seen: string[][] = [];
  const stop = m.onSnapshot(
    m.collection(m.getFirestore(), "cowork_tasks", "T1", "chat"),
    (snap) => {
      seen.push(snap.docs.map((d) => d.data().text as string));
    },
  );
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    await settle(20);
    assert.deepEqual(seen, [["first"]], "no initial read");
    assert.deepEqual(reads, ["query"], "the first read was not the whole collection");

    /* A change to some OTHER collection must not read anything. */
    sock.__emitForTest({ collection: "cowork_notifications", id: "x", operation: "insert" });
    await settle(m.SNAPSHOT_COALESCE_MS + 30);
    assert.deepEqual(reads, ["query"]);

    /* A new message: ONE read, for that message, and it joins what is held. */
    for (let i = 0; i < 5; i += 1)
      sock.__emitForTest({ collection: "cowork_tasks__chat", id: "m2", operation: "insert" });
    await settle(m.SNAPSHOT_COALESCE_MS + 40);
    assert.deepEqual(reads, ["query", "get"], "a new message re-read the whole thread");
    assert.deepEqual(seen[1], ["first", "m2!"], "the new message did not join the thread");

    /* A message in somebody ELSE’s conversation reads as absent through this
       parent-scoped reference, and must not re-render this one. */
    const before = seen.length;
    m.setDataTransport(async (op) => {
      reads.push(op.op as string);
      return op.op === "get" ? { doc: { id: "zz", exists: false } } : { docs: [] };
    });
    sock.__emitForTest({ collection: "cowork_tasks__chat", id: "zz", operation: "insert" });
    await settle(m.SNAPSHOT_COALESCE_MS + 40);
    assert.equal(seen.length, before, "a message in another conversation re-rendered this one");

    /* A delete removes the message that went. */
    sock.__emitForTest({ collection: "cowork_tasks__chat", id: "m2", operation: "delete" });
    await settle(m.SNAPSHOT_COALESCE_MS + 40);
    assert.deepEqual(seen[seen.length - 1], ["first"], "a deleted message stayed on screen");

    /* A resync cannot be patched -- it means changes were missed -- so it reads
       everything again. */
    m.setDataTransport(async (op) => {
      reads.push(op.op as string);
      return { docs: [{ id: "m9", exists: true, data: { text: "afresh" } }] };
    });
    sock.__emitForTest({ resync: true });
    await settle(m.SNAPSHOT_COALESCE_MS + 40);
    assert.deepEqual(seen[seen.length - 1], ["afresh"], "a resync did not read everything again");
  } finally {
    stop();
    m.setDataTransport(restore);
  }

  /* And after stop, nothing. */
  const quiet = seen.length;
  sock.__emitForTest({ collection: "cowork_tasks__chat", id: "m3", operation: "insert" });
  await new Promise((r) => setTimeout(r, m.SNAPSHOT_COALESCE_MS + 30));
  assert.equal(seen.length, quiet);
});

test("a constrained watch still reads the whole query, because only the server can place a row", async () => {
  /* With a where/orderBy/limit, whether a changed document still belongs in the
     result, and where, is not something a local cache may decide. */
  const m = await import("./firestoreClient.ts");
  const sock = await import("@/lib/realtime/appSocket");
  const ops: string[] = [];
  const restore = m.setDataTransport(async (op) => {
    ops.push(op.op as string);
    return { docs: [{ id: "a", exists: true, data: {} }] };
  });
  const stop = m.onSnapshot(
    m.query(
      m.collection(m.getFirestore(), "cowork_tasks", "T1", "chat"),
      m.orderBy("createdAt", "desc"),
      m.limit(30),
    ),
    () => {},
  );
  try {
    await new Promise((r) => setTimeout(r, 20));
    sock.__emitForTest({ collection: "cowork_tasks__chat", id: "m2", operation: "insert" });
    await new Promise((r) => setTimeout(r, m.SNAPSHOT_COALESCE_MS + 40));
    assert.deepEqual(ops, ["query", "query"], "a constrained watch was patched locally");
  } finally {
    stop();
    m.setDataTransport(restore);
  }
});

test("a parent watch also refetches on its subcollection, never the reverse", async () => {
  const m = await import("./firestoreClient.ts");
  assert.equal(m.noticeConcerns("cowork_tasks", "cowork_tasks__chat"), true);
  assert.equal(m.noticeConcerns("cowork_tasks", "cowork_tasks"), true);
  assert.equal(m.noticeConcerns("cowork_tasks__chat", "cowork_tasks"), false);
  assert.equal(m.noticeConcerns("cowork_tasks", "cowork_task_timers"), false);
});

/* ── Reads issued together travel together ────────────────────────────────── */

test("concurrent operations are sent as one request, and each still answers for itself", async () => {
  const m = await import("./firestoreClient.ts");
  const singles: unknown[] = [];
  const groups: unknown[][] = [];
  const t = m.createBatchingTransport(
    async (op) => {
      singles.push(op);
      return { doc: { id: "solo", exists: true, data: {} } };
    },
    async (ops) => {
      groups.push(ops);
      return {
        results: ops.map((op, i) =>
          i === 1
            ? { ok: false, status: 403, error: "You do not have access to this record." }
            : { ok: true, data: { doc: { id: String((op as unknown as { path: string[] }).path[1]), exists: true, data: {} } } },
        ),
      };
    },
  );

  /* Three reads started in the same tick. */
  const settled = await Promise.allSettled([
    t({ op: "get", path: ["cowork_tasks", "A"] }),
    t({ op: "get", path: ["cowork_tasks", "B"] }),
    t({ op: "get", path: ["cowork_tasks", "C"] }),
  ]);
  assert.equal(groups.length, 1, "three concurrent reads were not sent as one request");
  assert.equal(groups[0].length, 3);
  assert.equal(settled[0].status, "fulfilled");
  assert.equal(settled[1].status, "rejected", "a refusal in one slot did not reject that one");
  assert.equal(settled[2].status, "fulfilled", "a refusal in one slot took a sibling down with it");
  assert.equal(
    (settled[1] as PromiseRejectedResult).reason.code,
    "permission-denied",
    "the refusal lost its code on the way back",
  );

  /* One on its own is sent on its own — no new shape for the common case. */
  await t({ op: "get", path: ["cowork_tasks", "D"] });
  assert.equal(singles.length, 1);
  assert.equal(groups.length, 1, "a lone read was wrapped in a group");
});

test("a failed request fails every operation that was riding in it", async () => {
  const m = await import("./firestoreClient.ts");
  const t = m.createBatchingTransport(
    async () => ({}),
    async () => {
      throw new Error("offline");
    },
  );
  const settled = await Promise.allSettled([
    t({ op: "get", path: ["cowork_tasks", "A"] }),
    t({ op: "get", path: ["cowork_tasks", "B"] }),
  ]);
  assert.deepEqual(settled.map((r) => r.status), ["rejected", "rejected"]);
});
