import type { TaskAttachment } from "@/lib/domain/tasks";

/**
 * The files on submitted work, as openable links.
 *
 * **One renderer, because two screens must not describe one submission
 * differently.** The reviewer decides on this list and the person who submitted
 * checks it arrived; showing a name on one and a raw URL on the other is how
 * "I attached it" and "there is nothing here" are both true at once.
 *
 * It renders nothing at all when there are no files — an empty list is the
 * ordinary case for work that needs no document, and a "No files" line on every
 * such submission is noise.
 */

function fileGlyph(type: string, name: string): string {
  const t = `${type} ${name}`.toLowerCase();
  if (/(png|jpe?g|gif|webp|avif|heic|image)/.test(t)) return "🖼️";
  if (/pdf/.test(t)) return "📄";
  if (/(docx?|word)/.test(t)) return "📝";
  if (/(xlsx?|sheet|csv)/.test(t)) return "📊";
  return "📎";
}

export function SubmittedFiles({
  files,
  label = "Attached",
}: {
  files: TaskAttachment[];
  label?: string;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[11px] text-ink-faint">
        {label} · {files.length} file{files.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-1.5 space-y-1">
        {files.map((f, i) => (
          <li key={`${f.url}-${i}`}>
            {/* `rel="noopener"` because these are user-supplied URLs opening in
                a new tab — the target must not reach back into this page. */}
            <a
              href={f.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1.5 text-[13px] text-ink underline decoration-[var(--hairline)] underline-offset-2 hover:decoration-current"
            >
              <span aria-hidden>{fileGlyph(f.type, f.name)}</span>
              <span className="truncate">{f.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
