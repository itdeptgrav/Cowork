/* Deliberately NOT marked `server-only`, for the same reason `password.ts` is
   not: it has a unit test, and the runner is plain `node --test`, which resolves
   the `server-only` marker to its throwing entry. The protection is real without
   the marker — only server routes import this, and its `node:fs` import fails a
   client bundle outright — so nothing reaches a browser. */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SerializedWorkbook } from "@/lib/spreadsheet/persistence";

/**
 * The workbook store — where persisted spreadsheets live.
 *
 * **This is the seam**, exactly as `lib/server/store.ts` is for identity: the
 * layers above (the API routes, the client repository) are production shape;
 * below is one swappable adapter. The spreadsheet engine never reaches here — it
 * speaks the serialized shape (`lib/spreadsheet/persistence.ts`), a route turns
 * that into a `WorkbookStore` call, and only the adapter knows where the bytes
 * go. Moving to MongoDB means implementing `WorkbookStore` and changing the line
 * at the bottom of this file; nothing above changes.
 *
 * The record separates METADATA (id, owner, title, revision, timestamps) from
 * CONTENT (the serialized workbook), which is the split a document database
 * wants: metadata is a small, queryable document; the content — sheets and their
 * sparse cells — is what a Mongo adapter would store as its own documents,
 * chunked by sheet and row band to stay under the 16 MB per-document limit. The
 * file adapter writes them together; the shape is ready either way.
 *
 * `revision` is the optimistic-concurrency token: a save carries the revision it
 * read, and the store refuses it (`WorkbookConflict`) if the stored revision has
 * moved on. That is enough to handle two tabs editing the same workbook safely,
 * and it is the hook a real-time layer would later build on — without it being
 * built now.
 */

/**
 * What someone may do with a workbook that is not theirs.
 *
 * Ordered deliberately: every check in the app is "at least this much", so the
 * rank below is the single place that ordering is written down. The owner is
 * not a role — ownership is separate, and always outranks every grant.
 */
export type ShareRole = "viewer" | "commenter" | "editor";

const ROLE_RANK: Record<ShareRole, number> = { viewer: 1, commenter: 2, editor: 3 };

/** Whether `role` is at least as permissive as `needed`. */
export function roleAllows(role: ShareRole, needed: ShareRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}

/** One grant: a named person, and what they may do. */
export interface ShareGrant {
  /** The principal id the grant is for — same id space as `ownerId`. */
  principalId: string;
  role: ShareRole;
}

/** The metadata a listing shows — never the whole workbook. */
export interface WorkbookSummary {
  id: string;
  ownerId: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Who this workbook is shared with. Absent/empty means private to its owner. */
  shares?: ShareGrant[];
  /** For a listing: how the CALLER reaches this workbook. Not stored — filled in
      per request, so one person's listing never leaks another's standing. */
  access?: "owner" | ShareRole;
}

/** A stored workbook: its metadata plus its serialized content. */
export interface WorkbookRecord extends WorkbookSummary {
  data: SerializedWorkbook;
}

/** Thrown by `save` when the base revision is stale — a concurrent write won. */
export class WorkbookConflict extends Error {
  currentRevision: number;
  constructor(currentRevision: number) {
    super("The workbook was changed by another save.");
    this.name = "WorkbookConflict";
    this.currentRevision = currentRevision;
  }
}

export interface WorkbookStore {
  create(input: { ownerId: string; title: string; data: SerializedWorkbook }): Promise<WorkbookRecord>;
  load(id: string): Promise<WorkbookRecord | null>;
  /** Save new content. Returns the bumped record, null if the workbook is gone,
      or throws `WorkbookConflict` if `baseRevision` is stale. */
  save(input: {
    id: string;
    data: SerializedWorkbook;
    baseRevision: number;
  }): Promise<WorkbookRecord | null>;
  rename(id: string, title: string): Promise<WorkbookRecord | null>;
  remove(id: string): Promise<boolean>;
  /** Everything a principal can reach — owned AND shared with them — each
      summary stamped with how they reach it. */
  listForPrincipal(principalId: string): Promise<WorkbookSummary[]>;
  /** Replace a workbook's share list. Owner-only; the route enforces that. */
  setShares(id: string, shares: ShareGrant[]): Promise<WorkbookRecord | null>;
}

function summaryOf(r: WorkbookRecord): WorkbookSummary {
  return {
    id: r.id,
    ownerId: r.ownerId,
    title: r.title,
    revision: r.revision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    /* Carried so a listing row can show who it is shared with without a
       round trip per row. The route strips it for anyone but the owner. */
    ...(r.shares?.length ? { shares: r.shares } : {}),
  };
}

/* ── The file-backed adapter ──────────────────────────────────────────────── */

interface Snapshot {
  version: 1;
  workbooks: WorkbookRecord[];
}

const EMPTY: Snapshot = { version: 1, workbooks: [] };

const DATA_PATH =
  process.env.COWORK_WORKBOOK_PATH ?? join(process.cwd(), ".data", "workbooks.json");

function cryptoId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Writes JSON to disk, serialising every mutation through one promise chain —
 * the same arrangement `FileIdentityStore` uses, and for the same reason: two
 * saves landing together must not lose an update. Correct for a single node;
 * the interface is where a real database goes when there is more than one.
 */
export class FileWorkbookStore implements WorkbookStore {
  #chain: Promise<unknown> = Promise.resolve();
  #cache: Snapshot | null = null;
  #cachedMtime = -1;
  /** Where the JSON lives — the default in production, overridable for tests. */
  private readonly dataPath: string;
  constructor(dataPath: string = DATA_PATH) {
    this.dataPath = dataPath;
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    this.#chain = next.catch(() => undefined);
    return next;
  }

  async #read(): Promise<Snapshot> {
    let mtime = 0;
    try {
      mtime = (await stat(this.dataPath)).mtimeMs;
    } catch {
      /* No file yet — an empty store, not an error. */
    }
    if (this.#cache && mtime === this.#cachedMtime) return this.#cache;
    this.#cachedMtime = mtime;
    try {
      const parsed = JSON.parse(await readFile(this.dataPath, "utf8")) as Snapshot;
      this.#cache = parsed && parsed.version === 1 ? { ...EMPTY, ...parsed } : structuredClone(EMPTY);
    } catch {
      this.#cache = structuredClone(EMPTY);
    }
    return this.#cache;
  }

  async #write(next: Snapshot): Promise<void> {
    this.#cache = next;
    await mkdir(dirname(this.dataPath), { recursive: true });
    const tmp = `${this.dataPath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next), "utf8");
    await rename(tmp, this.dataPath);
    try {
      this.#cachedMtime = (await stat(this.dataPath)).mtimeMs;
    } catch {
      this.#cachedMtime = -1;
    }
  }

  async create(input: {
    ownerId: string;
    title: string;
    data: SerializedWorkbook;
  }): Promise<WorkbookRecord> {
    return this.#serial(async () => {
      const s = await this.#read();
      const now = new Date().toISOString();
      const record: WorkbookRecord = {
        id: `wb-${cryptoId()}`,
        ownerId: input.ownerId,
        title: input.title.trim() || "Untitled workbook",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        data: input.data,
      };
      await this.#write({ ...s, workbooks: [...s.workbooks, record] });
      return record;
    });
  }

  async load(id: string): Promise<WorkbookRecord | null> {
    const s = await this.#read();
    return s.workbooks.find((w) => w.id === id) ?? null;
  }

  async save(input: {
    id: string;
    data: SerializedWorkbook;
    baseRevision: number;
  }): Promise<WorkbookRecord | null> {
    return this.#serial(async () => {
      const s = await this.#read();
      const existing = s.workbooks.find((w) => w.id === input.id);
      if (!existing) return null;
      /* The concurrency gate: a save built on a stale read is refused rather than
         silently overwriting the newer one. */
      if (existing.revision !== input.baseRevision) {
        throw new WorkbookConflict(existing.revision);
      }
      const updated: WorkbookRecord = {
        ...existing,
        data: input.data,
        revision: existing.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.#write({
        ...s,
        workbooks: s.workbooks.map((w) => (w.id === updated.id ? updated : w)),
      });
      return updated;
    });
  }

  async rename(id: string, title: string): Promise<WorkbookRecord | null> {
    return this.#serial(async () => {
      const s = await this.#read();
      const existing = s.workbooks.find((w) => w.id === id);
      if (!existing) return null;
      const updated: WorkbookRecord = {
        ...existing,
        title: title.trim() || existing.title,
        updatedAt: new Date().toISOString(),
      };
      await this.#write({
        ...s,
        workbooks: s.workbooks.map((w) => (w.id === id ? updated : w)),
      });
      return updated;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.#serial(async () => {
      const s = await this.#read();
      if (!s.workbooks.some((w) => w.id === id)) return false;
      await this.#write({ ...s, workbooks: s.workbooks.filter((w) => w.id !== id) });
      return true;
    });
  }

  async listForPrincipal(principalId: string): Promise<WorkbookSummary[]> {
    const s = await this.#read();
    const out: WorkbookSummary[] = [];
    for (const w of s.workbooks) {
      /* Stamp each summary with THIS caller's standing, so the same record
         listed by two people describes each one's own access. */
      const access =
        w.ownerId === principalId
          ? ("owner" as const)
          : w.shares?.find((g) => g.principalId === principalId)?.role;
      if (!access) continue;
      const summary = summaryOf(w);
      /* Only the owner learns who else it is shared with. */
      if (access !== "owner") delete summary.shares;
      out.push({ ...summary, access });
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async setShares(id: string, shares: ShareGrant[]): Promise<WorkbookRecord | null> {
    return this.#serial(async () => {
      const s = await this.#read();
      const existing = s.workbooks.find((w) => w.id === id);
      if (!existing) return null;
      /* One grant per principal, last wins, and the OWNER is never listed —
         ownership is not a grant, so editing shares must not be able to revoke
         it (or to quietly demote the owner to a viewer of their own workbook). */
      const byPrincipal = new Map<string, ShareGrant>();
      for (const g of shares) {
        if (!g?.principalId || g.principalId === existing.ownerId) continue;
        if (!ROLE_RANK[g.role]) continue; // unknown role — drop it, never default up
        byPrincipal.set(g.principalId, { principalId: g.principalId, role: g.role });
      }
      const next = [...byPrincipal.values()];
      const updated: WorkbookRecord = { ...existing, updatedAt: new Date().toISOString() };
      if (next.length) updated.shares = next;
      else delete updated.shares;
      await this.#write({
        ...s,
        workbooks: s.workbooks.map((w) => (w.id === id ? updated : w)),
      });
      return updated;
    });
  }
}

/** The one line to change when this moves to a real database. */
export const workbookStore: WorkbookStore = new FileWorkbookStore();
