"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icons";
import type { PairedTaskChat } from "@/lib/rules/messages/taskChats";

/**
 * What the task actually asks for, under the tab that names it.
 *
 * ## Why it is here and not on the task page
 *
 * It IS on the task page, and that is the problem this closes. The thread in a
 * direct message is now often the first place a task is seen, and until you
 * know what was asked for you cannot judge a single message in it — so the one
 * question every reader has on arriving was the one thing that needed a
 * navigation away and back.
 *
 * ## Closed by default, and that is not a compromise
 *
 * A brief can run several paragraphs, and a conversation is what this pane is
 * for. Open by default would push the newest message off the bottom of a short
 * pane to show text that does not change — the thread would open on the one
 * thing in it that is never new. So it is a disclosure: one line at rest, the
 * whole brief when asked for.
 *
 * ## What it does not try to be
 *
 * The deliverables are listed and nothing more — no dependency graph, no
 * per-output approval state, no controls. Those belong on the task, where
 * there is room to be honest about them. A 280px column that showed a
 * half-version of an approval chain would invite somebody to act on it.
 */
export function TaskChatBrief({ chat }: { chat: PairedTaskChat }) {
  const [open, setOpen] = useState(false);
  const hasBrief = Boolean(chat.description?.trim());
  const outputs = chat.outputs;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-ink-faint transition-colors duration-[180ms] ease-[var(--ease-deck)] hover:bg-[var(--control)] hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <Icon.chevronRight
          aria-hidden
          className={`h-3 w-3 shrink-0 transition-transform duration-[180ms] ${
            open ? "rotate-90" : ""
          }`}
        />
        {/* Says what is inside rather than "Details", so a reader can decide
            whether to open it without opening it. The counts do the same job:
            "Deliverables (3)" answers a question that would otherwise cost a
            click, and "no deliverables" is itself worth knowing. */}
        <span className="truncate">
          Brief
          {outputs.length > 0 && (
            <>
              {" · "}
              <span data-figure>{outputs.length}</span>
              {outputs.length === 1 ? " deliverable" : " deliverables"}
            </>
          )}
        </span>
        {/* Which way round the task runs. On the closed row because it is one
            word and it is the thing that changes how every message in the
            thread reads. */}
        <span className="ms-auto shrink-0 ps-2">
          {chat.mine ? "yours to do" : "you assigned it"}
          {chat.isProvisional && " · not accepted yet"}
        </span>
      </button>

      {open && (
        <div className="mt-1 space-y-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5">
          <section>
            <h3 className="text-[10px] tracking-[0.09em] text-ink-faint uppercase">
              Brief
            </h3>
            {hasBrief ? (
              /* `whitespace-pre-wrap` so the paragraphs somebody typed survive.
                 A brief collapsed into one block is a different document. */
              <p className="mt-1 max-w-[68ch] text-[11px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                {chat.description}
              </p>
            ) : (
              /* Never an empty section. "Nothing was written" is a fact about
                 the task; a blank space is a fault in the screen. */
              <p className="mt-1 text-[11px] text-ink-faint">
                No brief was written for this task.
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[10px] tracking-[0.09em] text-ink-faint uppercase">
              Deliverables
            </h3>
            {outputs.length > 0 ? (
              <ol className="mt-1 space-y-1">
                {outputs.map((o, i) => (
                  <li
                    key={o.id}
                    className="flex gap-2 text-[11px] leading-relaxed text-ink-muted"
                  >
                    <span
                      data-figure
                      aria-hidden
                      className="shrink-0 text-ink-faint"
                    >
                      {i + 1}.
                    </span>
                    <span className="min-w-0">{o.label}</span>
                  </li>
                ))}
              </ol>
            ) : (
              /* Not a defect: most tasks are delivered whole rather than
                 output by output, and saying so is what stops a reader
                 hunting for a list that was never meant to exist. */
              <p className="mt-1 text-[11px] text-ink-faint">
                None listed — this task is delivered as a whole.
              </p>
            )}
          </section>

          {/* The way to everything this deliberately leaves out. */}
          <Link
            href={`/tasks/${chat.taskId}`}
            className="inline-flex items-center gap-1 text-[11px] text-ink-muted transition-colors hover:text-ink"
          >
            Open the task
            <Icon.chevronRight aria-hidden className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}
