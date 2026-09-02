"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import {
  Button,
  Chip,
  InlineError,
  Input,
  Panel,
  PanelHead,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import {
  formatDateTime,
  formatDurationTimer,
} from "@/lib/utils/format";
import type { EmergencyRequest } from "@/lib/domain";

/**
 * Emergency Mode requests waiting on this manager.
 *
 * The successor to legacy's `EmergencyApprovalsPanel`, which subscribed to
 * `cowork_emergency_approvals` from the browser and, on approve, rewrote every
 * one of the employee's due dates client-side. Both halves now go through the
 * repository: the list is scoped server-side to requests naming this person as
 * the decider, and approving applies the shift through the same
 * `#extendDeadline` a negotiated extension uses.
 *
 * It renders nothing when the queue is empty — legacy did the same, and it is
 * right: a panel that says "no requests" on every visit is a panel people stop
 * reading.
 *
 * Everything a decision needs is on the card, because the manager has no other
 * screen for this: who, when it started, when it ended, how long, why, and the
 * document they attached.
 */
export function EmergencyApprovals() {
  const queue = useQuery((r) => r.listEmergencyRequests("to_decide"), []);
  const pending = (queue.data ?? []).filter((r) => r.status === "pending");

  if (queue.isLoading || pending.length === 0) return null;

  return (
    <Panel>
      <PanelHead
        title="Emergency Mode"
        sub={`${pending.length} ${pending.length === 1 ? "request is" : "requests are"} waiting on you`}
      />
      <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-muted">
        Approving adds the time to every live deadline this person holds.
        Declining changes nothing — their deadlines stay exactly where they are.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {pending.map((r) => (
          <RequestCard key={r.id} request={r} />
        ))}
      </ul>
    </Panel>
  );
}

function RequestCard({ request }: { request: EmergencyRequest }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const doc = useQuery(
    (r) => r.listAttachments([request.attachmentId]),
    [request.attachmentId],
  );
  const [decide, state] = useAction((r, approve: boolean, why: string) =>
    r.decideEmergencyRequest(request.id, approve, why),
  );
  const file = doc.data?.[0] ?? null;

  return (
    <li className="rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar initials={initialsOf(request.employeeName)} hue={2} name={request.employeeName} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {request.employeeName}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            {formatDateTime(request.startedAt)} → {formatDateTime(request.endedAt)}
          </span>
        </span>
        <Chip tone="solid">{formatDurationTimer(request.durationSecs)}</Chip>
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-ink">
        “{request.reason}”
      </p>

      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[11px] text-ink-faint">
        <span className="text-ink-muted">Document</span>
        {file ? (
          <>
            <span className="text-ink">{file.filename}</span>
            <span>
              {file.mimeType.includes("pdf") ? "PDF" : "Word"} ·{" "}
              {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
            </span>
          </>
        ) : (
          <span>Could not be loaded</span>
        )}
      </p>

      {state.error && (
        <div className="mt-3">
          <InlineError compact message={state.error} code={state.errorCode} />
        </div>
      )}

      {declining && (
        <div className="mt-3">
          <Input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you declining? They will see this."
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {declining ? (
          <>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => {
                setDeclining(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button loading={state.isPending}
              tone="secondary"
              size="sm"
              disabled={!reason.trim() || state.isPending}
              onClick={() => void decide(false, reason)}
            >
              {state.isPending ? "Declining…" : "Confirm decline"}
            </Button>
          </>
        ) : (
          <>
            <Button
              tone="ghost"
              size="sm"
              disabled={state.isPending}
              onClick={() => setDeclining(true)}
            >
              Decline
            </Button>
            <Button loading={state.isPending}
              tone="primary"
              size="sm"
              disabled={state.isPending}
              onClick={() => void decide(true, "")}
            >
              {state.isPending ? "Approving…" : "Approve"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}
