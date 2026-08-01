"use client";

import { useRef, useState } from "react";
import type { MessageAttachment, TaskStatus } from "@/lib/domain";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  EmptyState,
  InlineError,
  Panel,
  Segmented,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";
import {
  MessageAttachments,
  filesFromClipboard,
  formatBytes,
  mediaUrl,
} from "@/components/features/messages/MessageAttachments";

/** Uploads are staged before send; keep the batch bounded, as the thread does. */
const MAX_ATTACHMENTS = 10;

/**
 * Task chat.
 *
 * Two threads, because legacy has two and the distinction is load-bearing:
 * `chat` is the working thread, `draft` is the pre-start negotiation thread
 * where deadline proposals and timer decisions are discussed.
 *
 * The working thread carries real attachments — image, PDF, voice, or any file
 * — the same way the message thread does: each file uploads first, stages in
 * the composer, and rides ONE message document on send, so a failed upload
 * never leaves a half-sent message. The send goes through the engine (not a
 * straight Firestore append) so everyone on the task gets the bell.
 */
export function ChatPanel({
  taskId,
  status,
}: {
  taskId: string;
  status: TaskStatus;
}) {
  /* Legacy's gating, from `app/coworking/tasks/page.js:9080`:
       isPreConfirmed  = !["confirmed","in_progress","done"].includes(status)
       isPostConfirmed =  ["confirmed","in_progress","done"].includes(status)
     The negotiation thread is ACTIVE before confirmation and read-only after —
     it is a record of how the task came to be shaped, and letting people keep
     adding to it once work has started turns it into a second working thread.
     The working thread does not exist at all until confirmation, which is why
     legacy opened on Draft Chat and only rendered the other tab afterwards. */
  const started =
    status === "confirmed" ||
    status === "in_progress" ||
    status === "in_review" ||
    status === "completed";
  const [thread, setThread] = useState<"chat" | "draft">(
    started ? "chat" : "draft",
  );
  const [text, setText] = useState("");
  const repo = useRepo();
  const [pending, setPending] = useState<MessageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* The attach control only appears where the backend actually accepts uploads;
     the in-memory prototype omits `uploadMessageAttachment`, so it stays off
     rather than failing silently. */
  const canUpload = typeof repo.uploadMessageAttachment === "function";

  const { data, isLoading, refetch } = useQuery(
    (r) => r.listTaskChat(taskId, thread),
    [taskId, thread],
  );
  const { data: people } = useQuery((r) => r.listEmployees(), []);
  const [send, state] = useAction((r) =>
    r.sendTaskChat(taskId, thread, text, pending),
  );

  /* Upload is its own step: the file lands on the backend first, then the send
     writes ONE message document carrying the returned attachment — so a failed
     upload never leaves a half-sent message, and the composer keeps the file
     staged until you actually send. */
  async function handleFiles(picked: File[]) {
    if (!repo.uploadMessageAttachment) return;
    const list = picked.slice(0, MAX_ATTACHMENTS);
    setUploadError(null);
    setUploading(true);
    const results = await Promise.all(
      list.map((f) => repo.uploadMessageAttachment!(f)),
    );
    setUploading(false);
    const ready = results
      .filter((r): r is { ok: true; data: MessageAttachment } => r.ok)
      .map((r) => r.data);
    if (ready.length)
      setPending((prev) => [...prev, ...ready].slice(0, MAX_ATTACHMENTS));
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) setUploadError(failed.message);
  }

  const canSend = (text.trim().length > 0 || pending.length > 0) && !uploading;

  async function submit() {
    if (!canSend || state.isPending) return;
    const r = await send();
    if (r.ok) {
      setText("");
      setPending([]);
      setUploadError(null);
      refetch();
    }
  }

  const composerReadOnly = started && thread === "draft";

  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-3">
        <h2 className="text-sm font-medium text-ink">Discussion</h2>
        {/* The working thread appears only once the task has been confirmed —
            before that there is no work to discuss, only terms to agree. */}
        {started ? (
          <Segmented
            label="Thread"
            size="sm"
            value={thread}
            onChange={setThread}
            options={[
              { id: "chat", label: "Working", hint: "The working thread" },
              {
                id: "draft",
                label: "Negotiation",
                hint: "How this task was agreed — read-only now",
              },
            ]}
          />
        ) : (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--state-extension)_18%,transparent)] px-2.5 py-1 text-[11px] text-[var(--state-extension-ink)]">
            Negotiation — agreeing the terms
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="px-5 py-3">
          <SkeletonRows rows={4} />
        </div>
      ) : !data?.length ? (
        <EmptyState
          compact
          title={
            thread === "chat" ? "No messages yet" : "Nothing negotiated here"
          }
          body={
            thread === "chat"
              ? "Discussion about the work in progress lives here."
              : "Deadline proposals and timer decisions post to this thread."
          }
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {data.map((m) => {
            const person = people?.find((p) => p.id === m.senderId);
            const system =
              m.messageType === "system" || m.senderId === "system";
            const attachments = m.attachments ?? [];
            return (
              <li key={m.id} className="flex gap-3 px-5 py-3">
                {system ? (
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--control)] text-ink-faint">
                    <Icon.check className="h-3.5 w-3.5" />
                  </span>
                ) : person ? (
                  <Avatar
                    initials={person.initials}
                    hue={person.hue}
                    name={person.displayName}
                    size="sm"
                  />
                ) : (
                  <span className="h-7 w-7 shrink-0 rounded-full bg-[var(--control)]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-ink">
                      {m.senderName}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </p>
                  {m.text ? (
                    <p
                      className={`mt-0.5 whitespace-pre-wrap text-sm ${system ? "text-ink-faint" : "text-ink-muted"}`}
                    >
                      {m.text}
                    </p>
                  ) : null}
                  {attachments.length > 0 ? (
                    <div className="mt-1.5">
                      <MessageAttachments items={attachments} mine={false} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Read-only once the task is under way: legacy marks the negotiation
          thread "read-only" the moment it reaches confirmed. */}
      {composerReadOnly ? (
        <p className="border-t border-hairline px-5 py-3 text-[11px] text-ink-faint">
          This negotiation closed when the task was confirmed. It is kept as the
          record of what was agreed.
        </p>
      ) : (
        <div className="border-t border-hairline px-5 py-3">
          {state.error && (
            <div className="mb-2">
              <InlineError message={state.error} code={state.errorCode} />
            </div>
          )}
          {uploadError && (
            <div className="mb-2">
              <InlineError compact message={uploadError} />
            </div>
          )}

          {pending.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-[10px] bg-[var(--control)] p-1.5 pe-2 text-xs"
                >
                  {a.kind === "image" ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={mediaUrl(a)}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-[6px] object-cover"
                    />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] bg-[var(--surface-raised)] text-ink-muted">
                      <Icon.attach className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0 max-w-[150px]">
                    <span className="block truncate text-ink">
                      {a.name ?? a.kind}
                    </span>
                    {a.sizeBytes ? (
                      <span className="block text-[11px] text-ink-faint">
                        {formatBytes(a.sizeBytes)}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPending((prev) => prev.filter((_, j) => j !== i))
                    }
                    aria-label="Remove attachment"
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-base leading-none text-ink-muted hover:bg-[var(--surface-raised)] hover:text-ink"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {uploading && (
            <div className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
              <span className="flex gap-0.5" aria-hidden>
                <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint [animation-delay:-200ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint [animation-delay:-100ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-ink-faint" />
              </span>
              Uploading…
            </div>
          )}

          <div className="flex items-end gap-2">
            {canUpload && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf,audio/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    /* Snapshot into a STATIC array before clearing the input.
                       `e.target.files` is a LIVE FileList — clearing `value`
                       empties it out from under us, so capturing the reference
                       and then clearing left `handleFiles` with zero files and
                       the upload silently never started. `Array.from` copies the
                       File objects, which survive. */
                    const list = e.target.files
                      ? Array.from(e.target.files)
                      : [];
                    e.currentTarget.value = "";
                    if (list.length) void handleFiles(list);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || state.isPending}
                  aria-label="Attach a file"
                  title="Attach an image, PDF, or audio file"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
                >
                  <Icon.attach className="h-4 w-4" />
                </button>
              </>
            )}
            <Textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                /* Enter sends, Shift+Enter breaks the line — the convention
                   every messaging product shares. */
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              onPaste={(e) => {
                /* A pasted screenshot or copied file uploads like a picked one;
                   a plain-text paste falls through and still types. */
                if (!canUpload) return;
                const pasted = filesFromClipboard(e.clipboardData);
                if (pasted.length) {
                  e.preventDefault();
                  void handleFiles(pasted);
                }
              }}
              placeholder="Write a message"
              aria-label="Message"
            />
            <Button
              tone="primary"
              disabled={!canSend || state.isPending}
              onClick={submit}
            >
              <Icon.send className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
