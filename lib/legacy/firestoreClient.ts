"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The Firestore client SDK's API, answered by the Cowork server.
 *
 * ## What this replaces
 *
 * 147 import sites in this frontend loaded `firebase/firestore` and used the
 * modular API — `collection`, `doc`, `getDoc`, `getDocs`, `query`, `where`,
 * `onSnapshot`, `setDoc`, `updateDoc`, `addDoc`, `writeBatch`,
 * `serverTimestamp`, `Timestamp` … — against a database the browser held a
 * connection to. That database is now MongoDB, which a browser must never hold
 * a connection to, so every one of those calls has to become a request to the
 * server instead.
 *
 * Rewriting them is weeks of edits through code that decides deadlines and
 * approvals. Instead this module exports the SAME names with the SAME shapes,
 * and the import specifier was swapped. The call sites did not change — which
 * is why the types here mirror the SDK's, generics included: the sites were
 * typed against `QuerySnapshot<T>`, `DocumentData`, `Unsubscribe`, and a
 * `ref.path` that is a string.
 *
 * ## What goes over the wire
 *
 * `POST /cowork/db` with `{ op, path, … }`, carrying the Firebase ID token
 * exactly like every other request — authentication is unchanged. The server
 * applies the access policy in `services/mongo/dataAccess.js`, which is what
 * stands where Firestore's security rules stood.
 *
 * ## The semantics that matter
 *
 * · **`snap.exists()` is a METHOD** here. The client SDK's is; the admin SDK's
 *   is a property. 65 call sites in this frontend call it, so it is a method.
 * · **Timestamps.** The server sends `{_seconds, _nanoseconds}` — the shape a
 *   Firestore Timestamp has always had on the wire — and this revives it into
 *   a `Timestamp` that answers `toDate()`, `toMillis()`, `seconds`,
 *   `nanoseconds`. Going out, a `Timestamp` or `Date` becomes `{__ts: …}`.
 * · **Sentinels.** `serverTimestamp()` and friends become `{__fv: …}` on the
 *   wire; the server turns them back into the real thing.
 * · **`onSnapshot`** is an initial fetch plus a refetch whenever the server's
 *   `realtime:change` names the collection being watched. It does not ship a
 *   diff — the second read is the truth, and there is never a second copy of
 *   it in the browser to disagree with the first.
 *
 * Written without TypeScript parameter properties, on purpose: the test
 * harness runs on Node's strip-only TypeScript, which refuses them — and this
 * module is imported by `lib/legacy/firebase.ts`, so a syntax Node cannot
 * strip here would take every test that touches sign-in down with it.
 *
 * `collectionGroup` is not supported and says so; nothing here uses it.
 */

import { idToken } from "./firebase";
import { legacyFetch } from "./http";
import { subscribeToChanges } from "@/lib/realtime/appSocket";

/* ── Types the call sites were written against ────────────────────────────── */

/** As the SDK defines it: a bag of fields whose values are anything. */
export type DocumentData = { [field: string]: any };
export type Unsubscribe = () => void;
export interface SnapshotListenOptions {
  includeMetadataChanges?: boolean;
}
export interface SnapshotMetadata {
  readonly fromCache: boolean;
  readonly hasPendingWrites: boolean;
}
export type WhereFilterOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not-in"
  | "array-contains"
  | "array-contains-any";
export type OrderByDirection = "asc" | "desc";
export interface SetOptions {
  merge?: boolean;
}

const METADATA: SnapshotMetadata = Object.freeze({ fromCache: false, hasPendingWrites: false });

/* ── Transport ────────────────────────────────────────────────────────────── */

type Op = Record<string, unknown> & { op: string };
type Transport = (op: Op) => Promise<Record<string, unknown>>;

/** One request, one operation — the shape the server has always answered. */
async function postOne(op: Op): Promise<Record<string, unknown>> {
  const token = (await idToken().catch(() => null)) ?? undefined;
  const r = await legacyFetch<Record<string, unknown>>({
    path: "/cowork/db",
    method: "POST",
    body: op,
    token,
  });
  if (!r.ok) throw transportError(r.error.kind, r.error.message, r.error.status);
  return r.data;
}

function transportError(kind: string, message: string, status: number) {
  const e = new Error(message) as Error & { code: string; status: number };
  e.code =
    kind === "permission"
      ? "permission-denied"
      : kind === "not_found"
        ? "not-found"
        : kind === "auth"
          ? "unauthenticated"
          : "unavailable";
  e.status = status;
  return e;
}

/** Turn a slot of a `multi` answer back into a resolved value or a throw. */
function settle(
  slot: { ok?: boolean; data?: Record<string, unknown>; status?: number; error?: string } | undefined,
): Record<string, unknown> {
  if (!slot) throw transportError("unavailable", "The request did not come back.", 500);
  if (slot.ok) return slot.data ?? {};
  const status = slot.status ?? 500;
  const kind =
    status === 403 ? "permission" : status === 404 ? "not_found" : status === 401 ? "auth" : "unavailable";
  throw transportError(kind, slot.error ?? "The request could not be completed.", status);
}

/** How many operations the server accepts in one `multi`. */
const MULTI_MAX = 50;

/**
 * Operations issued in the same tick travel together.
 *
 * ## Why this is here at all
 *
 * Firestore multiplexed every read over one connection. A request per read does
 * not: a browser opens six connections to one origin and queues the rest. The
 * conversation list asks for an unread count per conversation — fourteen reads
 * for this workspace — so they arrive in three waves rather than one, and every
 * incoming message re-runs them. That queueing is most of what a reader feels
 * as chat being sluggish.
 *
 * ## What it does NOT change
 *
 * Nothing about what is asked for, in what order, or who may have it. Each
 * operation is still executed on its own by the server, still against the same
 * policy, and still resolves or throws on its own — a refusal in one does not
 * disturb the others. A single operation with nothing to travel with is sent
 * exactly as before.
 *
 * The wait is one turn of the event loop, which is also what makes the grouping
 * possible: everything a `Promise.all` starts is queued before the flush runs.
 */
type Waiting = {
  op: Op;
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: unknown) => void;
};

export function createBatchingTransport(
  sendOne: (op: Op) => Promise<Record<string, unknown>>,
  sendMany: (ops: Op[]) => Promise<Record<string, unknown>>,
): Transport {
  let queue: Waiting[] = [];
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    if (batch.length === 0) return;
    if (batch.length === 1) {
      const only = batch[0];
      sendOne(only.op).then(only.resolve, only.reject);
      return;
    }
    for (let i = 0; i < batch.length; i += MULTI_MAX) {
      const slice = batch.slice(i, i + MULTI_MAX);
      sendMany(slice.map((w) => w.op)).then(
        (answer) => {
          const results = (answer?.results ?? []) as Record<string, unknown>[];
          slice.forEach((w, at) => {
            try {
              w.resolve(settle(results[at] as never));
            } catch (e) {
              w.reject(e);
            }
          });
        },
        /* The request itself failed, so every operation in it failed. */
        (e) => slice.forEach((w) => w.reject(e)),
      );
    }
  };

  return (op) =>
    new Promise((resolve, reject) => {
      queue.push({ op, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    });
}

let transport: Transport = createBatchingTransport(postOne, (ops) =>
  postOne({ op: "multi", ops } as Op),
);

/** For tests: replace the network with a function. Returns the previous one. */
export function setDataTransport(next: Transport): Transport {
  const prev = transport;
  transport = next;
  return prev;
}

/* ── The database handle ──────────────────────────────────────────────────── */

/** What `legacyDb()` now returns. It carries nothing; the server has it all. */
export interface Firestore {
  readonly __coworkDb: true;
}
const HANDLE: Firestore = Object.freeze({ __coworkDb: true as const });
export function getFirestore(_app?: unknown): Firestore {
  return HANDLE;
}
export function initializeFirestore(_app: unknown, _settings?: unknown): Firestore {
  return HANDLE;
}

/* ── Timestamp ────────────────────────────────────────────────────────────── */

export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
    Object.freeze(this);
  }
  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime());
  }
  static fromMillis(ms: number): Timestamp {
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, (ms - seconds * 1000) * 1e6);
  }
  toDate(): Date {
    return new Date(this.toMillis());
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  isEqual(other: Timestamp): boolean {
    return (
      other instanceof Timestamp &&
      other.seconds === this.seconds &&
      other.nanoseconds === this.nanoseconds
    );
  }
  valueOf(): number {
    return this.toMillis();
  }
  toJSON(): { seconds: number; nanoseconds: number } {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
}

/** `{_seconds,_nanoseconds}` → Timestamp, deep. */
export function reviveValue(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Timestamp || v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(reviveValue);
  const o = v as Record<string, unknown>;
  if (typeof o._seconds === "number" && typeof o._nanoseconds === "number")
    return new Timestamp(o._seconds, o._nanoseconds);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = reviveValue(x);
  return out;
}

/** Outgoing: Timestamp/Date → `{__ts}`, sentinels pass through, deep. */
export function encodeValue(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Timestamp)
    return { __ts: { seconds: v.seconds, nanoseconds: v.nanoseconds } };
  if (v instanceof Date) {
    const t = Timestamp.fromDate(v);
    return { __ts: { seconds: t.seconds, nanoseconds: t.nanoseconds } };
  }
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : encodeValue(x)));
  const o = v as Record<string, unknown>;
  if (typeof o.__fv === "string") return o;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    const e = encodeValue(x);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

/* ── Field values ─────────────────────────────────────────────────────────── */

export const serverTimestamp = (): any => ({ __fv: "serverTimestamp" });
export const deleteField = (): any => ({ __fv: "delete" });
export const increment = (by: number): any => ({ __fv: "increment", by });
export const arrayUnion = (...values: unknown[]): any => ({ __fv: "arrayUnion", values });
export const arrayRemove = (...values: unknown[]): any => ({ __fv: "arrayRemove", values });
export const FieldValue = { serverTimestamp, delete: deleteField, increment, arrayUnion, arrayRemove };

/** `documentId()` — "the document id", spelled as the client SDK spells it. */
const NAME_FIELD = "__name__";
export function documentId(): string {
  return NAME_FIELD;
}

/* ── References ───────────────────────────────────────────────────────────── */

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function autoId(): string {
  let out = "";
  for (let i = 0; i < 20; i += 1)
    out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return out;
}

export class CollectionReference<T = DocumentData> {
  readonly type = "collection" as const;
  readonly segments: readonly string[];
  constructor(segments: readonly string[]) {
    this.segments = segments;
  }
  /** A string, as the SDK's is — call sites pass it back into `collection()`. */
  get path(): string {
    return this.segments.join("/");
  }
  get id(): string {
    return this.segments[this.segments.length - 1];
  }
  get parent(): DocumentReference<DocumentData> | null {
    return this.segments.length > 1 ? new DocumentReference(this.segments.slice(0, -1)) : null;
  }
  /** The collection the server files this under: `cowork_tasks__chat`. */
  get flatName(): string {
    return this.segments.filter((_, i) => i % 2 === 0).join("__");
  }
  withConverter(): CollectionReference<T> {
    return this;
  }
}

export class DocumentReference<T = DocumentData> {
  readonly type = "document" as const;
  readonly segments: readonly string[];
  constructor(segments: readonly string[]) {
    this.segments = segments;
  }
  get path(): string {
    return this.segments.join("/");
  }
  get id(): string {
    return this.segments[this.segments.length - 1];
  }
  get parent(): CollectionReference<T> {
    return new CollectionReference<T>(this.segments.slice(0, -1));
  }
  withConverter(): DocumentReference<T> {
    return this;
  }
}

function isRef(x: unknown): x is CollectionReference | DocumentReference {
  return x instanceof CollectionReference || x instanceof DocumentReference;
}
const split = (segments: string[]) => segments.flatMap((s) => String(s).split("/").filter(Boolean));

/** `collection(db, "a", "b", "c")`, `collection(db, "a/b/c")`, `collection(docRef, "c")`. */
export function collection<T = DocumentData>(
  parent: Firestore | DocumentReference<any> | CollectionReference<any>,
  ...segments: string[]
): CollectionReference<T> {
  const base = isRef(parent) ? parent.segments : [];
  const path = [...base, ...split(segments)];
  if (path.length % 2 !== 1) throw new Error(`Invalid collection path: ${path.join("/")}`);
  return new CollectionReference<T>(path);
}

/** `doc(db, "a", "id")`, `doc(colRef)` (auto id), `doc(colRef, "id")`. */
export function doc<T = DocumentData>(
  parent: Firestore | DocumentReference<any> | CollectionReference<any>,
  ...segments: string[]
): DocumentReference<T> {
  const base = isRef(parent) ? parent.segments : [];
  const extra = split(segments);
  let path = [...base, ...extra];
  if (parent instanceof CollectionReference && extra.length === 0) path = [...base, autoId()];
  if (path.length % 2 !== 0) throw new Error(`Invalid document path: ${path.join("/")}`);
  return new DocumentReference<T>(path);
}

export function collectionGroup(_db: Firestore, _id: string): never {
  throw new Error(
    "collectionGroup() is not supported: subcollections are stored flat; query the parent instead.",
  );
}

/* ── Queries ──────────────────────────────────────────────────────────────── */

export type QueryConstraint =
  | { readonly kind: "select"; readonly fields: readonly string[] }
  | { readonly kind: "where"; readonly field: string; readonly op: WhereFilterOp; readonly value: unknown }
  | { readonly kind: "orderBy"; readonly field: string; readonly dir: OrderByDirection }
  | { readonly kind: "limit"; readonly n: number }
  | { readonly kind: "startAt"; readonly value: unknown }
  | { readonly kind: "startAfter"; readonly value: unknown };

export class Query<T = DocumentData> {
  readonly type = "query" as const;
  readonly ref: CollectionReference<T>;
  readonly constraints: readonly QueryConstraint[];
  constructor(ref: CollectionReference<T>, constraints: readonly QueryConstraint[] = []) {
    this.ref = ref;
    this.constraints = constraints;
  }
  get path(): string {
    return this.ref.path;
  }
  withConverter(): Query<T> {
    return this;
  }
}

/** A snapshot as a cursor means "its id" when ordering by documentId. */
const cursorValue = (v: unknown) => (v instanceof DocumentSnapshot ? v.id : v);

export const where = (field: string, op: WhereFilterOp, value: unknown): QueryConstraint => ({
  kind: "where",
  field,
  op,
  value,
});
export const orderBy = (field: string, dir: OrderByDirection = "asc"): QueryConstraint => ({
  kind: "orderBy",
  field,
  dir,
});
export const limit = (n: number): QueryConstraint => ({ kind: "limit", n });

/**
 * Ask for only these fields. NOT part of the Firestore client SDK.
 *
 * A deliberate addition, for one reason. Counting unread messages means
 * reading every message somebody else sent and checking `readBy` -- and the
 * conversation list does that for every conversation, every time a message
 * arrives. Whole message documents carry text, attachments and names that
 * the count never looks at: about 79% of a payload that runs to a megabyte
 * on a busy account.
 *
 * Firestore had no equivalent on the client, which is why the code being
 * preserved here never asked for one. It changes nothing about which rows
 * come back, in what order, or who may see them -- the server still reads
 * each whole document and still applies the access rule to it, and only
 * then drops the fields that were not asked for.
 */
export const select = (...fields: string[]): QueryConstraint => ({ kind: "select", fields });
export const startAt = (value: unknown): QueryConstraint => ({ kind: "startAt", value: cursorValue(value) });
export const startAfter = (value: unknown): QueryConstraint => ({
  kind: "startAfter",
  value: cursorValue(value),
});

export function query<T = DocumentData>(
  base: CollectionReference<T> | Query<T>,
  ...constraints: QueryConstraint[]
): Query<T> {
  const ref = base instanceof Query ? base.ref : base;
  const prior = base instanceof Query ? base.constraints : [];
  return new Query<T>(ref, [...prior, ...constraints]);
}

function asQuery<T>(q: Query<T> | CollectionReference<T>): Query<T> {
  return q instanceof Query ? q : new Query<T>(q);
}

function queryBody(src: Query<any>): Op {
  const body: Op = { op: "query", path: [...src.ref.segments] };
  const w: unknown[] = [];
  const o: unknown[] = [];
  for (const c of src.constraints) {
    if (c.kind === "where") w.push({ field: c.field, op: c.op, value: encodeValue(c.value) });
    else if (c.kind === "orderBy") o.push({ field: c.field, dir: c.dir });
    else if (c.kind === "limit") body.limit = c.n;
    else if (c.kind === "startAt") body.startAt = encodeValue(c.value);
    else if (c.kind === "startAfter") body.startAfter = encodeValue(c.value);
    else if (c.kind === "select") body.select = [...c.fields];
  }
  if (w.length) body.where = w;
  if (o.length) body.orderBy = o;
  return body;
}

/* ── Snapshots ────────────────────────────────────────────────────────────── */

interface WireDoc {
  id: string;
  exists: boolean;
  data: Record<string, unknown> | null;
}

export class DocumentSnapshot<T = DocumentData> {
  readonly ref: DocumentReference<T>;
  readonly metadata: SnapshotMetadata = METADATA;
  private readonly _data: T | undefined;
  constructor(ref: DocumentReference<T>, wire: WireDoc) {
    this.ref = ref;
    this._data = wire.exists ? (reviveValue(wire.data ?? {}) as T) : undefined;
  }
  get id(): string {
    return this.ref.id;
  }
  /** A METHOD, as in the client SDK. 65 call sites here call it as one. */
  exists(): boolean {
    return this._data !== undefined;
  }
  data(): T | undefined {
    return this._data;
  }
  get(field: string): any {
    return field
      .split(".")
      .reduce<any>((v, k) => (v == null ? undefined : v[k]), this._data as any);
  }
}

export class QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
  override data(): T {
    return super.data() ?? ({} as T);
  }
}

export interface DocumentChange<T = DocumentData> {
  readonly type: "added" | "modified" | "removed";
  readonly doc: QueryDocumentSnapshot<T>;
  readonly oldIndex: number;
  readonly newIndex: number;
}

export class QuerySnapshot<T = DocumentData> {
  readonly query: Query<T>;
  readonly docs: QueryDocumentSnapshot<T>[];
  readonly metadata: SnapshotMetadata = METADATA;
  constructor(q: Query<T>, docs: QueryDocumentSnapshot<T>[]) {
    this.query = q;
    this.docs = docs;
  }
  get empty(): boolean {
    return this.docs.length === 0;
  }
  get size(): number {
    return this.docs.length;
  }
  forEach(fn: (d: QueryDocumentSnapshot<T>) => void): void {
    this.docs.forEach(fn);
  }
  /** Every row reads as "added": there is no diff, only the current truth. */
  docChanges(): DocumentChange<T>[] {
    return this.docs.map((d, i) => ({ type: "added" as const, doc: d, oldIndex: -1, newIndex: i }));
  }
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

export async function getDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  const r = await transport({ op: "get", path: [...ref.segments] });
  return new DocumentSnapshot<T>(ref, r.doc as WireDoc);
}

export async function getDocs<T = DocumentData>(
  q: Query<T> | CollectionReference<T>,
): Promise<QuerySnapshot<T>> {
  const src = asQuery(q);
  const r = await transport(queryBody(src));
  const docs = ((r.docs as WireDoc[]) ?? []).map(
    (w) => new QueryDocumentSnapshot<T>(new DocumentReference<T>([...src.ref.segments, w.id]), w),
  );
  return new QuerySnapshot<T>(src, docs);
}

export async function getCountFromServer(
  q: Query<any> | CollectionReference<any>,
): Promise<{ data: () => { count: number } }> {
  const snap = await getDocs(q);
  return { data: () => ({ count: snap.size }) };
}

/* ── Writes ───────────────────────────────────────────────────────────────── */

export async function setDoc<T>(ref: DocumentReference<T>, data: any, options?: SetOptions): Promise<void> {
  await transport({
    op: "set",
    path: [...ref.segments],
    data: encodeValue(data),
    merge: options?.merge === true,
  });
}

export async function updateDoc<T>(ref: DocumentReference<T>, data: any): Promise<void> {
  await transport({ op: "update", path: [...ref.segments], data: encodeValue(data) });
}

export async function addDoc<T>(col: CollectionReference<T>, data: any): Promise<DocumentReference<T>> {
  const r = await transport({ op: "add", path: [...col.segments], data: encodeValue(data) });
  return new DocumentReference<T>([...col.segments, String(r.id)]);
}

export async function deleteDoc<T>(ref: DocumentReference<T>): Promise<void> {
  await transport({ op: "delete", path: [...ref.segments] });
}

/* ── Batches and transactions ─────────────────────────────────────────────── */

type BatchWrite = {
  kind: "set" | "update" | "delete";
  path: string[];
  data?: unknown;
  merge?: boolean;
};

export class WriteBatch {
  private readonly ops: BatchWrite[] = [];
  set<T>(ref: DocumentReference<T>, data: any, options?: SetOptions): this {
    this.ops.push({
      kind: "set",
      path: [...ref.segments],
      data: encodeValue(data),
      merge: options?.merge === true,
    });
    return this;
  }
  update<T>(ref: DocumentReference<T>, data: any): this {
    this.ops.push({ kind: "update", path: [...ref.segments], data: encodeValue(data) });
    return this;
  }
  delete<T>(ref: DocumentReference<T>): this {
    this.ops.push({ kind: "delete", path: [...ref.segments] });
    return this;
  }
  async commit(): Promise<void> {
    if (this.ops.length === 0) return;
    await transport({ op: "batch", ops: this.ops });
  }
}

export function writeBatch(_db: Firestore): WriteBatch {
  return new WriteBatch();
}

export class Transaction {
  readonly batch = new WriteBatch();
  get<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
    return getDoc(ref);
  }
  set<T>(ref: DocumentReference<T>, data: any, options?: SetOptions): this {
    this.batch.set(ref, data, options);
    return this;
  }
  update<T>(ref: DocumentReference<T>, data: any): this {
    this.batch.update(ref, data);
    return this;
  }
  delete<T>(ref: DocumentReference<T>): this {
    this.batch.delete(ref);
    return this;
  }
}

/**
 * A transaction, as the client SDK offers one: reads now, writes at commit.
 *
 * The writes go as one server batch, so they land together or not at all. What
 * this does NOT give is a re-run on a conflicting concurrent write, which the
 * client SDK does by retrying the callback. The one caller in this frontend
 * (`legacy/index.ts`) reads a counter and writes it back; under contention it
 * can lose a race that Firestore would have retried. The engine's own counters
 * live on the server, in a real transaction, and that is where anything that
 * cannot tolerate a lost race belongs.
 */
export async function runTransaction<T>(
  _db: Firestore,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = new Transaction();
  const value = await fn(tx);
  await tx.batch.commit();
  return value;
}

/* ── Live reads ───────────────────────────────────────────────────────────── */

/** How long notices are gathered before one refetch — matches the change feed. */
export const SNAPSHOT_COALESCE_MS = 60;

/**
 * Does a server notice concern what this reference watches?
 *
 * A notice names the physical collection: `cowork_tasks` or the flattened
 * `cowork_tasks__chat`. A watch on `cowork_tasks/T1/chat` cares about the
 * latter; a watch on `cowork_tasks` cares about the former. A watch on a parent
 * also refetches on a subcollection change (a new chat message bumps the task's
 * preview), which costs a read and never misses an update.
 */
export function noticeConcerns(watchedFlatName: string, noticeCollection: string): boolean {
  return (
    noticeCollection === watchedFlatName || noticeCollection.startsWith(`${watchedFlatName}__`)
  );
}

type ErrorFn = (error: Error) => void;

/**
 * The most documents a listener will patch in one go before it gives up and
 * re-reads the collection instead.
 */
export const PATCH_LIMIT = 50;
export function onSnapshot<T = DocumentData>(
  ref: DocumentReference<T>,
  next: (snapshot: DocumentSnapshot<T>) => void,
  error?: ErrorFn,
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  ref: DocumentReference<T>,
  options: SnapshotListenOptions,
  next: (snapshot: DocumentSnapshot<T>) => void,
  error?: ErrorFn,
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  q: Query<T> | CollectionReference<T>,
  next: (snapshot: QuerySnapshot<T>) => void,
  error?: ErrorFn,
): Unsubscribe;
export function onSnapshot<T = DocumentData>(
  q: Query<T> | CollectionReference<T>,
  options: SnapshotListenOptions,
  next: (snapshot: QuerySnapshot<T>) => void,
  error?: ErrorFn,
): Unsubscribe;

export function onSnapshot(target: any, a: any, b?: any, c?: any): Unsubscribe {
  /* The options overload: `onSnapshot(ref, {includeMetadataChanges}, next, err)`. */
  const hasOptions = typeof a === "object" && a !== null;
  const next: (snap: any) => void = hasOptions ? b : a;
  const onError: ErrorFn =
    (hasOptions ? c : b) ?? ((e: Error) => console.error("[onSnapshot]", e));

  const flat: string =
    target instanceof DocumentReference
      ? target.parent.flatName
      : (target instanceof Query ? target.ref : (target as CollectionReference)).flatName;

  /**
   * Whether a change to ONE document can be applied without reading the rest.
   *
   * A Firestore listener was a live cursor: after the first snapshot Google
   * sent only the documents that changed. Re-running the whole query in its
   * place is correct and, on the collections that matter, ruinous -- an open
   * conversation re-read all 444 of its messages, 212 KB, every time either
   * side sent one, and the thread list re-read every thread behind it.
   *
   * The notice already names the document that changed, so the held result can
   * be patched with that one document instead.
   *
   * Only for a watch with NO constraints, which is what a chat thread is:
   * `collection(db, coll, conversationId, "messages")`. The moment a `where`,
   * `orderBy` or `limit` is involved, whether a changed document still belongs
   * in the result -- and where -- is the server's answer to give, not this
   * cache's to guess, so those keep re-reading in full.
   */
  const source = target instanceof DocumentReference ? null : asQuery(target);
  const patchable = source !== null && source.constraints.length === 0;
  let current: QueryDocumentSnapshot<any>[] | null = null;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let again = false;
  /* Ids waiting to be patched in. `null` means something asked for a full
     read, which supersedes every pending patch. */
  let touched: Set<string> | null = new Set();

  const fetchAll = async () => {
    const snap =
      target instanceof DocumentReference ? await getDoc(target) : await getDocs(target);
    if (snap instanceof QuerySnapshot) current = [...snap.docs];
    return snap;
  };

  /**
   * Read just the named documents and fold them into what is already held.
   *
   * A document that comes back missing is removed -- it was deleted, or the
   * notice was for the same collection under a DIFFERENT parent, which reads
   * as absent through a parent-scoped reference. If nothing in the set
   * actually moved, no snapshot is emitted at all: a message in somebody
   * else's conversation must not re-render this one.
   */
  const fetchSome = async (ids: string[]): Promise<QuerySnapshot<any> | null> => {
    if (!source || !current) return null;
    const wires = await Promise.all(
      ids.map(async (id) => ({
        id,
        wire: (await transport({ op: "get", path: [...source.ref.segments, id] })).doc as
          | WireDoc
          | undefined,
      })),
    );
    const held = [...current];
    let moved = false;
    for (const { id, wire } of wires) {
      const at = held.findIndex((d) => d.id === id);
      if (!wire || !wire.exists) {
        if (at >= 0) {
          held.splice(at, 1);
          moved = true;
        }
        continue;
      }
      const doc = new QueryDocumentSnapshot<any>(
        new DocumentReference<any>([...source.ref.segments, id]),
        wire,
      );
      if (at >= 0) held[at] = doc;
      else held.push(doc);
      moved = true;
    }
    if (!moved) return null;
    current = held;
    return new QuerySnapshot<any>(source, held);
  };

  const fetch = async () => {
    if (stopped) return;
    if (inflight) {
      again = true;
      return;
    }
    const wanted = touched;
    touched = new Set();
    inflight = (async () => {
      try {
        /* Past a point, reading the changed documents one by one stops being
           cheaper than reading the collection. Marking a long thread read
           writes a receipt per message, and several hundred of those should
           cost one query, not several hundred reads. */
        const incremental =
          patchable &&
          current !== null &&
          wanted !== null &&
          wanted.size > 0 &&
          wanted.size <= PATCH_LIMIT;
        const snap = incremental
          ? await fetchSome([...(wanted as Set<string>)])
          : await fetchAll();
        if (!stopped && snap) next(snap);
      } catch (e) {
        if (!stopped) onError(e as Error);
      }
    })().finally(() => {
      inflight = null;
      if (again && !stopped) {
        again = false;
        void fetch();
      }
    });
    await inflight;
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void fetch();
    }, SNAPSHOT_COALESCE_MS);
  };

  /** Ask for a full read next time, whatever was pending. */
  const scheduleAll = () => {
    touched = null;
    schedule();
  };

  const unsubscribe = subscribeToChanges((n) => {
    if ("resync" in n) return scheduleAll();
    if (!noticeConcerns(flat, n.collection)) return;
    /* Exactly this collection, with a document named, and nothing pending that
       already demands a full read. A notice from a SUBcollection of what is
       watched names a document of the child, which this set cannot place. */
    if (patchable && n.collection === flat && n.id && touched !== null) {
      touched.add(String(n.id));
      return schedule();
    }
    scheduleAll();
  });

  void fetch();

  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}

/* ── Things the old SDK exported that nothing here needs ──────────────────── */

export function enableIndexedDbPersistence(): Promise<void> {
  return Promise.resolve();
}
