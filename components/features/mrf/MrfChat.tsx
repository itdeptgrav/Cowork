"use client";

import { useState } from "react";
import { Button, Input, SkeletonRows } from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDateTime } from "@/lib/utils/format";

/**
 * The shared thread on one request — requester, approver and store. Kept small:
 * a message list and a box. Live push is a later refinement; sending refetches.
 */
export function MrfChat({ mrfId }: { mrfId: string }) {
  const viewerId = useViewerId();
  const { data, isLoading, refetch } = useQuery(
    (r) => r.listMrfChat(mrfId),
    [mrfId],
  );
  const [text, setText] = useState("");
  const [send, state] = useAction((r, body: string) =>
    r.sendMrfChat(mrfId, body),
  );

  const submit = async () => {
    if (!text.trim()) return;
    const res = await send(text);
    if (res.ok) {
      setText("");
      refetch();
    }
  };

  return (
    <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] p-3">
      {isLoading ? (
        <SkeletonRows rows={2} />
      ) : !data?.length ? (
        <p className="text-[11px] text-ink-faint">No messages yet.</p>
      ) : (
        <ul className="max-h-[220px] space-y-2 overflow-y-auto scroll-slim">
          {data.map((m) => {
            const mine = m.senderId && m.senderId === viewerId;
            if (m.isSystem)
              return (
                <li key={m.id} className="text-center text-[11px] text-ink-faint">
                  {m.body}
                </li>
              );
            return (
              <li
                key={m.id}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <span className="text-[10px] text-ink-faint">
                  {m.senderName}
                  {m.senderRole === "store"
                    ? " · Store"
                    : m.senderRole === "tl"
                      ? " · Manager"
                      : ""}
                </span>
                <span
                  className={`mt-0.5 max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] ${
                    mine
                      ? "bg-ink text-[var(--body-bg)]"
                      : "bg-[var(--control)] text-ink"
                  }`}
                >
                  {m.body}
                </span>
                <span className="mt-0.5 text-[10px] text-ink-faint">
                  {formatDateTime(m.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the store…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Button loading={state.isPending}
          size="sm"
          tone="primary"
          disabled={!text.trim() || state.isPending}
          onClick={submit}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
