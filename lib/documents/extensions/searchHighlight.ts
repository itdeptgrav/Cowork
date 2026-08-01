import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/core";

/**
 * Paint the find results.
 *
 * Decorations rather than marks, deliberately: a mark would be part of the
 * document, would be replicated to everybody else in a shared session, and
 * would end up in the saved HTML. A search is one reader's transient view of
 * text nobody has changed.
 *
 * **Matches are dropped the moment the document changes.** Holding them across
 * an edit would leave highlights sitting on characters that have since moved,
 * and the caller re-runs the search from the new text anyway.
 */

export const searchKey = new PluginKey<SearchState>("docSearchHighlight");

export interface SearchRange {
  from: number;
  to: number;
}

interface SearchState {
  ranges: SearchRange[];
  /** Index into `ranges` of the one currently selected, or -1. */
  active: number;
}

const EMPTY: SearchState = { ranges: [], active: -1 };

export const SearchHighlight = Extension.create({
  name: "searchHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const next = tr.getMeta(searchKey) as SearchState | undefined;
            if (next) return next;
            if (tr.docChanged) return EMPTY;
            return value;
          },
        },
        props: {
          decorations(state) {
            const found = searchKey.getState(state);
            if (!found || found.ranges.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              found.ranges.map((range, i) =>
                Decoration.inline(range.from, range.to, {
                  class:
                    i === found.active
                      ? "doc-find-match doc-find-match--active"
                      : "doc-find-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

/** Show these ranges, with `active` selected. An empty list clears them. */
export function showSearchRanges(
  editor: Editor,
  ranges: SearchRange[],
  active: number,
): void {
  /* The panel clears its highlights on unmount, and unmount is exactly when the
     document is being switched — by which time the editor it is clearing may
     already be gone. Dispatching into a destroyed view throws. */
  if (editor.isDestroyed) return;
  const { tr } = editor.state;
  tr.setMeta(searchKey, { ranges, active } satisfies SearchState);
  /* Marked as not changing the document, so this cannot start an undo step, be
     sent to other editors, or mark the document dirty and trigger a save. */
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

export function clearSearchRanges(editor: Editor): void {
  showSearchRanges(editor, [], -1);
}
