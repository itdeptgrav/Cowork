"use client";

import { useState } from "react";
import type { TaskStatus } from "@/lib/domain";
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
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";

/**
 * Task chat.
 *
 * Two threads, because legacy has two and the distinction is load-bearing:
 * `chat` is the working thread, `draft` is the pre-start negotiation thread
 * where deadline proposals and timer decisions are discussed.
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
  const { data, isLoading, refetch } = useQuery(
    (r) => r.listTaskChat(taskId, thread),
    [taskId, thread],
  );
  const { data: people } = useQuery((r) => r.listEmployees(), []);
  const [send, state] = useAction((r) =>
    r.sendTaskChat(taskId, thread, text, []),
  );

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
                  <p
                    className={`mt-0.5 text-sm ${system ? "text-ink-faint" : "text-ink-muted"}`}
                  >
                    {m.text}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Read-only once the task is under way: legacy marks the negotiation
          thread "read-only" the moment it reaches confirmed. */}
      {started && thread === "draft" ? (
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
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write a message"
              aria-label="Message"
            />
            <Button
              tone="primary"
              disabled={state.isPending || !text.trim()}
              onClick={async () => {
                const r = await send();
                if (r.ok) {
                  setText("");
                  refetch();
                }
              }}
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
