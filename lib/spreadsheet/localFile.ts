/**
 * A sheet that lives in a file on this computer.
 *
 * ## What this buys, and why it is not just "download"
 *
 * Export writes a NEW file every time and forgets it. What people actually
 * want from a spreadsheet is the thing every desktop application does: open
 * `Q3 plan.xlsx`, work in it, and have that same file on disk be current
 * afterwards — no re-picking a folder, no `Q3 plan (3).xlsx` in Downloads.
 *
 * The File System Access API is what makes that possible in a browser. A
 * `FileSystemFileHandle` is a durable reference to one file the person chose;
 * with `readwrite` permission the page can write back to exactly that file, and
 * the handle is structured-cloneable, so it can be kept in IndexedDB and used
 * again tomorrow. Opening the sheet re-acquires the same file.
 *
 * ## Where it does not work, and what happens then
 *
 * **Chromium only** — Chrome and Edge on the desktop. Firefox and Safari have
 * no File System Access API and are not going to be talked into one by a
 * feature detect, so `supportsLocalFiles()` is false there and every caller
 * must have a path for that. Reading a dropped file still works everywhere
 * (that is plain `DataTransfer`); it is only the *write back to the same file*
 * that Chromium alone can do. The honest fallback is Export, which is what the
 * File menu already offers.
 *
 * A secure context is required. `localhost` counts as one, so development is
 * unaffected.
 *
 * ## Permission, and why it is asked for twice
 *
 * A handle carries permission for the session it was granted in. Come back
 * tomorrow and the handle is still in IndexedDB but its permission has lapsed,
 * and `requestPermission` **must** be called from a user gesture — a browser
 * will refuse a prompt raised by a timer or an effect. So nothing here asks on
 * page load; `ensurePermission` is called from a click, and a caller that finds
 * it false is expected to say so rather than to retry.
 */

/* ── The shapes this needs ──────────────────────────────────────────────────
 *
 * Declared here rather than relying on `lib.dom`, whose coverage of this API
 * varies by TypeScript version — `showOpenFilePicker` in particular is absent
 * from several. These are the members actually used and nothing more, so the
 * declarations cannot drift into claiming support for something untested.
 */

export interface LocalWritable {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

export interface LocalFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(opts?: { keepExistingData?: boolean }): Promise<LocalWritable>;
  queryPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  isSameEntry?(other: LocalFileHandle): Promise<boolean>;
}

interface PickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface PickerWindow {
  showOpenFilePicker?: (o?: {
    types?: PickerType[];
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    id?: string;
  }) => Promise<LocalFileHandle[]>;
  showSaveFilePicker?: (o?: {
    types?: PickerType[];
    suggestedName?: string;
    id?: string;
  }) => Promise<LocalFileHandle>;
}

/** The formats a sheet can be opened from, as the picker's filter. */
const OPEN_TYPES: PickerType[] = [
  {
    description: "Spreadsheets",
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx", ".xlsm"],
      "text/csv": [".csv", ".tsv"],
      "application/json": [".json"],
    },
  },
];

const SAVE_TYPES: PickerType[] = [
  {
    description: "Excel workbook",
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
  },
];

/**
 * `id` keeps the picker in the folder it was last used in FOR SHEETS, without
 * dragging every other picker in the product along with it. Chrome remembers a
 * directory per id.
 */
const PICKER_ID = "cowork-sheets";

function picker(): PickerWindow | null {
  if (typeof window === "undefined") return null;
  return window as unknown as PickerWindow;
}

/** Whether this browser can write back to a file the person chose. */
export function supportsLocalFiles(): boolean {
  const w = picker();
  return Boolean(w && w.showOpenFilePicker && w.showSaveFilePicker);
}

/**
 * Whether a DROPPED file can become a durable handle.
 *
 * Separate from `supportsLocalFiles` because it is a separate capability:
 * `getAsFileSystemHandle` is what turns a drop into something writable, and a
 * browser without it can still READ the drop. A caller that conflates the two
 * either refuses a drop it could have opened, or promises to save back to a
 * file it cannot reach.
 */
export function supportsDroppedHandles(): boolean {
  return (
    typeof DataTransferItem !== "undefined" &&
    "getAsFileSystemHandle" in DataTransferItem.prototype
  );
}

/** Open the system picker. Null when the person cancelled — not an error. */
export async function pickFileToOpen(): Promise<LocalFileHandle | null> {
  const w = picker();
  if (!w?.showOpenFilePicker) return null;
  try {
    const [handle] = await w.showOpenFilePicker({
      types: OPEN_TYPES,
      multiple: false,
      id: PICKER_ID,
    });
    return handle ?? null;
  } catch {
    /* `AbortError` is a cancel, and every other failure here is equally not
       something to show a red line for — the person simply has no file. */
    return null;
  }
}

/** Choose where to keep a sheet on disk. Null when cancelled. */
export async function pickFileToSave(
  suggestedName: string,
): Promise<LocalFileHandle | null> {
  const w = picker();
  if (!w?.showSaveFilePicker) return null;
  try {
    return await w.showSaveFilePicker({
      types: SAVE_TYPES,
      suggestedName,
      id: PICKER_ID,
    });
  } catch {
    return null;
  }
}

/**
 * The durable handle behind a dropped file, where the browser offers one.
 *
 * Null means "read it as a plain file" rather than "refuse it" — a drop that
 * cannot be bound is still a drop that can be opened.
 */
export async function handleFromDrop(
  item: DataTransferItem,
): Promise<LocalFileHandle | null> {
  const get = (item as unknown as {
    getAsFileSystemHandle?: () => Promise<LocalFileHandle | null>;
  }).getAsFileSystemHandle;
  if (typeof get !== "function") return null;
  try {
    const handle = await get.call(item);
    return handle && handle.kind === "file" ? handle : null;
  } catch {
    return null;
  }
}

/**
 * Make sure we may write to this file, asking if we must.
 *
 * **Call this from a click.** `requestPermission` raises a browser prompt, and
 * a prompt that was not caused by a gesture is refused outright — which reads
 * as "saving silently stopped working" rather than as a permission question.
 */
export async function ensurePermission(
  handle: LocalFileHandle,
  mode: "read" | "readwrite" = "readwrite",
): Promise<boolean> {
  try {
    if (typeof handle.queryPermission === "function") {
      if ((await handle.queryPermission({ mode })) === "granted") return true;
    }
    if (typeof handle.requestPermission === "function") {
      return (await handle.requestPermission({ mode })) === "granted";
    }
    /* No permission API at all: the handle either works or throws on write,
       and claiming a refusal we have not had would be worse than trying. */
    return true;
  } catch {
    return false;
  }
}

/** Whether we already hold write permission — asks nobody, prompts nothing. */
export async function hasWritePermission(
  handle: LocalFileHandle,
): Promise<boolean> {
  try {
    if (typeof handle.queryPermission !== "function") return true;
    return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
  } catch {
    return false;
  }
}

/**
 * Replace the file's contents.
 *
 * `createWritable` truncates by default, which is what a save wants: the new
 * workbook is the whole file, and `keepExistingData` would leave the tail of a
 * longer previous version behind — a corrupt xlsx that opens as a repair
 * prompt in Excel.
 *
 * Chrome writes through a temporary file and swaps on `close()`, so a failure
 * part-way leaves the original intact rather than truncated.
 */
export async function writeLocalFile(
  handle: LocalFileHandle,
  data: BufferSource | Blob | string,
): Promise<void> {
  const w = await handle.createWritable();
  try {
    await w.write(data);
  } finally {
    await w.close();
  }
}

/* ── Remembering which files a person has open ─────────────────────────────
 *
 * Handles go in IndexedDB because they are structured-cloneable and nothing
 * else is: a path string is useless (the browser will not reopen one) and
 * `localStorage` cannot hold an object like this at all.
 */

const DB_NAME = "cowork-sheets";
const DB_VERSION = 1;
const STORE = "localFiles";

export interface StoredLocalFile {
  /** Ours, not the file system's — a handle has no id of its own. */
  id: string;
  handle: LocalFileHandle;
  /** The file name as it was when bound, for a list that must render without
      touching the disk (reading `handle.getFile()` needs permission). */
  fileName: string;
  title: string;
  boundAt: string;
  lastWriteAt: string | null;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    /* A private window, or storage the user has blocked. The feature degrades
       to "this session only" rather than failing the sheet. */
    req.onerror = () => resolve(null);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `lf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Remember a file, or update what we already knew about it.
 *
 * De-duplicated on `isSameEntry` rather than on the name: two different
 * `budget.xlsx` files in two folders are two files, and one `budget.xlsx`
 * opened twice is one. Getting that backwards either merges two people's work
 * into one row or fills the list with the same file.
 */
export async function rememberLocalFile(
  handle: LocalFileHandle,
  title: string,
): Promise<StoredLocalFile | null> {
  const db = await openDb();
  if (!db) return null;
  const existing = await listLocalFiles();
  for (const row of existing) {
    if (typeof handle.isSameEntry !== "function") break;
    try {
      if (await handle.isSameEntry(row.handle)) {
        const updated = { ...row, handle, title, fileName: handle.name };
        await tx(db, "readwrite", (s) => s.put(updated));
        return updated;
      }
    } catch {
      /* A stale handle cannot be compared. Fall through and add a new row. */
    }
  }
  const row: StoredLocalFile = {
    id: newId(),
    handle,
    fileName: handle.name,
    title,
    boundAt: new Date().toISOString(),
    lastWriteAt: null,
  };
  await tx(db, "readwrite", (s) => s.put(row));
  return row;
}

export async function listLocalFiles(): Promise<StoredLocalFile[]> {
  const db = await openDb();
  if (!db) return [];
  const rows = await tx<StoredLocalFile[]>(db, "readonly", (s) => s.getAll());
  return (rows ?? []).sort((a, b) =>
    String(b.lastWriteAt ?? b.boundAt).localeCompare(
      String(a.lastWriteAt ?? a.boundAt),
    ),
  );
}

export async function getLocalFile(id: string): Promise<StoredLocalFile | null> {
  const db = await openDb();
  if (!db) return null;
  return (await tx<StoredLocalFile>(db, "readonly", (s) => s.get(id))) ?? null;
}

export async function touchLocalFile(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const row = await tx<StoredLocalFile>(db, "readonly", (s) => s.get(id));
  if (!row) return;
  await tx(db, "readwrite", (s) =>
    s.put({ ...row, lastWriteAt: new Date().toISOString() }),
  );
}

/** Forget the link. **The file itself is untouched** — this removes Cowork's
    reference to it, and is the only "delete" this feature has. */
export async function forgetLocalFile(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await tx(db, "readwrite", (s) => s.delete(id));
}
