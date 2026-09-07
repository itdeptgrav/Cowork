"use client";

/**
 * Keeping a sheet and a file on this computer in step.
 *
 * The cloud autosave and this one are deliberately the same shape — the same
 * `Autosaver`, the same debounce-and-dedupe, the same "a save that changed
 * nothing settles back to saved". They are not the same STORE, though, and
 * that is the point: a sheet may be bound to a file, kept in Cowork, or both,
 * and each target is written independently.
 *
 * **Both directions.** Edits here are written to the file; edits made to the
 * file by anything else — Excel, a script, another person's sync client — are
 * read back. There is no filesystem event in a browser, so the second half is a
 * ten-second poll of the file's timestamp.
 *
 * The two cannot both win, so the rule is: a change on disk with nothing
 * pending here is simply taken, and a change on disk with unsaved edits here
 * stops and asks. Never the reverse — silently overwriting either side is the
 * one outcome that loses work somebody cannot get back.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Autosaver } from "@/lib/spreadsheet/autosave";
import {
  ensurePermission,
  forgetLocalFile,
  hasWritePermission,
  pickFileToSave,
  rememberLocalFile,
  supportsLocalFiles,
  touchLocalFile,
  writeLocalFile,
  type LocalFileHandle,
} from "@/lib/spreadsheet/localFile";
import type { SpreadsheetController } from "./useSpreadsheet";

/**
 * · `none` — not bound to a file.
 * · `saving` / `saved` — the ordinary pair.
 * · `denied` — the handle is still here but permission lapsed. Recoverable,
 *   and ONLY by a click, so it is a state with an action rather than an error.
 * · `error` — the write failed for some other reason.
 */
export type LocalBindState = "none" | "saving" | "saved" | "denied" | "error";

export interface LocalFileBinding {
  /** Whether this browser can write back to a chosen file at all. */
  supported: boolean;
  state: LocalBindState;
  /**
   * The file changed on disk and this sheet has edits that would be lost.
   *
   * Only ever true when reloading would DESTROY something: a sheet with
   * nothing pending is reloaded on the spot instead, because asking somebody
   * to press a button to see a change they already know about is a step that
   * exists to be dismissed.
   */
  externalChange: boolean;
  /** Take what is on disk, discarding local edits. From a click. */
  reloadFromFile: () => Promise<void>;
  /** The file's name, for the chip. Null when nothing is bound. */
  fileName: string | null;
  lastSavedAt: string | null;
  errorMessage: string | null;
  /** Start keeping this file current. Used by the drop handler and the picker. */
  bind: (handle: LocalFileHandle, title: string) => Promise<boolean>;
  /** Choose where on disk to keep this sheet, then bind. **From a click.** */
  saveToComputer: (suggestedName: string) => Promise<boolean>;
  /** Ask for permission again after it lapsed. **From a click.** */
  reconnect: () => Promise<boolean>;
  /** Stop writing to the file. The file itself is left exactly as it is. */
  unbind: (opts?: { forget?: boolean }) => void;
  /** Write now, cancelling the debounce — before a version, or on the way out. */
  flush: () => Promise<void>;
}

/**
 * Longer than the cloud's 1s.
 *
 * A local save rebuilds the whole `.xlsx` — zipping every sheet — which is far
 * more work than serializing to JSON, and it lands on a disk somebody may be
 * syncing. Coalescing a little harder costs nothing anybody can perceive.
 */
const LOCAL_AUTOSAVE_MS = 1500;

/**
 * How often the bound file is checked for a change somebody else made.
 *
 * There is no filesystem watch in a browser — the File System Access API
 * offers no change event — so this is a poll, and a poll is a trade. Ten
 * seconds is what it costs to notice a save made in Excel about as fast as a
 * person would look up, against one `getFile()` per interval, which reads the
 * file's metadata rather than its contents and is far cheaper than it sounds.
 */
const WATCH_MS = 10_000;

/** The capability never changes, so there is nothing to subscribe to. Declared
    once at module scope so its identity is stable across renders. */
function subscribeToNothing(): () => void {
  return () => {};
}

export function useLocalFileBinding(
  controller: SpreadsheetController,
): LocalFileBinding {
  /**
   * Whether this browser can write back to a chosen file.
   *
   * `useSyncExternalStore` rather than an effect that sets state, because the
   * answer is a fact about the browser that never changes and the server has no
   * browser to ask. The third argument is the server's answer — false — so the
   * markup React renders on both sides matches, and the real capability lands
   * without a second render pass or a hydration mismatch.
   */
  const supported = useSyncExternalStore(
    subscribeToNothing,
    supportsLocalFiles,
    () => false,
  );
  const [state, setState] = useState<LocalBindState>("none");
  const [fileName, setFileName] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [externalChange, setExternalChange] = useState(false);
  const handleRef = useRef<LocalFileHandle | null>(null);
  const rowIdRef = useRef<string | null>(null);
  /**
   * The file's `lastModified` as of the last write or read WE did.
   *
   * The whole external-change check is "is it different from this". Updating it
   * after our own writes is what stops the watch seeing its own tail: without
   * it, every autosave would look like somebody else's edit and the sheet would
   * reload itself in a loop.
   */
  const seenModifiedRef = useRef<number | null>(null);
  /** Edits made here that the file has not received yet. Reloading over these
      would throw away work, which is the only reason the reload is ever a
      question rather than something that just happens. */
  const dirtyRef = useRef(false);
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  });

  /* Built in the mount effect rather than during render — the same pattern
     `useWorkbookPersistence` uses, and for the same reason: a ref written
     during render is a side effect in a phase React may run twice. */
  const autoRef = useRef<Autosaver<unknown> | null>(null);
  useEffect(() => {
    autoRef.current = new Autosaver<unknown>({
      delayMs: LOCAL_AUTOSAVE_MS,
      /**
       * The payload pushed in is the SERIALIZED workbook, which is what the
       * autosaver de-duplicates on — cheap to produce and stable to compare.
       * The `.xlsx` is only built here, when a write is actually happening, so
       * a burst of twenty keystrokes zips the workbook once rather than twenty
       * times.
       */
      save: async () => {
        const handle = handleRef.current;
        if (!handle) return;
        if (!(await hasWritePermission(handle))) {
          /* Not an error: the file is still there and one click restores it. */
          setState("denied");
          return;
        }
        const bytes = await controllerRef.current.exportXlsx();
        await writeLocalFile(handle, bytes);
        /* Our own write moved the file's timestamp. Record it, or the watch
           below reads it back as an edit from outside. */
        try {
          seenModifiedRef.current = (await handle.getFile()).lastModified;
        } catch {
          /* Not worth failing a successful save over; the next poll re-reads. */
        }
        dirtyRef.current = false;
        setState("saved");
        setLastSavedAt(new Date().toISOString());
        setErrorMessage(null);
        if (rowIdRef.current) void touchLocalFile(rowIdRef.current);
      },
      onError: (e) => {
        /* A revoked permission surfaces here as a DOMException rather than
           through `queryPermission`, when it lapses between the check and the
           write. Same state, same one-click recovery. */
        const name = (e as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setState("denied");
          return;
        }
        setState("error");
        setErrorMessage(
          e instanceof Error && e.message
            ? `Couldn’t write to the file: ${e.message}`
            : "Couldn’t write to the file.",
        );
      },
      onNoChange: () => {
        /* Nothing actually changed — settle rather than sit on "Saving…". */
        setState((s) => (s === "saving" ? "saved" : s));
      },
    });
    const auto = autoRef.current;
    return () => auto?.cancel();
  }, []);

  /* Every change reschedules the one write. Keyed on the workbook's identity,
     the same signal the cloud autosave uses, so the two never disagree about
     whether something changed. */
  const wb = controller.workbook;
  useEffect(() => {
    if (!handleRef.current) return;
    dirtyRef.current = true;
    if (autoRef.current?.pushLazy(() => controllerRef.current.serialize()))
      setState("saving");
  }, [wb]);

  /**
   * Take what is on disk into the sheet.
   *
   * The baseline reset afterwards is what stops a reload bouncing straight back
   * out: importing changes the workbook, the change effect above fires, and
   * without a new baseline the autosaver would write the freshly-read content
   * back to the file it just came from — harmless, but it moves the timestamp
   * and makes every reload look like a second external edit.
   */
  const reloadFromFile = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      const file = await handle.getFile();
      const result = await controllerRef.current.importXlsx(
        await file.arrayBuffer(),
      );
      if (!result.ok) {
        setState("error");
        setErrorMessage(result.error ?? "The file on disk couldn’t be read.");
        return;
      }
      seenModifiedRef.current = file.lastModified;
      dirtyRef.current = false;
      setExternalChange(false);
      autoRef.current?.setBaseline(controllerRef.current.serialize());
      setState("saved");
      setLastSavedAt(new Date().toISOString());
      setErrorMessage(null);
    } catch {
      setState("error");
      setErrorMessage("The file on disk couldn’t be read.");
    }
  }, []);

  /**
   * Watch the file for changes made outside Cowork.
   *
   * A browser has no filesystem event to subscribe to, so this polls. A change
   * with nothing pending here is simply taken — that is the case the reader
   * asked about, and stopping to confirm a change they made themselves in
   * another program would be noise. A change with unsaved edits here is NOT
   * taken automatically, because one of the two versions has to lose and only a
   * person can say which.
   */
  useEffect(() => {
    const timer = setInterval(async () => {
      const handle = handleRef.current;
      if (!handle || document.hidden) return;
      try {
        const file = await handle.getFile();
        const seen = seenModifiedRef.current;
        if (seen === null) {
          seenModifiedRef.current = file.lastModified;
          return;
        }
        if (file.lastModified === seen) return;
        if (dirtyRef.current) {
          setExternalChange(true);
          return;
        }
        await reloadFromFile();
      } catch {
        /* Permission lapsed, or the file was moved or deleted. Neither is an
           error to shout about on a timer — the next write reports it, and the
           chip already has a Reconnect for the permission case. */
      }
    }, WATCH_MS);
    return () => clearInterval(timer);
  }, [reloadFromFile]);

  /* A pending write must not be lost because somebody closed the tab. This is
     best-effort by nature — the browser may not wait for an async write — but
     it converts "the last few seconds are gone" into "usually they are not". */
  useEffect(() => {
    function onHide() {
      if (handleRef.current) void autoRef.current?.flush();
    }
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  const bind = useCallback(
    async (handle: LocalFileHandle, title: string): Promise<boolean> => {
      /* Asked for here rather than on the first write, so the prompt lands on
         the gesture that caused it — a drop or a menu click — instead of
         appearing unexplained a second and a half later. */
      if (!(await ensurePermission(handle, "readwrite"))) {
        setState("denied");
        setErrorMessage(null);
        handleRef.current = handle;
        setFileName(handle.name);
        return false;
      }
      handleRef.current = handle;
      setFileName(handle.name);
      setErrorMessage(null);
      setExternalChange(false);
      dirtyRef.current = false;
      /* The baseline the watch compares against. Without it the first poll
         has nothing to compare and would treat the file as freshly changed. */
      try {
        seenModifiedRef.current = (await handle.getFile()).lastModified;
      } catch {
        seenModifiedRef.current = null;
      }
      setState("saved");
      const row = await rememberLocalFile(handle, title);
      rowIdRef.current = row?.id ?? null;
      return true;
    },
    [],
  );

  const saveToComputer = useCallback(
    async (suggestedName: string): Promise<boolean> => {
      const handle = await pickFileToSave(suggestedName);
      if (!handle) return false;
      const ok = await bind(handle, suggestedName);
      /* Write immediately. A "Save to this computer" that leaves an empty file
         until the next keystroke has not saved anything. */
      if (ok) {
        try {
          const bytes = await controllerRef.current.exportXlsx();
          await writeLocalFile(handle, bytes);
          setState("saved");
          setLastSavedAt(new Date().toISOString());
        } catch {
          setState("error");
          setErrorMessage("Couldn’t write to the file.");
        }
      }
      return ok;
    },
    [bind],
  );

  const reconnect = useCallback(async (): Promise<boolean> => {
    const handle = handleRef.current;
    if (!handle) return false;
    if (!(await ensurePermission(handle, "readwrite"))) {
      setState("denied");
      return false;
    }
    setState("saving");
    await autoRef.current?.flush();
    return true;
  }, []);

  const unbind = useCallback((opts?: { forget?: boolean }) => {
    autoRef.current?.cancel();
    if (opts?.forget && rowIdRef.current) void forgetLocalFile(rowIdRef.current);
    handleRef.current = null;
    rowIdRef.current = null;
    seenModifiedRef.current = null;
    dirtyRef.current = false;
    setExternalChange(false);
    setFileName(null);
    setLastSavedAt(null);
    setErrorMessage(null);
    setState("none");
  }, []);

  const flush = useCallback(async () => {
    if (handleRef.current) await autoRef.current?.flush();
  }, []);

  return {
    supported,
    state,
    externalChange,
    reloadFromFile,
    fileName,
    lastSavedAt,
    errorMessage,
    bind,
    saveToComputer,
    reconnect,
    unbind,
    flush,
  };
}
