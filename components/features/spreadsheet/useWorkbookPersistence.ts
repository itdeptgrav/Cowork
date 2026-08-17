"use client";

/**
 * Workbook persistence, wired to the live controller.
 *
 * It loads the workbook the caller ASKED for — the browser picks it — and never
 * creates one, so opening the surface writes nothing;
 * then AUTOSAVES on change — debounced, so a burst of keystrokes is one save,
 * not one per keystroke (requirement 6). The edits themselves never wait on the
 * network: the controller applies them locally and immediately, and this hook
 * catches up in the background (requirement 8), reporting where it is through a
 * save state (requirement 7).
 *
 * Every failure the server can return has a landing here (requirement 15): a
 * dropped network keeps working offline, an unauthorized stops trying, a
 * conflict is surfaced rather than silently overwriting a newer save. The undo
 * history is deliberately NOT persisted — it is per session.
 */

import { useEffect, useRef, useState } from "react";
import { Autosaver } from "@/lib/spreadsheet/autosave";
import type { SerializedWorkbook } from "@/lib/spreadsheet/persistence";
import {
  createWorkbook,
  loadWorkbook,
  renameWorkbook,
  saveWorkbook,
  WorkbookRequestError,
} from "@/lib/spreadsheet/workbookClient";
import type { SpreadsheetController } from "./useSpreadsheet";

export type SaveState = "loading" | "saving" | "saved" | "offline" | "error" | "conflict";

/** Whether a workbook holds anything worth storing — any cell value, style,
    or a second sheet. A freshly-created blank workbook has none of these, which
    is what lets a draft stay unsaved until it earns a record. */
function hasContent(wb: { worksheets: { cells: object; cellStyles: object }[] }): boolean {
  if (wb.worksheets.length > 1) return true;
  return wb.worksheets.some(
    (s) => Object.keys(s.cells).length > 0 || Object.keys(s.cellStyles).length > 0,
  );
}

export interface WorkbookPersistence {
  state: SaveState;
  title: string;
  workbookId: string | null;
  errorMessage: string | null;
  rename: (title: string) => void;
  saveNow: () => void;
  retry: () => void;
}

const AUTOSAVE_MS = 1000;

/**
 * @param workbookId Which workbook to open. `null` means none is chosen yet —
 *   the browser is showing — so nothing is loaded and, importantly, nothing is
 *   CREATED: a workbook now exists because somebody asked for it, not because a
 *   spreadsheet happened to mount.
 */
export function useWorkbookPersistence(
  controller: SpreadsheetController,
  workbookId: string | null,
  opts: { draft?: boolean; draftTitle?: string; onCreated?: (id: string) => void } = {},
): WorkbookPersistence {
  const { draft = false, draftTitle = "Untitled sheet", onCreated } = opts;
  const [state, setState] = useState<SaveState>("loading");
  const [title, setTitle] = useState("Untitled workbook");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /* The id actually LOADED — echoed back for callers, and distinct from the
     `workbookId` asked for, which is only a request until the load lands. */
  const [loadedId, setLoadedId] = useState<string | null>(null);
  /* Guards the one-shot draft creation against a second render racing it. */
  const creatingRef = useRef(false);

  /* Mutable persistence bookkeeping React never renders. */
  const meta = useRef<{ id: string | null; revision: number; ready: boolean }>({
    id: null,
    revision: 0,
    ready: false,
  });
  /* Always the latest controller, so a debounced save serializes current state.
     Updated in an effect (not during render) so a stale closure never saves. */
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  });

  function handleError(e: unknown): void {
    if (e instanceof WorkbookRequestError) {
      if (e.kind === "network") {
        setState("offline");
        setErrorMessage("Offline — your changes are kept on this device.");
      } else if (e.kind === "unauthorized") {
        /* Stop trying; local editing continues, nothing is lost. */
        meta.current.ready = false;
        setState("error");
        setErrorMessage("Sign in to save your workbook.");
      } else if (e.kind === "conflict") {
        setState("conflict");
        setErrorMessage("Edited in another place. Reload to get the latest version.");
      } else {
        setState("error");
        setErrorMessage(e.message);
      }
    } else {
      setState("error");
      setErrorMessage("Something went wrong while saving.");
    }
  }

  /* The Autosaver holds the debounce; it is built in the mount effect (not during
     render) so its save closure can read the id/revision refs. */
  const autosaverRef = useRef<Autosaver<SerializedWorkbook> | null>(null);

  /* The name a draft will be created under.
     A draft has nothing to rename yet, so a name typed before the record exists
     has to be held somewhere until there is one. It used to be dropped on the
     floor: `rename` returned early without an id, so the typed name never
     reached `createWorkbook`, and a sheet somebody had deliberately named was
     stored as "Untitled sheet". */
  const pendingTitle = useRef(draftTitle);

  /**
   * Give this draft a stored record, now.
   *
   * The one creation path, whether the trigger is the first cell typed or a
   * deliberate Save. It is guarded twice — an id already exists, or a creation
   * is in flight — so two triggers arriving together still make one workbook.
   */
  async function ensureRecord(): Promise<void> {
    if (meta.current.id || creatingRef.current) return;
    creatingRef.current = true;
    try {
      const data = controllerRef.current.serialize();
      const made = await createWorkbook(pendingTitle.current, data);
      autosaverRef.current?.setBaseline(data);
      meta.current = { id: made.id, revision: made.revision, ready: true };
      setLoadedId(made.id);
      setTitle(made.title);
      setState("saved");
      onCreated?.(made.id);
    } catch (e) {
      creatingRef.current = false;
      handleError(e);
    }
  }

  /* Build the autosaver and load the CHOSEN workbook. Re-runs when the choice
     changes, so opening another workbook tears the old autosaver down (its
     pending save is cancelled) before the new one is wired up. */
  useEffect(() => {
    let cancelled = false;
    /* The autosaver is built even for a DRAFT (no id yet): the draft path below
       needs it ready the moment the first edit lands. Only the LOAD is skipped. */
    const autosaver = new Autosaver<SerializedWorkbook>({
      delayMs: AUTOSAVE_MS,
      save: async (data) => {
        const m = meta.current;
        if (!m.id) return;
        const res = await saveWorkbook(m.id, data, m.revision);
        m.revision = res.revision;
        setState("saved");
        setErrorMessage(null);
      },
      onError: handleError,
      /* A settled burst that turned out to change nothing (an undo back to the
         saved state) must not leave the chip stuck on "Saving…". */
      onNoChange: () => setState("saved"),
    });
    autosaverRef.current = autosaver;

    if (!workbookId) {
      /* A draft starts blank and already-settled — there is nothing to fetch, and
         "Loading…" would be a lie. Deferred a tick so the flag is not written
         synchronously inside the effect. */
      const t = setTimeout(() => setState("saved"), 0);
      return () => {
        clearTimeout(t);
        cancelled = true;
        autosaver.cancel();
      };
    }
    (async () => {
      try {
        /* Inside the async body, so the "loading" flag is part of the fetch
           rather than a synchronous write during the effect. */
        setState("loading");
        const loaded = await loadWorkbook(workbookId);
        if (cancelled) return;
        controllerRef.current.hydrate(loaded.data);
        autosaver.setBaseline(loaded.data);
        meta.current = { id: loaded.id, revision: loaded.revision, ready: true };
        setLoadedId(loaded.id);
        setTitle(loaded.title);
        setState("saved");
      } catch (e) {
        if (!cancelled) handleError(e);
      }
    })();

    return () => {
      cancelled = true;
      /* Stop the outgoing workbook's autosave AND close the gate, so a render
         between two workbooks cannot push the old sheet's content at the new
         one's id. */
      meta.current.ready = false;
      autosaver.cancel();
    };
  }, [workbookId]);

  /* Autosave when the workbook changes. The payload is built LAZILY — serializing
     on every keystroke costs ~49 ms on a large workbook, and the whole point of
     the debounce is to do that work once per burst, not once per key. The
     Autosaver still skips a save whose data matches what is already stored. */
  const wb = controller.workbook;
  useEffect(() => {
    const auto = autosaverRef.current;
    if (!auto) return;

    /* A DRAFT has no stored record yet. It becomes one the moment it has
       something worth keeping — not when it was opened. Creating on open is what
       filled the list with empty "Untitled sheet" rows: every glance at New
       sheet left a permanent record behind, whether or not anything was typed. */
    if (draft && !meta.current.id) {
      if (!hasContent(controllerRef.current.workbook)) return;
      void ensureRecord();
      return;
    }

    if (!meta.current.ready || !meta.current.id) return;
    if (auto.pushLazy(() => controllerRef.current.serialize())) setState("saving");
  }, [wb]);

  /**
   * Name it — before or after it has a record.
   *
   * On a draft this used to return without doing anything at all: no stored
   * name, and not even the typed one on screen. The title box reverted to
   * "Untitled sheet" under the reader's hands and the name was gone for good,
   * because the eventual `createWorkbook` used the default rather than what had
   * been typed.
   *
   * Naming a draft still does not CREATE it. A name is not content, and
   * creating on a name would put the empty rows back that the draft rule exists
   * to keep out of the list — somebody who names a sheet, thinks better of it
   * and leaves should not find it there. The name is held, and whatever creates
   * the record — the first cell, or Save — creates it under that name.
   */
  function rename(next: string): void {
    const name = next.trim();
    if (!name) return;
    setTitle(name); // optimistic
    if (!meta.current.id) {
      pendingTitle.current = name;
      return;
    }
    renameWorkbook(meta.current.id, name).catch(handleError);
  }

  /**
   * **Save means save, including the first time.**
   *
   * This flushed the autosaver, whose save is a no-op without an id — so on a
   * draft that had not yet earned a record, File ▸ Save wrote nothing, created
   * nothing, and said "Saved." A sheet somebody made, named and saved was
   * simply not in the list afterwards, with no error to explain it.
   *
   * Autosave declines to keep a blank workbook, and should: opening New sheet
   * and looking at it is not a decision. Pressing Save is. It is the same line
   * the document editor already draws — an explicit save keeps an empty
   * document — and sheets only had half of it.
   */
  function saveNow(): void {
    if (!meta.current.id) {
      void ensureRecord();
      return;
    }
    void autosaverRef.current?.flush();
  }

  function retry(): void {
    meta.current.ready = meta.current.id !== null;
    void autosaverRef.current?.flush();
  }

  return {
    state,
    title,
    workbookId: loadedId,
    errorMessage,
    rename,
    saveNow,
    retry,
  };
}
