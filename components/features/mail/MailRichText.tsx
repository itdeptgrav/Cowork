"use client";

import { useEffect, useState } from "react";
import { generateHTML, generateJSON } from "@tiptap/core";
import { mailEditorExtensions } from "./mailEditorExtensions";

/**
 * Render a stored rich `bodyHtml` SAFELY.
 *
 * Two layers, because rendering someone else's stored HTML is the mailbox's one
 * real XSS surface — the body is written browser-to-Firestore and a hostile
 * writer could put anything in it:
 *
 *  1. **Schema round-trip.** Parse the HTML back into a ProseMirror document
 *     through the SAME allowlist the composer uses, then re-serialise it. Only
 *     the nodes, marks and attributes the schema defines survive; a `<script>`,
 *     an `onclick`, an `<iframe>` or an unknown tag is dropped, not rendered.
 *  2. **A focused DOM pass** over the result, because the one thing a schema
 *     round-trip does NOT vet is a link's PROTOCOL — a `javascript:` href on an
 *     otherwise-valid `<a>` survives the schema. This strips any href that is
 *     not http(s)/mailto/anchor/relative, removes any residual `on*` handler and
 *     any script-like element, and forces safe `rel`/`target` on links.
 *
 * Both need the DOM, so the work runs in an effect (client only) — server and
 * first client render show nothing, then the sanitised body appears, which also
 * sidesteps any hydration mismatch.
 */
export function MailRichText({ html }: { html: string }) {
  const [clean, setClean] = useState("");

  useEffect(() => {
    if (!html || typeof document === "undefined") {
      setClean("");
      return;
    }
    try {
      const exts = mailEditorExtensions();
      const schemaClean = generateHTML(generateJSON(html, exts), exts);
      setClean(sanitizeDom(schemaClean));
    } catch {
      setClean("");
    }
  }, [html]);

  if (!clean) return null;
  return (
    <div
      className="mail-rich text-sm leading-relaxed text-ink-muted"
      /* Safe: `clean` is the schema round-trip's output after `sanitizeDom`. */
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/)/i;

function sanitizeDom(input: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = input;
  tpl.content
    .querySelectorAll("script,style,iframe,object,embed,link,meta,form,base")
    .forEach((el) => el.remove());
  tpl.content.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });
  tpl.content.querySelectorAll("a[href]").forEach((a) => {
    const href = (a.getAttribute("href") ?? "").trim();
    if (!SAFE_HREF.test(href)) a.removeAttribute("href");
    a.setAttribute("rel", "noopener nofollow noreferrer");
    a.setAttribute("target", "_blank");
  });
  return tpl.innerHTML;
}
