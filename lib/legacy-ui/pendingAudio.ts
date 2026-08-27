"use client";

/**
 * Audio that has not reached the server yet, kept where a closed tab cannot
 * take it.
 *
 * ## What was being lost
 *
 * A chunk that fails to upload was pushed back onto `pendingChunksRef` — a
 * React ref, which is memory. It survived a failed retry and nothing else. Shut
 * the laptop, close the tab, reload, or let the tab crash, and that audio was
 * gone with no trace that it had ever existed.
 *
 * The `pagehide` handler looks like it covers this, but it cannot: it bundles
 * everything outstanding into one blob and hands it to `navigator.sendBeacon`,
 * which browsers cap at 64 KB for the whole payload. Thirty seconds of Opus is
 * comfortably past that, so the beacon returns false and the code discarded the
 * result. The one path meant to catch the emergency silently dropped exactly
 * the recordings that were big enough to matter.
 *
 * ## What this does instead
 *
 * Every chunk is written here BEFORE it is uploaded and deleted only once the
 * server has taken it, so the durable copy exists during the window where the
 * upload can fail. Anything still here on the next page load is re-sent. The
 * server keys chunks by index on disk, so re-sending one overwrites the same
 * file — replaying is safe however many times it happens.
 *
 * A recording also leaves a MARKER saying it still needs finalizing, cleared
 * when finalize succeeds. That covers the other half: `/audio/finalize` merges
 * the chunks and pushes them to Drive, and when it fails the backend does NOT
 * delete the chunk directory — the audio is sitting on the server, whole, and
 * one more call would rescue it. Nothing ever made that call.
 *
 * IndexedDB rather than localStorage because this holds Blobs, which
 * localStorage cannot store without a base64 round trip, and because the quota
 * is measured in megabytes rather than five of them.
 */

const DB_NAME = "cowork-audio";
const DB_VERSION = 1;
const CHUNKS = "chunks";
const SESSIONS = "sessions";

/**
 * How long unsent audio is kept before it is considered abandoned.
 *
 * A week: long enough to survive a weekend and a holiday Monday, short enough
 * that a browser profile does not accumulate recordings from meetings nobody
 * remembers. The backend's own chunk directories are the other copy.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingChunk {
  id?: number;
  meetId: string;
  employeeId: string;
  chunkIndex: number;
  mimeType: string;
  blob: Blob;
  guestSessionId?: string;
  at: number;
}

export interface PendingSession {
  key: string;
  meetId: string;
  employeeId: string;
  firstName: string;
  mimeType: string;
  isRejoin: boolean;
  speechIntervals: unknown[];
  /**
   * Every stretch the recording was paused for.
   *
   * Optional because records written before pause existed do not have it, and
   * a replay must not refuse to finalise audio that is sitting on the server
   * over a field it never had. Absent reads as "no pauses", which is exactly
   * what those recordings were.
   */
  pauseIntervals?: unknown[];
  guestSessionId?: string;
  at: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CHUNKS))
          db.createObjectStore(CHUNKS, { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains(SESSIONS))
          db.createObjectStore(SESSIONS, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      /* Another tab holding an old version open. Recording must not block on
         it — the in-memory retry still applies, we simply lose durability. */
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    void openDb().then((db) => {
      if (!db) return resolve(null);
      try {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        t.oncomplete = () => db.close();
      } catch {
        resolve(null);
      }
    });
  });
}

export function sessionMarkerKey(meetId: string, employeeId: string): string {
  return `${meetId}:${employeeId}`;
}

/** Keep a chunk. Returns its row id, or null if storage is unavailable. */
export async function putChunk(
  chunk: Omit<PendingChunk, "id" | "at">,
): Promise<number | null> {
  const row = await tx<IDBValidKey>(CHUNKS, "readwrite", (s) =>
    s.add({ ...chunk, at: Date.now() }),
  );
  return typeof row === "number" ? row : null;
}

/** Forget a chunk the server has taken. */
export async function deleteChunk(id: number | null): Promise<void> {
  if (id === null) return;
  await tx(CHUNKS, "readwrite", (s) => s.delete(id));
}

/**
 * Which stored rows are still worth sending, oldest first and in index order.
 *
 * Pure so the ordering rule can be tested: the server merges by chunk index,
 * so replaying out of order would produce a file whose halves are swapped.
 */
export function replayOrder(
  rows: readonly PendingChunk[],
  nowMs: number = Date.now(),
): { fresh: PendingChunk[]; stale: PendingChunk[] } {
  const fresh: PendingChunk[] = [];
  const stale: PendingChunk[] = [];
  for (const r of rows)
    (nowMs - (r.at ?? 0) <= MAX_AGE_MS ? fresh : stale).push(r);
  fresh.sort(
    (a, b) =>
      a.meetId.localeCompare(b.meetId) ||
      a.employeeId.localeCompare(b.employeeId) ||
      a.chunkIndex - b.chunkIndex,
  );
  return { fresh, stale };
}

/**
 * The recordings whose audio is all through, and may therefore be merged.
 *
 * Finalizing while a chunk is still outstanding merges what has arrived and
 * uploads THAT to Drive as the finished recording — the tail of the meeting
 * would be dropped and the file would look complete. So a session waits for
 * its own chunks and nobody else's.
 */
export function sessionsReadyToFinalize(
  sessions: readonly PendingSession[],
  outstanding: readonly PendingChunk[],
): PendingSession[] {
  return sessions.filter(
    (s) =>
      !outstanding.some(
        (c) => c.meetId === s.meetId && c.employeeId === s.employeeId,
      ),
  );
}

export async function allChunks(): Promise<PendingChunk[]> {
  const rows = (await tx<PendingChunk[]>(CHUNKS, "readonly", (s) =>
    s.getAll(),
  )) as PendingChunk[] | null;
  if (!rows) return [];
  const { fresh, stale } = replayOrder(rows);
  for (const row of stale) await deleteChunk(row.id ?? null);
  return fresh;
}

/** Mark a recording as still needing finalize. */
export async function putSession(
  session: Omit<PendingSession, "key" | "at">,
): Promise<void> {
  await tx(SESSIONS, "readwrite", (s) =>
    s.put({
      ...session,
      key: sessionMarkerKey(session.meetId, session.employeeId),
      at: Date.now(),
    }),
  );
}

export async function deleteSession(key: string): Promise<void> {
  await tx(SESSIONS, "readwrite", (s) => s.delete(key));
}

export async function allSessions(): Promise<PendingSession[]> {
  const rows = (await tx<PendingSession[]>(SESSIONS, "readonly", (s) =>
    s.getAll(),
  )) as PendingSession[] | null;
  if (!rows) return [];
  const fresh = rows.filter((r) => Date.now() - (r.at ?? 0) <= MAX_AGE_MS);
  for (const stale of rows.filter((r) => !fresh.includes(r)))
    await deleteSession(stale.key);
  return fresh;
}

/** How much audio is waiting, for the "N clips still to upload" line. */
export async function pendingCount(): Promise<number> {
  return (await allChunks()).length;
}
