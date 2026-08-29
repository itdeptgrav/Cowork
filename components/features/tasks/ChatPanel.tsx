"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MessageAttachment,
  MessageReply,
  TaskChatMessage,
  TaskId,
  TaskStatus,
} from "@/lib/domain";
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
import { useViewerId } from "@/lib/hooks/usePermissions";
import {
  MessageContextMenu,
  type MessageMenuItem,
} from "@/components/features/messages/MessageContextMenu";
import { MessageTicks } from "@/components/features/messages/MessageTicks";
import { ChangeEventCard } from "./ChangeEventCard";
import { formatClock, formatDate } from "@/lib/utils/format";
import { clearDraft, readDraft, saveDraft } from "@/components/features/messages/draftStorage";
import { myReaction, reactionSummary } from "@/lib/rules/messages/reactions";
import { MESSAGE_QUICK_REACTIONS } from "@/lib/domain";
import {
  taskAudience,
  taskChatStatus,
  taskChatStatusLabel,
} from "@/lib/rules/messages/taskChatStatus";
import {
  dragCarriesFiles,
  dragDepth,
  isDropActive,
} from "@/lib/rules/messages/fileDrop";
import {
  MEDIA_BASE,
  MessageAttachments,
  filesFromClipboard,
  formatBytes,
  UploadProgressRow,
  mediaUrl,
} from "@/components/features/messages/MessageAttachments";
import { copyPlan } from "@/lib/rules/media/copyMessage";
import { COPIED_NOTICE, runCopyPlan } from "@/lib/utils/copyToClipboard";

/** Uploads are staged before send; keep the batch bounded, as the thread does. */
const MAX_ATTACHMENTS = 10;

/**
 * Do these two messages belong to one run?
 *
 * The same three conditions the message thread uses, so a run breaks in the
 * same places on both surfaces: same person, same day, and within ten minutes.
 * A gap longer than that is a new thought and deserves its own stamp and face.
 */
function continuesRun(
  a: TaskChatMessage | undefined,
  b: TaskChatMessage | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.senderId !== b.senderId) return false;
  if (a.senderId === "system" || b.senderId === "system") return false;
  if (!sameDayIso(a.createdAt, b.createdAt)) return false;
  const minutes =
    Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) /
    60000;
  return Number.isFinite(minutes) && minutes < 10;
}

/** Whether two ISO stamps fall on the same day, in the viewer's own zone. */
function sameDayIso(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new Date(a);
  const y = new Date(b);
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return false;
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * Task chat.
 *
 * Two threads, because legacy has two and the distinction is load-bearing:
 * `chat` is the working thread, `draft` is the pre-start negotiation thread
 * where deadline proposals and timer decisions are discussed.
 *
 * The working thread carries real attachments — image, video, PDF, audio or any file
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
  /**
   * The unsent message, kept per TASK and per thread.
   *
   * Restored in a lazy initialiser rather than an effect, exactly as the
   * message thread does: switching tabs or leaving the task unmounts this
   * panel, so anything typed and not sent was discarded by React before
   * anybody could notice. Reading storage as the initial value puts it back on
   * the FIRST render, so the composer is never briefly empty.
   *
   * The key is `task:{id}:{thread}` — the working and negotiation threads are
   * different conversations and must not share a draft, and two tasks open in
   * two tabs must not overwrite each other.
   */
  const draftKey = `task:${taskId}:${thread}`;
  const [restored] = useState(() => readDraft(draftKey));
  const [text, setText] = useState(restored?.text ?? "");
  const repo = useRepo();
  const viewerId = useViewerId();
  const [pending, setPending] = useState<MessageAttachment[]>(
    restored?.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /**
   * Files that failed, KEPT — with the `File` itself, not just a message.
   *
   * Without this a failure meant going back to the file picker, which on a
   * large file is the difference between losing seconds and losing minutes.
   * The message thread has had this; the task discussion had only an error
   * string, and dropped the file that produced it.
   */
  const [failedUploads, setFailedUploads] = useState<
    { id: string; file: File; message: string }[]
  >([]);
  /**
   * One entry per file in the batch currently uploading.
   *
   * **A long upload with no progress is indistinguishable from a hung one.**
   * This panel showed three bouncing dots for the whole transfer, so a large
   * file was several minutes of animation that said nothing about whether
   * bytes were moving. The upload itself was never slower than the message
   * thread's — it is the same `uploadDriveFile`, the same direct-to-Drive
   * session — it simply refused to say so.
   */
  const [uploadProgress, setUploadProgress] = useState<
    { id: string; name: string; sizeBytes: number; fraction: number }[]
  >([]);
  /* Counted, not a boolean — see dragDepth. */
  const [dragDepthState, setDragDepthState] = useState(0);
  /** The message a right-click opened a menu on, and where the pointer was. */
  const [menu, setMenu] = useState<{
    message: TaskChatMessage;
    x: number;
    y: number;
  } | null>(null);
  /** The message being edited, if any — its text loads into the composer. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The message being answered, quoted above the composer. */
  const [replyingTo, setReplyingTo] = useState<MessageReply | null>(
    restored?.replyTo ?? null,
  );
  /**
   * Messages drawn from what was typed, before the engine has confirmed them.
   * See the note in `submit` — the task path is two hops, not one.
   */
  const [sending, setSending] = useState<TaskChatMessage[]>([]);
  /** One-line confirmations that do not deserve an error banner. */
  const [notice, setNotice] = useState<string | null>(null);
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
  const me = people?.find((p) => p.id === viewerId);
  /**
   * What the thread draws: what the engine has, plus what is still on its way.
   *
   * Appended rather than merged, because an unconfirmed message has no place in
   * the stored order yet — it is the newest thing there is until it lands.
   *
   * **Dropped as soon as the real one appears, not when the send resolves.**
   * The two are not the same moment and assuming they were is what showed the
   * message twice for a second or two: the write triggers a refetch of its own,
   * so the stored message can arrive BEFORE the promise that would have cleared
   * the copy. Waiting for the promise instead leaves a gap where neither is
   * drawn. Matching on content is the only thing that holds for every ordering —
   * the copy is drawn until its counterpart is genuinely on screen, and not one
   * frame longer.
   */
  const landed = useMemo(() => {
    const byKey = new Set<string>();
    for (const m of data ?? []) {
      if (m.senderId !== viewerId) continue;
      byKey.add(`${m.text} ${m.attachmentIds.length}`);
    }
    return byKey;
  }, [data, viewerId]);

  const shown = useMemo(() => {
    const stored = data ?? [];
    if (!sending.length) return stored;
    const waiting = sending.filter(
      (m) => !landed.has(`${m.text} ${m.attachmentIds.length}`),
    );
    return waiting.length ? [...stored, ...waiting] : stored;
  }, [data, sending, landed]);
  /* Who can see this thread, for the read tick. Read from the task rather than
     from who has posted: somebody who has not spoken yet is still an audience,
     and a tick that ignored them would claim more than it knows. */
  const { data: taskView } = useQuery((r) => r.getTask(taskId as TaskId), [taskId]);
  const audience = taskAudience({
    assignorId: taskView?.assigner?.id ?? null,
    assigneeIds: (taskView?.assignees ?? []).map((a) => a.id),
  });
  const [send, state] = useAction((r) =>
    r.sendTaskChat(taskId, thread, text, pending, replyingTo),
  );

  /**
   * Somebody else's message arrives on its own.
   *
   * **The thread had no live channel at all.** It read once on mount and again
   * after each of the viewer's own writes, so a colleague's reply did not show
   * up until something unrelated happened to refetch — two people on one task
   * each watching their own half of the conversation.
   *
   * `watchTaskChat` is a Firestore `onSnapshot` on the same subcollection the
   * panel already reads, so there is no second delivery path to keep in step.
   * Optional on the repository: a backend without one simply omits it and the
   * thread keeps working from its own reads.
   */
  useEffect(
    () => repo.watchTaskChat?.(taskId as TaskId),
    [repo, taskId],
  );

  /**
   * Tell the senders their messages were read.
   *
   * Fired when the WORKING thread's messages arrive, not on mount: the
   * negotiation tab is a different thread, and stamping it would record a read
   * on messages nobody had looked at.
   *
   * `markTaskChatRead` skips the viewer's own rows and writes only where they
   * are missing, so this settles after one pass rather than answering its own
   * write for ever. The dependency is `data?.length` rather than `data` for the
   * same reason — a refetch returns a new array every time.
   */
  useEffect(() => {
    if (thread !== "chat" || !data?.length || !repo.markTaskChatRead) return;
    void repo.markTaskChatRead(taskId as TaskId).then((r) => {
      if (r.ok) refetch();
    });
  }, [repo, taskId, thread, data?.length, refetch]);

  /**
   * Keep the draft written as it changes.
   *
   * Not while editing: the composer then holds a message that already exists,
   * and storing it as a draft would restore somebody into an edit of a message
   * they had walked away from — with no edit bar to explain why their box was
   * full. `saveDraft` removes the key when there is nothing left, so clearing
   * the composer clears the draft rather than storing emptiness.
   */
  useEffect(() => {
    if (editingId) return;
    saveDraft(draftKey, { text, attachments: pending, replyTo: replyingTo });
  }, [draftKey, text, pending, replyingTo, editingId]);

  /* Upload is its own step: the file lands on the backend first, then the send
     writes ONE message document carrying the returned attachment — so a failed
     upload never leaves a half-sent message, and the composer keeps the file
     staged until you actually send. */
  async function handleFiles(picked: File[]) {
    if (!repo.uploadMessageAttachment) return;
    const list = picked.slice(0, MAX_ATTACHMENTS);
    setUploadError(null);
    setUploading(true);

    /* One id per file, stable for the life of this batch — the progress
       callback closes over it rather than an index, since the batch's own
       order never changes but a re-render could otherwise recompute one. */
    const batch = list.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
    }));
    setUploadProgress(
      batch.map((b) => ({
        id: b.id,
        name: b.file.name,
        sizeBytes: b.file.size,
        fraction: 0,
      })),
    );

    const results = await Promise.all(
      batch.map(({ id, file }) =>
        repo.uploadMessageAttachment!(file, (fraction) =>
          setUploadProgress((prev) =>
            prev.map((p) => (p.id === id ? { ...p, fraction } : p)),
          ),
        ),
      ),
    );
    setUploading(false);
    setUploadProgress([]);

    /* Paired with the batch by INDEX rather than filtered, because a failure
       has to be traced back to the File that produced it — that file is what
       the retry re-sends, and dropping it is what used to send somebody back
       to the file picker. `Promise.all` preserves order, so the index holds. */
    const ready: MessageAttachment[] = [];
    const failures: { id: string; file: File; message: string }[] = [];
    results.forEach((r, i) => {
      if (r.ok) ready.push(r.data);
      else failures.push({ id: batch[i].id, file: batch[i].file, message: r.message });
    });

    if (ready.length)
      setPending((prev) => [...prev, ...ready].slice(0, MAX_ATTACHMENTS));
    /* Appended, not replaced: a retry of two files where one fails again must
       not discard the other one still waiting. */
    if (failures.length) setFailedUploads((prev) => [...prev, ...failures]);
    setUploadError(failures.length ? failures[0].message : null);
  }

  /**
   * Send the failed files again — and only those.
   *
   * **The list is cleared BEFORE the retry, not after.** `handleFiles` appends
   * whatever fails to it, so clearing afterwards would wipe the fresh failures
   * it had just recorded and the retry button would vanish from files that are
   * still broken.
   *
   * Nothing already in `pending` is touched, which is what stops a retry
   * duplicating: a file that uploaded is a `MessageAttachment` in `pending` and
   * is not in this list at all, so it is never sent to Drive twice.
   */
  async function retryFailedUploads() {
    if (uploading || failedUploads.length === 0) return;
    const again = failedUploads.map((f) => f.file);
    setFailedUploads([]);
    setUploadError(null);
    await handleFiles(again);
  }

  /* ── Acting on one message ──────────────────────────────────────────────
   *
   * The same set the message thread offers, built the same way: every entry is
   * always PRESENT and disabled with a stated reason where it does not apply.
   * A missing option reads as a fault; a greyed one with "You can only delete
   * your own messages" beside it reads as a rule.
   *
   * Each capability is also gated on the repository actually having the method,
   * so the in-memory prototype — which has none of them — shows a shorter menu
   * rather than one that throws when pressed.
   */

  function startReply(m: TaskChatMessage) {
    setEditingId(null);
    setReplyingTo({ messageId: m.id, senderName: m.senderName, text: m.text });
    setMenu(null);
  }

  function startEdit(m: TaskChatMessage) {
    setReplyingTo(null);
    setEditingId(m.id);
    setText(m.text);
    setMenu(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setText("");
  }

  /**
   * Copy a message — the caption AND the picture, in one clipboard write.
   *
   * The decision is `copyPlan`'s and the bytes are `runCopyPlan`'s, both shared
   * with `MessagesArea` so a task's discussion and a conversation cannot come
   * to disagree about what Copy means. What actually landed is reported rather
   * than a flat "Copied.": a picture that could not be fetched still puts the
   * caption on the clipboard, and somebody pasting into a document needs to
   * know which half arrived.
   */
  async function copyMessage(m: TaskChatMessage) {
    setMenu(null);
    const out = await runCopyPlan(copyPlan(m), MEDIA_BASE);
    setNotice(out.ok ? COPIED_NOTICE[out.copied] : out.message);
  }

  async function toggleStar(m: TaskChatMessage) {
    setMenu(null);
    if (!repo.toggleTaskChatStar) return;
    const r = await repo.toggleTaskChatStar(taskId as TaskId, m.id);
    if (r.ok) refetch();
    else setNotice(r.message);
  }

  async function react(m: TaskChatMessage, emoji: string) {
    setMenu(null);
    if (!repo.toggleTaskChatReaction) return;
    const r = await repo.toggleTaskChatReaction(taskId as TaskId, m.id, emoji);
    if (r.ok) refetch();
    else setNotice(r.message);
  }

  async function removeMessage(m: TaskChatMessage) {
    setMenu(null);
    if (!repo.deleteTaskChat) return;
    const r = await repo.deleteTaskChat(taskId as TaskId, m.id);
    if (r.ok) refetch();
    else setNotice(r.message);
  }

  function menuFor(m: TaskChatMessage): MessageMenuItem[] {
    const mine = m.senderId === viewerId;
    const deleted = m.isDeleted === true;
    const starred = Boolean(viewerId && (m.starredBy ?? []).includes(viewerId));
    const gone = "This message was deleted.";
    const copy = copyPlan(m);
    return [
      {
        id: "reply",
        label: "Reply",
        disabled: deleted,
        reason: deleted ? gone : undefined,
        run: () => startReply(m),
      },
      /* Label, availability and reason all come from the one rule, so a message
         carrying a screenshot and no caption offers "Copy image" here and in
         Messages rather than being greyed out in both. */
      {
        id: "copy",
        label: copy.label,
        disabled: copy.disabled,
        reason: copy.reason ?? undefined,
        run: () => void copyMessage(m),
      },
      ...(repo.toggleTaskChatStar
        ? [
            {
              id: "star",
              label: starred ? "Unstar" : "Star",
              disabled: deleted && !starred,
              reason: deleted && !starred ? gone : undefined,
              run: () => void toggleStar(m),
            },
          ]
        : []),
      ...(mine && repo.editTaskChat
        ? [
            {
              id: "edit",
              label: "Edit",
              disabled: deleted,
              reason: deleted ? gone : undefined,
              run: () => startEdit(m),
            },
          ]
        : []),
      ...(repo.deleteTaskChat
        ? [
            {
              id: "delete",
              label: "Delete",
              danger: true,
              disabled: !mine || deleted,
              reason: deleted
                ? "This message was already deleted."
                : !mine
                  ? "You can only delete your own messages."
                  : undefined,
              run: () => void removeMessage(m),
            },
          ]
        : []),
    ];
  }

  const canSend = (text.trim().length > 0 || pending.length > 0) && !uploading;

  async function submit() {
    /* An edit is a different write from a send, and it is checked first: the
       composer is the same box, so without this an edit would post a NEW
       message carrying the edited text and leave the original untouched. */
    if (editingId) {
      if (!repo.editTaskChat || !text.trim()) return;
      const r = await repo.editTaskChat(taskId as TaskId, editingId, text);
      if (r.ok) {
        cancelEdit();
        refetch();
      } else setNotice(r.message);
      return;
    }
    if (!canSend || state.isPending) return;

    /**
     * **Shown before it has landed, because the round trip is long here.**
     *
     * A direct message is written to Firestore by the browser. A task message
     * is not: it goes to the engine first, which writes the document AND sends
     * everyone on the task their notification — so the path is browser →
     * backend → Firestore → back, and only then does the refetch that makes it
     * appear. Two hops and two reads before a line of text shows up, which is
     * what made pressing Send feel slow.
     *
     * The hop is not the thing to remove; it is what delivers the bell. So the
     * message is drawn immediately from what was typed, and reconciled when
     * the real one arrives. If the send fails, this is taken back and the
     * composer is restored exactly as it was — nothing is lost, which is what
     * makes clearing the box up front safe.
     */
    const draft = {
      text: text.trim(),
      attachments: pending,
      replyTo: replyingTo,
    };
    const optimistic: TaskChatMessage = {
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      taskId: taskId as TaskId,
      thread,
      senderId: (viewerId ?? "") as TaskChatMessage["senderId"],
      senderName: me?.displayName ?? "",
      text: draft.text,
      attachmentIds: draft.attachments.map((a) => a.url),
      attachments: draft.attachments.length ? draft.attachments : undefined,
      messageType: draft.attachments.length ? "attachment" : "text",
      createdAt: new Date().toISOString(),
      replyToId: draft.replyTo?.messageId ?? null,
      replyTo: draft.replyTo,
    };

    setSending((prev) => [...prev, optimistic]);
    setText("");
    setPending([]);
    setReplyingTo(null);
    setUploadError(null);

    const r = await send();

    /* Dropped either way: on success the refetch below brings the real one, and
       on failure there is nothing to show. Keeping it would leave a message on
       screen that does not exist. */
    setSending((prev) => prev.filter((m) => m.id !== optimistic.id));

    if (r.ok) {
      clearDraft(draftKey);
      refetch();
      return;
    }

    /* Put it back exactly as it was, so the retry is pressing Send again
       rather than typing it out a second time. */
    setText(draft.text);
    setPending(draft.attachments);
    setReplyingTo(draft.replyTo);
  }

  const composerReadOnly = started && thread === "draft";
  /* A closed negotiation thread renders no composer at all, so a file dropped
     on it would upload and then have nowhere to go — staged into a box that is
     not on screen and can never be sent. */
  const canDrop = canUpload && !composerReadOnly;

  return (
    <Panel
      padded={false}
      className="relative"
      /* The same drop behaviour as the message thread, and for the same
         reason — this panel already shares that composer's paste handler, its
         upload path and its attachment rendering. */
      onDragEnter={(e) => {
        if (!canDrop || !dragCarriesFiles(e.dataTransfer?.types)) return;
        setDragDepthState((d) => dragDepth(d, "enter"));
      }}
      onDragOver={(e) => {
        if (!canDrop || !dragCarriesFiles(e.dataTransfer?.types)) return;
        /* Or the browser navigates to the file instead of dropping it. */
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!canDrop || !dragCarriesFiles(e.dataTransfer?.types)) return;
        setDragDepthState((d) => dragDepth(d, "leave"));
      }}
      onDrop={(e) => {
        if (!canDrop || !dragCarriesFiles(e.dataTransfer?.types)) return;
        e.preventDefault();
        setDragDepthState((d) => dragDepth(d, "drop"));
        const dropped = filesFromClipboard(e.dataTransfer);
        if (dropped.length) void handleFiles(dropped);
      }}
    >
      {isDropActive(dragDepthState) && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-card bg-[color-mix(in_srgb,var(--body-bg)_78%,transparent)] backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 rounded-panel border border-dashed border-ink/40 px-8 py-6">
            <Icon.attach className="h-5 w-5 text-ink-muted" />
            <p className="text-sm font-medium text-ink">Drop to attach</p>
            <p className="text-[11px] text-ink-faint">
              Any file, up to {MAX_ATTACHMENTS} at a time
            </p>
          </div>
        </div>
      )}
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
        <ol className="flex flex-col gap-0.5 px-3 py-3 sm:px-4">
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const next = shown[i + 1];
            const system =
              m.messageType === "system" || m.senderId === "system";
            const mine = !system && m.senderId === viewerId;
            const person = people?.find((p) => p.id === m.senderId);
            const deleted = m.isDeleted === true;
            const attachments = m.attachments ?? [];

            /* A run is one person talking without interruption. The avatar
               leads it and the time closes it, so a fast exchange is not a
               column of near-identical stamps beside near-identical faces. */
            const sameRun = continuesRun(prev, m);
            const endsRun = !continuesRun(m, next);
            const newDay = !prev || !sameDayIso(prev.createdAt, m.createdAt);
            /* Still travelling: drawn from what was typed, not yet stored. */
            const unsent = m.id.startsWith("pending-");

            const chips = reactionSummary(
              m.reactions,
              viewerId ?? "",
              MESSAGE_QUICK_REACTIONS,
            );
            const starred = Boolean(
              viewerId && (m.starredBy ?? []).includes(viewerId),
            );

            return (
              <li key={m.id}>
                {newDay && (
                  <div className="flex items-center gap-3 py-3">
                    <span className="h-px flex-1 bg-hairline" />
                    <span
                      data-figure
                      className="shrink-0 text-[11px] tracking-[0.02em] text-ink-faint"
                    >
                      {formatDate(m.createdAt)}
                    </span>
                    <span className="h-px flex-1 bg-hairline" />
                  </div>
                )}

                {system ? (
                  /* The engine's own record. A requirement/ET change renders as
                     a card people notice — it rewrites the brief of live work;
                     everything else (an approval, a deadline decision) stays the
                     quiet centred line. `ChangeEventCard` decides which, from the
                     message text, and falls back to the quiet line itself.
                     `by`/`at` give it the same who-and-when a message carries —
                     the sender's name resolved to a person where we have one. */
                  <ChangeEventCard
                    text={m.text}
                    by={person?.displayName ?? m.senderName}
                    at={m.createdAt}
                  />
                ) : (
                  <div
                    className={`flex flex-col ${mine ? "items-end" : "items-start"} ${
                      sameRun ? "mt-0.5" : "mt-3 first:mt-0"
                    }`}
                  >
                    {/* A task thread always has more than two people in it, so
                        the name leads every run from somebody else — as a group
                        conversation does, and unlike a direct message where it
                        would only repeat the header. */}
                    {!mine && !sameRun && (
                      <span className="mb-1 ps-9 text-[11px] text-ink-faint">
                        {person?.displayName ?? m.senderName}
                      </span>
                    )}

                    <div
                      /* On the ROW, not the bubble: a menu that opens only on
                         the coloured rectangle is one people think is broken
                         when they aim slightly wide. */
                      /* Nothing to act on until it exists: a reply or a delete
                         aimed at an id the engine has never seen would fail,
                         and the message is only on screen for a moment. */
                      onContextMenu={
                        unsent
                          ? undefined
                          : (e) => {
                              e.preventDefault();
                              setMenu({ message: m, x: e.clientX, y: e.clientY });
                            }
                      }
                      /* 88% on a phone, 78% from `sm` up: the desktop figure is
                         a line-length decision and a phone has no length to
                         spare — at 360px a 78% cap broke short sentences over
                         two lines. */
                      className={`flex max-w-[min(88%,60ch)] items-end gap-2 sm:max-w-[min(78%,60ch)] ${
                        mine ? "flex-row-reverse" : ""
                      }`}
                    >
                      {/* Always present so every bubble in a run keeps one
                          edge; only the picture is conditional. Empty it has no
                          height, so `items-end` seats it on the bubble. */}
                      <span className="w-7 shrink-0">
                        {!mine && !sameRun && person && (
                          <Avatar
                            initials={person.initials}
                            hue={person.hue}
                            src={person.profilePictureUrl}
                            name={person.displayName}
                            size="sm"
                          />
                        )}
                      </span>

                      {/* A column rather than the bubble itself: the reaction
                          pills sit BELOW it and overlap its bottom edge, which
                          needs a sibling under the bubble rather than a row
                          inside it stretching the bubble taller. */}
                      <span
                        className={`flex min-w-0 flex-col ${
                          mine ? "items-end" : "items-start"
                        }`}
                      >
                        <span
                          /* Faded while it is in flight — visibly there, and
                             visibly not settled — then solid the moment the
                             real one replaces it. */
                          className={`flex min-w-0 flex-col gap-1.5 rounded-inset px-3.5 py-2 text-sm leading-relaxed transition-opacity ${
                            unsent ? "opacity-60" : ""
                          } ${
                            mine
                              ? "bg-ink text-[var(--body-bg)]"
                              : "bg-[var(--surface-raised)] text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)]"
                          }`}
                        >
                          {m.replyTo && !deleted && (
                            <span
                              className={`block rounded-[8px] border-s-2 px-2 py-1 ${
                                mine
                                  ? "border-white/50 bg-white/10"
                                  : "border-ink-faint/50 bg-black/[0.04]"
                              }`}
                            >
                              <span className="block text-[11px] font-medium opacity-80">
                                {m.replyTo.senderName}
                              </span>
                              <span className="block truncate text-xs opacity-70">
                                {m.replyTo.text || "attachment"}
                              </span>
                            </span>
                          )}

                          {!deleted && attachments.length > 0 && (
                            <MessageAttachments items={attachments} mine={mine} />
                          )}

                          {(m.text || deleted) && (
                            <span
                              /* `anywhere`, not `break-word`: a pasted token or
                                 URL is one indivisible word, and `break-word`
                                 leaves min-content measured on it — so the
                                 bubble cannot shrink and the whole thread grows
                                 a horizontal scrollbar because of one message. */
                              className={`[overflow-wrap:anywhere] whitespace-pre-wrap ${
                                deleted ? "italic opacity-60" : ""
                              }`}
                            >
                              {deleted ? "This message was deleted." : m.text}
                            </span>
                          )}
                        </span>

                        {/* Floating half over the bubble's bottom edge, the way
                            every chat draws them. The star is only ever the
                            viewer's own — a private bookmark. */}
                        {!deleted && (chips.length > 0 || starred) && (
                          <span
                            className={`relative z-[1] -mt-2 flex flex-wrap items-center gap-1 px-1 ${
                              mine ? "justify-end" : ""
                            }`}
                          >
                            {chips.map((chip) => (
                              <button
                                key={chip.emoji}
                                type="button"
                                disabled={!repo.toggleTaskChatReaction}
                                onClick={() => void react(m, chip.emoji)}
                                aria-pressed={chip.mine}
                                aria-label={`${chip.emoji} ${chip.count}, ${
                                  chip.mine
                                    ? "including you — press to remove yours"
                                    : "press to react too"
                                }`}
                                className={`flex items-center gap-1 rounded-full border border-hairline bg-[var(--surface-raised)] px-1.5 py-[3px] text-[12px] leading-none text-ink shadow-sm ${
                                  chip.mine ? "ring-1 ring-ink/30" : ""
                                } ${repo.toggleTaskChatReaction ? "" : "cursor-default"}`}
                              >
                                <span aria-hidden>{chip.emoji}</span>
                                {chip.count > 1 && (
                                  <span
                                    data-figure
                                    aria-hidden
                                    className="text-[11px] text-ink-muted"
                                  >
                                    {chip.count}
                                  </span>
                                )}
                              </button>
                            ))}
                            {starred && (
                              <span
                                role="img"
                                aria-label="You starred this message"
                                title="Starred"
                                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-hairline bg-[var(--surface-raised)] text-[11px] text-ink-muted shadow-sm"
                              >
                                ★
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* On the LAST message of a run only. A stamp against every
                        line turns a fast exchange into a column of numbers, and
                        the one people look for is when the other person
                        stopped. The 36px inset is the avatar column plus its
                        gap, so name, bubble and time share one edge. */}
                    {endsRun && (
                      <span
                        data-figure
                        className={`mt-1 flex items-center gap-1 text-[11px] text-ink-faint ${
                          mine ? "pe-9" : "ps-9"
                        }`}
                      >
                        {unsent ? "Sending…" : formatClock(m.createdAt)}
                        {m.editedAt && !deleted ? " · edited" : ""}
                        {/* The message thread's own ticks — one, two, two blue.
                            This drew a pair of literal "✓✓" characters in the
                            green that means "positive" everywhere else in the
                            product, which is a third convention for a state
                            that is not a success. The words are supplied here
                            rather than taken from the component's default,
                            because "Delivered" is a claim about somebody's
                            device that a task thread cannot make. */}
                        {mine && !deleted && !unsent && (
                          <MessageTicks
                            status={taskChatStatus(m, viewerId, audience)}
                            label={taskChatStatusLabel(
                              taskChatStatus(m, viewerId, audience),
                              audience.length,
                            )}
                          />
                        )}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
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
          {/* The file is kept, so this offers a button rather than sending
              somebody back to the picker. Retrying re-sends only what failed:
              anything already uploaded is a `MessageAttachment` in `pending`
              and is not in this list at all, so nothing goes to Drive twice. */}
          {/* What the composer is doing, when it is not simply composing.
              Both bars carry their own way out, because Escape alone is not
              discoverable and a composer that has silently become an editor is
              how somebody edits a message they meant to reply to. */}
          {replyingTo && !editingId && (
            <div className="mb-2 flex items-start gap-2 rounded-[10px] border-s-2 border-ink-faint/50 bg-[var(--control)] px-2.5 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">
                  Replying to {replyingTo.senderName}
                </div>
                <div className="truncate text-ink-muted">{replyingTo.text}</div>
              </div>
              <button
                type="button"
                onClick={() => setReplyingTo(null)}
                aria-label="Cancel reply"
                className="shrink-0 text-ink-faint hover:text-ink"
              >
                ×
              </button>
            </div>
          )}
          {editingId && (
            <div className="mb-2 flex items-center gap-2 rounded-[10px] bg-[var(--control)] px-2.5 py-1.5 text-xs">
              <span className="min-w-0 flex-1 text-ink">Editing your message</span>
              <button
                type="button"
                onClick={cancelEdit}
                className="shrink-0 text-ink-faint hover:text-ink"
              >
                Cancel
              </button>
            </div>
          )}

          {notice && (
            <div className="mb-2 text-[11px] text-ink-faint" role="status">
              {notice}
            </div>
          )}

          {failedUploads.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-inset bg-[var(--surface-sunken)] px-2.5 py-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
                {failedUploads.length === 1
                  ? `“${failedUploads[0].file.name}” did not upload.`
                  : `${failedUploads.length} files did not upload.`}
              </span>
              <button
                type="button"
                onClick={retryFailedUploads}
                disabled={uploading}
                className="shrink-0 rounded-full bg-ink px-2.5 py-1 text-[11px] text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {uploading ? "Retrying…" : "Retry"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFailedUploads([]);
                  setUploadError(null);
                }}
                className="shrink-0 text-[11px] text-ink-faint hover:text-ink"
              >
                Discard
              </button>
            </div>
          )}

          {/* Only where there is no Retry beside it — the box above already
              carries the reason, and two statements of one failure reads as
              two failures. */}
          {uploadError && failedUploads.length === 0 && (
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
          {/* A real bar per file, driven by bytes actually sent — see
              `uploadProgress`. The bouncing dots that used to sit here said
              only "something is happening", which over four minutes of a large
              file is not enough to tell working from hung. */}
          {uploadProgress.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {uploadProgress.map((p) => (
                <UploadProgressRow key={p.id} name={p.name} fraction={p.fraction} />
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            {canUpload && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  /* No `accept` — the same change as the Messages composer, and
                     for the same reason. This panel renders through
                     `MessageAttachments` too, so leaving the filter here would
                     have meant a video plays in a task thread but cannot be
                     picked in one. */
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
                  title="Attach a file — any type, any size"
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

      {/* The same menu component the message thread opens, so the two cannot
          drift into offering different actions with different wording. Its
          emoji bar is present only where the repository can actually store a
          reaction — a picker that silently does nothing is worse than none. */}
      {menu && (
        <MessageContextMenu
          x={menu.x}
          y={menu.y}
          items={menuFor(menu.message)}
          reactions={
            repo.toggleTaskChatReaction && !menu.message.isDeleted
              ? {
                  emojis: MESSAGE_QUICK_REACTIONS,
                  selected: myReaction(menu.message.reactions, viewerId ?? ""),
                  onPick: (emoji) => void react(menu.message, emoji),
                }
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  );
}
