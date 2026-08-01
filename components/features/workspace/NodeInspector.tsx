"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  Field,
  InlineError,
  Input,
  Textarea,
} from "@/components/ui/Primitives";
import {
  childrenOf,
  normaliseUrl,
  type MindMap,
  type MindNode,
} from "@/lib/rules/mindmap/tree";

/**
 * One card, opened.
 *
 * The canvas shows structure; this shows content. Splitting them is what lets a
 * node carry a paragraph, three links and a picture without the map becoming
 * unreadable — the reference mindmap is a diagram of labels, and the whole
 * point of this one is that a label can have something behind it.
 *
 * Every edit commits immediately. There is no Save: a thinking tool that can
 * lose a half-typed thought to a forgotten button is worse than one that
 * occasionally saves something you did not mean.
 */

/** Refused above this. See the note on `MindImage` — these go into localStorage. */
const MAX_IMAGE_BYTES = 512 * 1024;

export function NodeInspector({
  map,
  node,
  onChange,
  onDelete,
  onAddChild,
  onClose,
}: {
  map: MindMap;
  node: MindNode;
  onChange: (patch: Partial<MindNode>) => void;
  onDelete: () => void;
  onAddChild: () => void;
  onClose: () => void;
}) {
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const isRoot = node.parentId === null;
  const kids = childrenOf(map, node.id);

  const addLink = () => {
    const url = normaliseUrl(linkDraft);
    if (!url) {
      /* Named rather than silently ignored. A pasted `javascript:` URL and a
         typo both land here, and "nothing happened" is the hardest failure to
         report. */
      setLinkError("That is not a web address. Links must be http or https.");
      return;
    }
    if (node.links.some((l) => l.url === url)) {
      setLinkError("That link is already on this card.");
      return;
    }
    setLinkError(null);
    onChange({
      links: [
        ...node.links,
        { id: `l${Date.now().toString(36)}`, url, label: hostOf(url) },
      ],
    });
    setLinkDraft("");
  };

  const attach = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Attach an image. Other files are not supported here yet.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        `That image is ${Math.round(file.size / 1024)} KB. The limit is ${MAX_IMAGE_BYTES / 1024} KB — the map is kept in this browser, and large pictures fill its store.`,
      );
      return;
    }
    setImageError(null);
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        images: [
          ...node.images,
          {
            id: `i${Date.now().toString(36)}`,
            name: file.name,
            dataUrl: String(reader.result),
            sizeBytes: file.size,
          },
        ],
      });
    };
    reader.onerror = () => setImageError("That image could not be read.");
    reader.readAsDataURL(file);
  };

  return (
    <aside
      aria-label="Card details"
      className="frost-panel flex h-full min-h-0 w-full flex-col rounded-card border border-hairline"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-3">
        <span className="min-w-0 flex-1 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          {isRoot ? "Root card" : "Card"}
        </span>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="text-ink-faint hover:text-ink"
        >
          <Icon.close className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scroll-slim">
        <Field label="Title">
          <Input
            value={node.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="What is this?"
          />
        </Field>

        <Field
          label="Description"
          hint="The thinking behind the card. Only shown here, never on the map."
          className="mt-4"
        >
          <Textarea
            rows={5}
            value={node.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="e.g. Why this branch exists, what still has to be decided…"
          />
        </Field>

        {/* ── Images ────────────────────────────────────────────────────── */}
        <div className="mt-5">
          <p className="text-sm font-medium text-ink">Images</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            Kept in this browser, not uploaded. Up to{" "}
            <span data-figure>{MAX_IMAGE_BYTES / 1024}</span> KB each.
          </p>

          {node.images.length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {node.images.map((img) => (
                <li key={img.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-24 w-full rounded-inset border border-hairline object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${img.name}`}
                    onClick={() =>
                      onChange({
                        images: node.images.filter((i) => i.id !== img.id),
                      })
                    }
                    className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--body-bg)]/80 text-ink-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink"
                  >
                    <Icon.close className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-2 flex cursor-pointer items-center gap-2.5 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5 transition-colors hover:bg-[var(--control)]">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--control)] text-ink-faint">
              <Icon.attach className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm text-ink">Attach an image</span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                attach(e.target.files?.[0]);
                /* Cleared so attaching the SAME file twice still fires a
                   change event the second time. */
                e.target.value = "";
              }}
            />
          </label>
          {imageError && (
            <div className="mt-2">
              <InlineError compact message={imageError} />
            </div>
          )}
        </div>

        {/* ── Links ─────────────────────────────────────────────────────── */}
        <div className="mt-5">
          <p className="text-sm font-medium text-ink">Links</p>

          {node.links.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {node.links.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 rounded-inset bg-[var(--surface-sunken)] px-2.5 py-1.5"
                >
                  <Icon.link className="h-3 w-3 shrink-0 text-ink-faint" />
                  <a
                    href={l.url}
                    target="_blank"
                    /* `noopener` is the load-bearing half — without it the
                       opened page can reach back through `window.opener`. */
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-[12px] text-ink hover:underline"
                    title={l.url}
                  >
                    {l.label || l.url}
                  </a>
                  <Icon.external className="h-3 w-3 shrink-0 text-ink-faint" />
                  <button
                    type="button"
                    aria-label={`Remove ${l.label || l.url}`}
                    onClick={() =>
                      onChange({ links: node.links.filter((x) => x.id !== l.id) })
                    }
                    className="text-ink-faint hover:text-ink"
                  >
                    <Icon.close className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex gap-2">
            <Input
              value={linkDraft}
              onChange={(e) => {
                setLinkDraft(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
              placeholder="Paste a link"
            />
            <Button size="sm" onClick={addLink} disabled={!linkDraft.trim()}>
              Add
            </Button>
          </div>
          {linkError && (
            <div className="mt-2">
              <InlineError compact message={linkError} />
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
        <Button size="sm" onClick={onAddChild}>
          Add child
        </Button>
        <span className="min-w-0 flex-1 text-[11px] text-ink-faint">
          {kids.length > 0 && (
            <>
              <span data-figure>{kids.length}</span>{" "}
              {kids.length === 1 ? "child" : "children"}
            </>
          )}
        </span>
        {/* The root has no delete. A map without one cannot be laid out, and a
            disabled control says that better than a refusal after the fact. */}
        {!isRoot && (
          <Button size="sm" tone="destructive" onClick={onDelete}>
            {kids.length > 0 ? `Delete with ${kids.length}` : "Delete"}
          </Button>
        )}
      </footer>
    </aside>
  );
}

/** A readable default label. The host is what people recognise in a list. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
