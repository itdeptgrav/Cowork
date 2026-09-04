"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { DriveImage } from "@/components/ui/DriveImage";
import {
  Button,
  Field,
  InlineError,
  Input,
  Textarea,
} from "@/components/ui/Primitives";
import { useRepo } from "@/lib/hooks/useRepository";
import {
  childrenOf,
  extrasOf,
  normaliseUrl,
  type MindMap,
  type MindNode,
} from "@/lib/rules/mindmap/tree";
import { themeOf } from "@/lib/rules/mindmap/theme";
import { NodeStylePanel } from "./NodeStylePanel";
import { NodeTaskLink } from "./NodeTaskLink";

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

/**
 * Refused above this.
 *
 * The old ceiling was 512 KB and it was a `localStorage` quota, not a judgement
 * about pictures: the bytes were kept in the browser, so a handful of
 * screenshots filled the store and a silent quota failure lost the whole map.
 * They go to Drive now, so the cap can be what a picture on a card actually
 * warrants rather than what a browser will tolerate.
 */
/* No size cap — withdrawn on the owner's instruction, with the ones on task
   attachments and MRF photos. Null rather than a large number so "no cap" is a
   state a reader can see. */
const MAX_IMAGE_BYTES: number | null = null;

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
  const [uploading, setUploading] = useState(false);

  const repo = useRepo();
  /* Off entirely without a store behind it, rather than offering an upload that
     cannot happen — the in-memory prototype has no `uploadDriveFile`. */
  const canUpload = typeof repo.uploadDriveFile === "function";

  /* Parentless AND not floating: a floating topic is parentless by design and
     keeps every control a branch card has. */
  const isRoot = node.parentId === null && !node.floating;
  const isFloating = !!node.floating;
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

  /**
   * Attach a picture — to Drive, where the rest of this product's files live.
   *
   * This used to `readAsDataURL` and put the base64 on the card. The card is
   * `localStorage`, so the picture was in one browser: a map shared with a
   * colleague arrived with holes where the images were, and clearing site data
   * threw them away with no copy anywhere. Uploading first means the card
   * carries a Drive file id and the picture is a file, like every other file.
   */
  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Attach an image. Other files are not supported here yet.");
      return;
    }
    if (MAX_IMAGE_BYTES !== null && file.size > MAX_IMAGE_BYTES) {
      setImageError(
        `That image is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }
    if (!repo.uploadDriveFile) {
      setImageError("Image storage is not configured on this deployment.");
      return;
    }

    setImageError(null);
    setUploading(true);
    const r = await repo.uploadDriveFile(file);
    setUploading(false);
    if (!r.ok) {
      /* The store's own reason. "Attachment storage is not configured on this
         server" is an operator's problem and says so; a generic failure sends
         somebody looking at their file instead. */
      setImageError(r.message);
      return;
    }

    onChange({
      images: [
        ...node.images,
        {
          id: `i${Date.now().toString(36)}`,
          name: r.data.name || file.name,
          fileId: r.data.fileId,
          url: r.data.url,
          sizeBytes: r.data.sizeBytes || file.size,
        },
      ],
    });
  };

  return (
    <aside
      aria-label="Card details"
      className="frost-panel flex h-full min-h-0 w-full flex-col rounded-card border border-hairline"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-3">
        {/* A role pill, not a tracked eyebrow — the same idiom the document and
           sheet headers use for "View only" / "Editor". A tracked uppercase
           kicker over a panel is a defect the system names explicitly, and this
           one was announcing a panel rather than doing wayfinding. */}
        <span className="min-w-0 flex-1 text-sm font-medium text-ink">
          Card details
        </span>
        {isRoot && (
          <span className="shrink-0 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted">
            Root
          </span>
        )}
        {isFloating && (
          <span className="shrink-0 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted" title="A card with no parent, placed where it was dropped">
            Floating
          </span>
        )}
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

        {/* Colour, shape, text, icon, markers and tags — the card's look. */}
        <NodeStylePanel
          node={node}
          theme={themeOf(extrasOf(map).settings.theme)}
          onChange={onChange}
        />

        {/* The work this card stands for. */}
        <NodeTaskLink
          taskId={node.taskId}
          readOnly={false}
          onChange={(taskId) => onChange({ taskId: taskId ?? undefined })}
        />

        {/* ── Images ────────────────────────────────────────────────────── */}
        <div className="mt-5">
          <p className="text-sm font-medium text-ink">Images</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {canUpload
              ? MAX_IMAGE_BYTES === null
                ? "Stored with the rest of your files, so anyone you share the map with sees them."
                : `Stored with the rest of your files, so anyone you share the map with sees them. Up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB each.`
              : "Image storage is not configured on this deployment."}
          </p>

          {node.images.length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {node.images.map((img) => (
                <li key={img.id} className="group relative">
                  {/* A picture stored before the upload path still has its bytes
                      on the card and nothing to fetch, so it is drawn as-is.
                      Everything since is a Drive file. */}
                  {img.dataUrl && !img.fileId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-24 w-full rounded-inset border border-hairline object-cover"
                    />
                  ) : (
                    <DriveImage
                      fileId={img.fileId}
                      url={img.url}
                      alt={img.name}
                      width={480}
                      className="h-24 w-full rounded-inset border border-hairline object-cover"
                    />
                  )}
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

          <label
            aria-disabled={!canUpload || uploading}
            className={`mt-2 flex items-center gap-2.5 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5 transition-colors ${
              canUpload && !uploading
                ? "cursor-pointer hover:bg-[var(--control)]"
                : "cursor-not-allowed opacity-60"
            }`}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--control)] text-ink-faint">
              <Icon.attach className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm text-ink">
              {uploading ? "Uploading…" : "Attach an image"}
            </span>
            <input
              type="file"
              accept="image/*"
              disabled={!canUpload || uploading}
              className="sr-only"
              onChange={(e) => {
                void attach(e.target.files?.[0]);
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
