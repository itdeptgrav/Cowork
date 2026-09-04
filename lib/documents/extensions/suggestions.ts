import { Extension, Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Fragment, Slice, type MarkType, type Node as PmNode } from "@tiptap/pm/model";

/**
 * Suggesting — Google Docs' track changes.
 *
 * ## What a suggestion is
 *
 * Two marks. Text typed while suggesting carries `suggestInsert`; text
 * deleted while suggesting is NOT removed but marked `suggestDelete` (struck
 * through) so the reader sees what would go. Both carry who made it and when.
 * Accepting an insertion drops its mark; accepting a deletion deletes the
 * text. Rejecting is the mirror image. The document is therefore always a
 * valid document with some text decorated — which is what keeps it safe under
 * collaboration: a mark merges like any other mark, and two people suggesting
 * at once produce two suggestions, not a conflict.
 *
 * ## How typing becomes a suggestion
 *
 * A ProseMirror plugin watches every transaction while the mode is on. For a
 * step that inserts text, the inserted range gets the insert mark. For a step
 * that removes text, the removal is undone — the removed slice is put back —
 * and marked for deletion instead. Structural edits (splitting a paragraph,
 * changing a heading level) pass through untouched: they are rare in a
 * review, and a half-tracked block is worse than an untracked one.
 *
 * Text that is itself an insertion suggestion and then deleted is simply
 * removed — deleting your own not-yet-accepted insertion is a retraction, not
 * a second suggestion.
 */

export interface SuggestionMeta {
  id: string;
  by: string;
  byName: string;
  at: string;
}

const attrs = () => ({
  id: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-id") ?? "", renderHTML: (a: { id: string }) => ({ "data-id": a.id }) },
  by: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-by") ?? "", renderHTML: (a: { by: string }) => ({ "data-by": a.by }) },
  byName: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-by-name") ?? "", renderHTML: (a: { byName: string }) => ({ "data-by-name": a.byName }) },
  at: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-at") ?? "", renderHTML: (a: { at: string }) => ({ "data-at": a.at }) },
});

export const SuggestInsert = Mark.create({
  name: "suggestInsert",
  inclusive: true,
  addAttributes: attrs,
  parseHTML() {
    return [{ tag: "ins[data-suggest]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ins", mergeAttributes(HTMLAttributes, { "data-suggest": "insert", class: "doc-suggest-insert" }), 0];
  },
});

export const SuggestDelete = Mark.create({
  name: "suggestDelete",
  inclusive: false,
  addAttributes: attrs,
  parseHTML() {
    return [{ tag: "del[data-suggest]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["del", mergeAttributes(HTMLAttributes, { "data-suggest": "delete", class: "doc-suggest-delete" }), 0];
  },
});

export const suggestingKey = new PluginKey<{ on: boolean }>("suggesting");

let counter = 0;
function mint(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export interface SuggestingAuthor {
  id: string;
  name: string;
}

/** Who is suggesting — set on `editor.storage.suggesting.author` by the
 *  editor once it knows who is signed in, and read at the moment of each
 *  edit, so a session change is honoured without rebuilding the editor. */
export interface SuggestingStorage {
  author: SuggestingAuthor;
}

declare module "@tiptap/core" {
  interface Storage {
    suggesting: SuggestingStorage;
  }
  interface Commands<ReturnType> {
    suggesting: {
      setSuggesting: (on: boolean) => ReturnType;
      acceptSuggestion: (id: string) => ReturnType;
      rejectSuggestion: (id: string) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
    };
  }
}

/** Name the person whose edits become suggestions. Called by the editor
 *  whenever the signed-in employee is known or changes. */
export function setSuggestionAuthor(editor: Editor, author: SuggestingAuthor): void {
  editor.storage.suggesting.author = author;
}

/* ── Reading suggestions off a document ───────────────────────────────────── */

export interface SuggestionEntry extends SuggestionMeta {
  kind: "insert" | "delete";
  text: string;
  from: number;
  to: number;
}

/**
 * Every suggestion, in document order, adjacent runs with one id merged.
 * Typing a word is many steps and one suggestion; the id is what joins them.
 */
export function suggestionsOf(doc: PmNode): SuggestionEntry[] {
  const out: SuggestionEntry[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== "suggestInsert" && mark.type.name !== "suggestDelete") continue;
      const kind = mark.type.name === "suggestInsert" ? "insert" : "delete";
      const last = out[out.length - 1];
      if (last && last.id === mark.attrs.id && last.kind === kind && last.to === pos) {
        last.text += node.text ?? "";
        last.to = pos + node.nodeSize;
      } else {
        out.push({
          kind,
          id: String(mark.attrs.id),
          by: String(mark.attrs.by),
          byName: String(mark.attrs.byName),
          at: String(mark.attrs.at),
          text: node.text ?? "",
          from: pos,
          to: pos + node.nodeSize,
        });
      }
    }
    return true;
  });
  return out;
}

/* ── Resolving ────────────────────────────────────────────────────────────── */

/**
 * Accept or reject one suggestion on a transaction.
 *
 * Ranges are resolved from the CURRENT doc every time and processed from the
 * end backwards, so a deletion earlier in the document cannot shift a range
 * still to be handled.
 */
export function resolveSuggestion(tr: Transaction, id: string, accept: boolean): boolean {
  const entries = suggestionsOf(tr.doc).filter((s) => s.id === id);
  if (entries.length === 0) return false;
  const insertType = tr.doc.type.schema.marks.suggestInsert;
  const deleteType = tr.doc.type.schema.marks.suggestDelete;
  /* Positions come from `tr.doc`, which already reflects every earlier step
     on this transaction — so they are used as they are, never mapped again. */
  for (const e of [...entries].reverse()) {
    const keep = e.kind === "insert" ? accept : !accept;
    if (keep) tr.removeMark(e.from, e.to, e.kind === "insert" ? insertType : deleteType);
    else tr.delete(e.from, e.to);
  }
  return true;
}

export function resolveAll(tr: Transaction, accept: boolean): boolean {
  const ids = [...new Set(suggestionsOf(tr.doc).map((s) => s.id))];
  if (ids.length === 0) return false;
  for (const id of ids) resolveSuggestion(tr, id, accept);
  return true;
}

/* ── The mode ─────────────────────────────────────────────────────────────── */

export const Suggesting = Extension.create<Record<string, never>, SuggestingStorage>({
  name: "suggesting",

  addStorage() {
    return { author: { id: "", name: "" } };
  },

  addCommands() {
    return {
      setSuggesting:
        (on) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(suggestingKey, { on });
          return true;
        },
      acceptSuggestion:
        (id) =>
        ({ tr, dispatch }) => {
          const did = resolveSuggestion(tr, id, true);
          if (did && dispatch) tr.setMeta("suggestionResolved", true);
          return did;
        },
      rejectSuggestion:
        (id) =>
        ({ tr, dispatch }) => {
          const did = resolveSuggestion(tr, id, false);
          if (did && dispatch) tr.setMeta("suggestionResolved", true);
          return did;
        },
      acceptAllSuggestions:
        () =>
        ({ tr, dispatch }) => {
          const did = resolveAll(tr, true);
          if (did && dispatch) tr.setMeta("suggestionResolved", true);
          return did;
        },
      rejectAllSuggestions:
        () =>
        ({ tr, dispatch }) => {
          const did = resolveAll(tr, false);
          if (did && dispatch) tr.setMeta("suggestionResolved", true);
          return did;
        },
    };
  },

  addProseMirrorPlugins() {
    return [suggestingPlugin(() => this.storage.author)];
  },
});

/**
 * The plugin on its own, so it can be tested on a bare EditorState. `initialOn`
 * is for tests and for a document opened straight into suggesting.
 */
export function suggestingPlugin(author: () => SuggestingAuthor, initialOn = false): Plugin<{ on: boolean }> {
  return new Plugin<{ on: boolean }>({
    key: suggestingKey,
    state: {
      init: () => ({ on: initialOn }),
      apply: (tr, value) => {
        const meta = tr.getMeta(suggestingKey) as { on: boolean } | undefined;
        return meta ? { on: meta.on } : value;
      },
    },
    appendTransaction: (transactions, oldState, newState) => {
      const on = suggestingKey.getState(newState)?.on;
      if (!on) return null;
      /* Only the person's own typing — not a resolve, not a remote update,
         not our own rewrite. */
      const tr = transactions.find(
        (t) =>
          t.docChanged &&
          !t.getMeta("suggestionResolved") &&
          !t.getMeta("suggestionTracked") &&
          !t.getMeta("y-sync$") &&
          t.getMeta("addToHistory") !== false,
      );
      if (!tr) return null;

      const insertType = newState.schema.marks.suggestInsert;
      const deleteType = newState.schema.marks.suggestDelete;
      if (!insertType || !deleteType) return null;
      const who = author();
      const meta: SuggestionMeta = { id: mint(), by: who.id, byName: who.name, at: new Date().toISOString() };
      const out = newState.tr;
      let changed = false;

      /* Walk the steps against the OLD document to learn what each removed,
         then act on the new document through the mapping. */
      let doc = oldState.doc;
      const removed: { at: number; slice: Slice }[] = [];
      const inserted: { from: number; to: number }[] = [];
      tr.steps.forEach((step, i) => {
        if (step instanceof ReplaceStep) {
          const map = tr.mapping.slice(i + 1);
          if (step.to > step.from) {
            const slice = doc.slice(step.from, step.to);
            /* Text only. A removed block boundary is structure, and is let
               through untracked. */
            if (slice.content.childCount > 0 && slice.openStart === 0 && slice.openEnd === 0 && sliceIsText(slice)) {
              removed.push({ at: map.map(step.from, -1), slice });
            }
          }
          if (step.slice.size > 0 && sliceIsText(step.slice)) {
            const from = map.map(step.from, -1);
            inserted.push({ from, to: from + step.slice.size });
          }
        }
        doc = step.apply(doc).doc ?? doc;
      });

      for (const r of removed) {
        /* Put back what was removed, struck through — unless it was itself an
           insertion suggestion, in which case removing it is a retraction.
           Anything already marked for deletion is put back as it was. */
        const allOwnInsertion = everyText(r.slice, (n) => n.marks.some((m) => m.type === insertType));
        if (allOwnInsertion) continue;
        const pos = out.mapping.map(r.at);
        const content = stripMarks(r.slice, insertType);
        out.insert(pos, content.content);
        out.addMark(pos, pos + content.size, deleteType.create(meta));
        changed = true;
      }
      for (const ins of inserted) {
        const from = out.mapping.map(ins.from);
        const to = out.mapping.map(ins.to);
        out.removeMark(from, to, deleteType);
        out.addMark(from, to, insertType.create(meta));
        changed = true;
      }
      if (!changed) return null;
      out.setMeta("suggestionTracked", true);
      out.setMeta("addToHistory", true);
      return out;
    },
  });
}

function sliceIsText(slice: Slice): boolean {
  let ok = true;
  slice.content.forEach((n) => {
    if (!n.isInline) ok = false;
  });
  return ok;
}

function everyText(slice: Slice, test: (n: PmNode) => boolean): boolean {
  let ok = true;
  slice.content.forEach((n) => {
    if (!test(n)) ok = false;
  });
  return ok;
}

/** The slice with one mark type removed from every node — inserted text a
 *  reviewer then deletes should not come back as a proposed insertion. */
function stripMarks(slice: Slice, type: MarkType): Slice {
  const nodes: PmNode[] = [];
  slice.content.forEach((n) => nodes.push(n.mark(type.removeFromSet(n.marks))));
  return new Slice(Fragment.from(nodes), slice.openStart, slice.openEnd);
}
