"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PAGE_SETUP,
  MAX_MARGIN_IN,
  PAPER,
  PAPER_ORDER,
  pageSetupRefusal,
} from "@/lib/rules/documents/pageSetup";
import {
  characterCount,
  paragraphCount,
  readingMinutes,
  wordCount,
} from "@/lib/rules/documents/textStats";
import { useRepo } from "@/lib/hooks/useRepository";
import type { DocumentPageSetup, PaperSize } from "@/lib/domain";

/**
 * The document's dialogs.
 *
 * One shell so they share their focus handling, their dismissal and their
 * shape. Three separate modals grown one at a time is how a product ends up
 * with one that cannot be closed with Escape.
 */

export function DocsDialog({
  title,
  onClose,
  children,
  footer,
  width = 420,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    /* Focus moves INTO the dialog on open, or the first Tab takes the reader
       back into the document behind it. */
    const first = panel.current?.querySelector<HTMLElement>(
      "input, select, button, [tabindex]",
    );
    first?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-black/35 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="max-h-[85vh] w-full overflow-y-auto rounded-card border border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)] scroll-slim"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[13px] text-ink">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-inset text-ink-faint hover:bg-[var(--control)] hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Page setup.
 *
 * The refusal is computed as you type and shown beside the fields, and Apply is
 * disabled while it stands — a dialog that accepts the values and then reports
 * the problem afterwards makes somebody re-open it to find out what they did.
 */
export function PageSetupDialog({
  value,
  onApply,
  onClose,
}: {
  value: DocumentPageSetup;
  onApply: (next: DocumentPageSetup) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DocumentPageSetup>(value);
  const refusal = pageSetupRefusal(draft);

  const margin = (side: keyof DocumentPageSetup["margins"], label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <input
        type="number"
        step={0.125}
        min={0}
        max={MAX_MARGIN_IN}
        value={draft.margins[side]}
        onChange={(e) =>
          setDraft((d) => ({
            ...d,
            margins: { ...d.margins, [side]: Number(e.target.value) },
          }))
        }
        className="h-8 rounded-inset border border-hairline bg-transparent px-2 text-[12.5px] text-ink tabular-nums"
      />
    </label>
  );

  return (
    <DocsDialog
      title="Page setup"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_PAGE_SETUP)}
            className="h-8 rounded-inset px-2.5 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-inset px-2.5 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!!refusal}
            onClick={() => onApply(draft)}
            className="h-8 rounded-inset bg-ink px-3 text-[12px] text-[var(--body-bg)] disabled:opacity-40"
          >
            Apply
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">Paper</span>
          <select
            value={draft.paper}
            onChange={(e) => setDraft((d) => ({ ...d, paper: e.target.value as PaperSize }))}
            className="h-8 rounded-inset border border-hairline bg-transparent px-2 text-[12.5px] text-ink"
          >
            {PAPER_ORDER.map((p) => (
              <option key={p} value={p}>
                {PAPER[p].label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex items-center gap-3">
          <legend className="mb-1 text-[11px] text-ink-muted">Orientation</legend>
          {(["portrait", "landscape"] as const).map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-[12.5px] text-ink">
              <input
                type="radio"
                name="orientation"
                checked={draft.orientation === o}
                onChange={() => setDraft((d) => ({ ...d, orientation: o }))}
              />
              {o === "portrait" ? "Portrait" : "Landscape"}
            </label>
          ))}
        </fieldset>

        <div>
          <p className="mb-1.5 text-[11px] text-ink-muted">Margins (inches)</p>
          <div className="grid grid-cols-2 gap-2">
            {margin("top", "Top")}
            {margin("bottom", "Bottom")}
            {margin("left", "Left")}
            {margin("right", "Right")}
          </div>
        </div>

        {refusal ? (
          <p className="text-[11.5px] text-[var(--state-overdue-ink)]">{refusal}</p>
        ) : (
          <p className="text-[11.5px] text-ink-faint">
            The page belongs to the document, so everybody who opens it sees the
            same measure. Zoom is yours alone and is not saved here.
          </p>
        )}
      </div>
    </DocsDialog>
  );
}

/** Word count — the whole document, and the selection when there is one. */
export function WordCountDialog({
  documentText,
  selectionText,
  onClose,
}: {
  documentText: string;
  selectionText: string;
  onClose: () => void;
}) {
  const rows = (text: string) => [
    ["Words", wordCount(text)],
    ["Characters", characterCount(text, { includeSpaces: true })],
    ["Characters excluding spaces", characterCount(text)],
    ["Paragraphs", paragraphCount(text)],
    ["Reading time", `${readingMinutes(wordCount(text))} min`],
  ] as const;

  return (
    <DocsDialog title="Word count" onClose={onClose} width={380}>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[12.5px]">
        {rows(documentText).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right text-ink tabular-nums" data-figure>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {selectionText.trim() ? (
        <>
          {/* Title type, not a tracked eyebrow: a section label over a list is
             the defect the One Kicker Rule names, not a wayfinding device. */}
          <p className="mt-3 border-t border-hairline pt-3 text-[12.5px] font-medium text-ink">
            Selection
          </p>
          <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[12.5px]">
            {rows(selectionText).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="text-right text-ink tabular-nums" data-figure>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-3 border-t border-hairline pt-3 text-[11.5px] text-ink-faint">
          Select some text to count only that.
        </p>
      )}
    </DocsDialog>
  );
}

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "Text",
    items: [
      ["Bold", "Ctrl B"],
      ["Italic", "Ctrl I"],
      ["Underline", "Ctrl U"],
      ["Strikethrough", "Ctrl Shift S"],
      ["Link", "Ctrl K"],
      ["Clear formatting", "Ctrl \\"],
    ],
  },
  {
    group: "Paragraph",
    items: [
      ["Normal text", "Ctrl Alt 0"],
      ["Heading 1–3", "Ctrl Alt 1…3"],
      ["Bulleted list", "Ctrl Shift 8"],
      ["Numbered list", "Ctrl Shift 7"],
      ["Align left / centre / right", "Ctrl Shift L / E / R"],
    ],
  },
  {
    group: "Document",
    items: [
      ["Find and replace", "Ctrl F"],
      ["Word count", "Ctrl Shift C"],
      ["Print", "Ctrl P"],
      ["Page break", "Ctrl Enter"],
      ["Undo / Redo", "Ctrl Z / Ctrl Y"],
      ["This list", "Ctrl /"],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <DocsDialog title="Keyboard shortcuts" onClose={onClose} width={460}>
      <div className="grid gap-4">
        {SHORTCUTS.map((section) => (
          <div key={section.group}>
            {/* Same fix as `Selection` above: Title type, not a tracked
               eyebrow — three of these in one dialog would triple-fire the
               One Kicker Rule even before touching the rest of the page. */}
            <p className="mb-1.5 text-[12.5px] font-medium text-ink">
              {section.group}
            </p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[12.5px]">
              {section.items.map(([label, keys]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-right text-ink">{keys}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-hairline pt-3 text-[11.5px] text-ink-faint">
        On a Mac, Ctrl is ⌘.
      </p>
    </DocsDialog>
  );
}

/** The same ceiling `NodeInspector.tsx` uses for a mindmap card's image — one
    number for what "too large to attach" means across the workspace. */
/* No size cap — withdrawn on the owner's instruction, with the ones on task
   attachments and MRF photos. Null rather than a large number so "no cap" is a
   state a reader can see. */
const MAX_IMAGE_BYTES: number | null = null;

/**
 * A link or an image address.
 *
 * One dialog for both because they ask the same question — an address — and
 * differ only in what is done with the answer.
 *
 * **Images may be typed as an address, or uploaded.** Upload reuses
 * `repo.uploadDriveFile` — the same kind-agnostic resumable-upload pipeline
 * mindmap card images already go through (`NodeInspector.tsx`) — rather than
 * a document-specific route, since nothing about that pipeline is mindmap
 * shaped. A successful upload submits immediately with the returned URL, the
 * same as pressing Insert after typing one in by hand.
 */
export function AddressDialog({
  kind,
  initial,
  onSubmit,
  onRemove,
  onClose,
}: {
  kind: "link" | "image";
  initial?: string;
  onSubmit: (value: string) => void;
  /** Only for a link that is already there. */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const isLink = kind === "link";
  const repo = useRepo();
  /* Off entirely without a store behind it, rather than offering an upload
     control that cannot work — the in-memory prototype has no
     `uploadDriveFile`, exactly the guard `NodeInspector.tsx` uses for the
     same method on a mindmap card. */
  const canUpload = !isLink && typeof repo.uploadDriveFile === "function";

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Choose an image file.");
      return;
    }
    if (MAX_IMAGE_BYTES !== null && file.size > MAX_IMAGE_BYTES) {
      setUploadError(
        `That image is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }
    if (!repo.uploadDriveFile) return;
    setUploadError(null);
    setUploading(true);
    const r = await repo.uploadDriveFile(file);
    setUploading(false);
    if (!r.ok) {
      setUploadError(r.message);
      return;
    }
    /* Submits straight away — an uploaded file has nothing left to type, so
       waiting for a second press of Insert would just be one more click
       between choosing the file and seeing it land. */
    onSubmit(r.data.url);
  }

  return (
    <DocsDialog
      title={isLink ? "Link" : "Insert image"}
      onClose={onClose}
      width={420}
      footer={
        <>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="h-8 rounded-inset px-2.5 text-[12px] text-[var(--state-overdue-ink)] hover:bg-[var(--control)]"
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-inset px-2.5 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!value.trim() || uploading}
            onClick={() => onSubmit(value.trim())}
            className="h-8 rounded-inset bg-ink px-3 text-[12px] text-[var(--body-bg)] disabled:opacity-40"
          >
            {isLink ? "Apply" : "Insert"}
          </button>
        </>
      }
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
        }}
        disabled={uploading}
        placeholder={isLink ? "https://…" : "https://…/picture.png"}
        aria-label={isLink ? "Link address" : "Image address"}
        className="h-9 w-full rounded-inset border border-hairline bg-transparent px-2.5 text-[12.5px] text-ink disabled:opacity-50"
      />

      {canUpload && (
        <>
          <div className="my-2.5 flex items-center gap-2 text-[10.5px] text-ink-faint">
            <span className="h-px flex-1 bg-hairline" />
            or
            <span className="h-px flex-1 bg-hairline" />
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void uploadFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="h-9 w-full rounded-inset border border-dashed border-hairline text-[12.5px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload from your computer"}
          </button>
          {uploadError && (
            <p className="mt-1.5 text-[11.5px] text-[var(--state-overdue-ink)]">{uploadError}</p>
          )}
        </>
      )}

      <p className="mt-2 text-[11.5px] text-ink-faint">
        {isLink
          ? "An address without http:// is treated as https://."
          : canUpload
            ? MAX_IMAGE_BYTES === null
              ? "Uploaded images are stored with the rest of your files, so anyone you share the document with sees them."
              : `Up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Uploaded images are stored with the rest of your files, so anyone you share the document with sees them.`
            : "Images are linked by address. Upload isn't configured on this deployment, so a file from your machine can't be added here."}
      </p>
    </DocsDialog>
  );
}
