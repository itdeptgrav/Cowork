import { StarterKit } from "@tiptap/starter-kit";
import { TextAlign } from "@tiptap/extension-text-align";
import {
  TextStyle,
  Color,
  FontFamily,
  FontSize,
} from "@tiptap/extension-text-style";
import type { Extensions } from "@tiptap/react";

/**
 * The ONE TipTap schema the mail composer and the read-only renderer share.
 *
 * Sharing it is what makes rich mail both correct and SAFE:
 *
 *  · Correct — what you format in the composer is exactly what renders in the
 *    thread, because both use this identical set of nodes and marks.
 *  · Safe — a stored `bodyHtml` is parsed BACK through this schema before it is
 *    shown. ProseMirror keeps only the nodes, marks and attributes defined here
 *    and drops everything else, so a `<script>`, an `onclick`, or a
 *    `javascript:` href written straight into Firestore cannot execute. This is
 *    the mailbox's sanitiser, and it needs no extra dependency.
 *
 * The formatting on offer mirrors the Gmail-style toolbar: bold, italic,
 * underline and strike; text colour, font family and size; left/centre/right
 * alignment; bullet and numbered lists; links; and undo/redo — all from
 * extensions already installed.
 */
export function mailEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      /* Links open in a new tab, never on click inside the editor, and default
         to https — the Link extension's own guard blocks a `javascript:` URI. */
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener nofollow noreferrer", target: "_blank" },
      },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
  ];
}
