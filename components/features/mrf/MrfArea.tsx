"use client";

import { useState } from "react";
import { WorkspaceHead } from "@/components/ui/Workspace";
import { DriveImage } from "@/components/ui/DriveImage";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { driveProxySrc } from "@/lib/rules/media/driveUrls";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  InlineError,
  Input,
  Panel,
  QueryError,
  Select,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import {
  approvalStatusOf,
  awaitingItems,
  canCancelMrf,
  canDecideMrf,
  decidedItems,
  itemApprovalOf,
  itemDecisionLabel,
  mrfRequestLabel,
  validateItemDecisions,
  type MrfApprovalFilter,
  type MrfItemDecisionDraft,
} from "@/lib/rules/mrf/lifecycle";
import { formatDate } from "@/lib/utils/format";
import { MrfChat } from "./MrfChat";
import { NewMrfForm } from "./NewMrfForm";
import type {
  MrfImage,
  MrfItem,
  MrfPriority,
  MrfRequest,
} from "@/lib/domain/mrf";

/**
 * MRF — ask the store for materials.
 *
 * Two views: your own requests, and (for a manager) the queue routed to you to
 * approve. Store issue/return lives in a separate app; this is request and
 * approval only. Copy is kept short on purpose.
 */
export function MrfArea() {
  const [tab, setTab] = useState<"mine" | "approvals">("mine");
  // Fetched here (not just inside Approvals) so the pending count shows on the
  // tab pill even while "My requests" is the active tab — that's the point of
  // a badge: knowing before you switch.
  const { data: approvalsData } = useQuery((r) => r.listMrfApprovals("pending"), []);
  const pendingApprovals = approvalsData?.stats.awaiting ?? 0;

  return (
    <>
      <WorkspaceHead
        title="Material requests"
        count="Ask the store for materials"
        tabs={
          <div className="inline-flex gap-0.5 rounded-full bg-[var(--surface-sunken)] p-[3px]">
            {(
              [
                { id: "mine", label: "My requests" },
                { id: "approvals", label: "Approvals" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-ink text-[var(--body-bg)]"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {t.label}
                {t.id === "approvals" && pendingApprovals > 0 && (
                  <span
                    data-figure
                    className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                      tab === t.id
                        ? "bg-[var(--body-bg)] text-ink"
                        : "bg-[var(--state-rework-ink)] text-white"
                    }`}
                  >
                    {pendingApprovals}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      />
      {tab === "mine" ? <MyRequests /> : <Approvals />}
    </>
  );
}

/* ── Priority / status chips ──────────────────────────────────────────────── */

function PriorityChip({ priority }: { priority: MrfPriority }) {
  if (priority === "normal" || priority === "low") return null;
  return (
    <Chip tone={priority === "urgent" ? "overdue" : "neutral"}>
      {priority === "urgent" ? "Urgent" : "High"}
    </Chip>
  );
}

/**
 * The request's standing, by the manager's decisions — not by the store's
 * lifecycle, which says "approved" the moment ONE item reaches the store.
 */
function StatusChip({ request }: { request: MrfRequest }) {
  const a = request.status === "cancelled" ? "cancelled" : approvalStatusOf(request);
  const tone =
    a === "approved"
      ? "positive"
      : a === "partially_approved"
        ? "extension"
        : a === "rejected"
          ? "rework"
          : a === "partially_processed"
            ? "risk"
            : "neutral";
  return <Chip tone={tone}>{mrfRequestLabel(request)}</Chip>;
}

/** One item's decision, as a small chip. */
function DecisionChip({ item, request }: { item: MrfItem; request: MrfRequest }) {
  const a = itemApprovalOf(item, request);
  const tone =
    a.decision === "approved"
      ? a.rejectedQty > 0
        ? "extension"
        : "positive"
      : a.decision === "rejected"
        ? "rework"
        : "neutral";
  return (
    <Chip tone={tone} className="!px-2 !py-[2px] text-[11px]">
      {request.status === "cancelled" && a.decision === "pending"
        ? "Withdrawn"
        : itemDecisionLabel(a, item.unit)}
    </Chip>
  );
}

/** "by Rakesh · 9 Oct" — who decided an item, and when. */
function decidedBy(item: MrfItem, request: MrfRequest): string | null {
  const a = itemApprovalOf(item, request);
  if (a.decision === "pending" || a.automatic) return null;
  const parts = [a.decidedByName, a.decidedAt ? formatDate(a.decidedAt) : null].filter(Boolean);
  return parts.length ? `by ${parts.join(" · ")}` : null;
}

const AVAILABILITY_LABEL: Record<string, string> = {
  available: "Available",
  partial: "Partly available",
  not_available: "Not available",
  alternative: "Alternative offered",
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  rejected: "Rejected",
  partially_issued: "Part-issued",
  issued: "Issued",
  partially_returned: "Part-returned",
  returned: "Returned",
  overdue: "Overdue",
  unfulfilled: "Unfulfilled",
};

/** History actions arrive as the backend's raw event codes (lowercased —
 * e.g. "tl_approved"). Named ones read as a sentence; anything unrecognised
 * falls back to a humanised version rather than disappearing. */
const HISTORY_ACTION_LABEL: Record<string, string> = {
  created: "Request raised",
  tl_approved: "Approved",
  tl_rejected: "Rejected",
  item_approved: "Approved an item",
  auto_forwarded: "Auto-forwarded to the store",
  item_matched: "Item matched to a catalogue product",
  item_rematched: "Item re-matched to a catalogue product",
  item_registered: "Item registered as a new inventory item",
  item_rejected: "Rejected an item",
  availability_updated: "Availability updated",
  store_unfulfilled: "Marked unfulfilled by the store",
  partially_issued: "Partially issued",
  fully_issued: "Fully issued",
  returned: "Return recorded",
  fully_returned: "Fully returned",
  cancelled: "Withdrawn",
};

function historyActionLabel(action: string): string {
  return (
    HISTORY_ACTION_LABEL[action] ??
    (action
      ? action.charAt(0).toUpperCase() + action.slice(1).replace(/_/g, " ")
      : "Update")
  );
}

const MRF_MEDIA_BASE = process.env.NEXT_PUBLIC_LEGACY_API_URL ?? "";

/** Byte proxy first (works regardless of CDN indexing), stored URL otherwise. */
function mrfImageDownloadUrl(im: MrfImage): string {
  return (im.fileId && driveProxySrc(MRF_MEDIA_BASE, im.fileId)) || im.url;
}

/** Time-based, out with the store, and past its return date. */
function isOverdue(r: MrfRequest): boolean {
  return (
    r.requestType === "time_based" &&
    !!r.deadline &&
    r.status === "approved" &&
    new Date(r.deadline).getTime() < Date.now()
  );
}

/** An item's reference photos — thumbnails that open full size. */
function ItemPhotos({ images }: { images?: MrfImage[] }) {
  const [zoomed, setZoomed] = useState<MrfImage | null>(null);
  if (!images?.length) return null;
  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {images.map((im, k) => (
          <button
            key={k}
            type="button"
            aria-label={`View ${im.name ?? "reference photo"}`}
            onClick={() => setZoomed(im)}
            className="block"
          >
            <DriveImage
              fileId={im.fileId}
              url={im.url}
              alt={im.name ?? "Reference photo"}
              className="h-10 w-10 rounded-md object-cover"
            />
          </button>
        ))}
      </div>
      {zoomed && (
        <ImageLightbox
          fileId={zoomed.fileId}
          url={zoomed.url}
          apiBase={MRF_MEDIA_BASE}
          alt={zoomed.name ?? "Reference photo"}
          downloadUrl={mrfImageDownloadUrl(zoomed)}
          downloadName={zoomed.name ?? "photo.jpg"}
          onClose={() => setZoomed(null)}
        />
      )}
    </>
  );
}

function ItemLines({ request }: { request: MrfRequest }) {
  return (
    <ul className="mt-2 space-y-2">
      {request.items.map((it) => {
        const avail =
          it.availability && it.availability !== "unreviewed"
            ? it.availability
            : null;
        const approval = itemApprovalOf(it, request);
        /* The manager's decision is the chip; this tag is only the store's
           progress after it — "rejected" is said once, by the chip. */
        const tag = it.status === "rejected" ? undefined : ITEM_STATUS_LABEL[it.status];
        const issuedQty = it.issuedQty ?? 0;
        const returnedQty = it.returnedQty ?? 0;
        const withStore = approval.decision === "approved";
        const by = decidedBy(it, request);
        return (
          <li key={it.id} className="text-[13px]" data-mrf-item={it.id}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-ink">{it.name}</span>
              <span data-figure className="text-ink-muted">
                {approval.requestedQty} {it.unit}
              </span>
              {it.isUnmatched && (
                <span className="text-[11px] text-ink-faint">· not in catalogue</span>
              )}
              <DecisionChip item={it} request={request} />
              {tag && (
                <span
                  className={`text-[11px] ${
                    it.status === "overdue"
                      ? "text-[var(--state-rework-ink)]"
                      : "text-ink-faint"
                  }`}
                >
                  · {tag}
                </span>
              )}
              {by && <span className="text-[11px] text-ink-faint">{by}</span>}
            </div>
            {approval.reason && approval.decision !== "pending" && (
              <p
                className={`mt-0.5 text-[11px] ${
                  approval.decision === "rejected"
                    ? "text-[var(--state-rework-ink)]"
                    : "text-ink-muted"
                }`}
              >
                {approval.decision === "rejected" ? "Reason" : "Note"}: {approval.reason}
              </p>
            )}
            {withStore && (avail || !!issuedQty || !!returnedQty) && (
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
                {avail && (
                  <span>
                    Store: {AVAILABILITY_LABEL[avail]}
                    {it.availableQty != null ? ` (${it.availableQty} ${it.unit})` : ""}
                  </span>
                )}
                {!!issuedQty && (
                  <span>
                    Issued <span data-figure>{issuedQty}</span> of{" "}
                    <span data-figure>{it.requestedQty}</span>
                  </span>
                )}
                {/* What the store still owes on this line — 0 once fully issued.
                    `requestedQty` is the APPROVED figure once a manager cut it. */}
                {issuedQty < it.requestedQty &&
                  it.status !== "rejected" &&
                  it.status !== "unfulfilled" && (
                    <span>
                      Remaining to issue{" "}
                      <span data-figure>{it.requestedQty - issuedQty}</span>
                    </span>
                  )}
                {!!returnedQty && (
                  <span>
                    Returned <span data-figure>{returnedQty}</span> of{" "}
                    <span data-figure>{issuedQty}</span> issued
                  </span>
                )}
                {/* Borrowed items only — what the requester still holds. */}
                {request.requestType === "time_based" && issuedQty > returnedQty && (
                  <span>
                    Outstanding to return{" "}
                    <span data-figure>{issuedQty - returnedQty}</span>
                  </span>
                )}
              </div>
            )}
            <ItemPhotos images={it.images} />
          </li>
        );
      })}
    </ul>
  );
}

/* ── Activity log ─────────────────────────────────────────────────────────── */

function MrfHistory({ request }: { request: MrfRequest }) {
  // Open by default — this is the audit trail (who did what, and when), not
  // an optional extra, so it shows without an extra click.
  const [open, setOpen] = useState(true);
  if (!request.history.length) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        {open ? `Hide history (${request.history.length})` : `History (${request.history.length})`}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 border-l border-hairline pl-3">
          {[...request.history].reverse().map((h, i) => (
            <li key={i} className="text-[11px] text-ink-faint">
              <span className="text-ink-muted">{h.actorName}</span>{" "}
              {historyActionLabel(h.action)}
              {h.detail ? ` — ${h.detail}` : ""}
              {h.at ? ` · ${formatDate(h.at)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TILE_COLS: Record<number, string> = {
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
};

function Tiles({ cells }: { cells: { label: string; value: number }[] }) {
  return (
    <Panel padded={false} className="mb-4">
      <div
        className={`grid grid-cols-2 divide-x divide-y divide-hairline sm:divide-y-0 ${
          TILE_COLS[cells.length] ?? "sm:grid-cols-4"
        }`}
      >
        {cells.map((c) => (
          <div key={c.label} className="px-4 py-3">
            <p data-figure className="text-xl font-light text-ink">
              {c.value}
            </p>
            <p className="text-[11px] text-ink-muted">{c.label}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ── My requests ──────────────────────────────────────────────────────────── */

function MyRequests() {
  const viewerId = useViewerId();
  const requests = useQuery((r) => r.listMyMrfs(), []);
  const { data, isLoading, refetch } = requests;
  const [creating, setCreating] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [cancel, cancelState] = useAction((r, id: string) => r.cancelMrf(id));
  /**
   * The request awaiting a withdrawal confirmation, if any.
   *
   * Withdrawing is not reversible — there is no un-withdraw, and the approver
   * has already been notified — so it asks first. Held as the whole request
   * rather than an id so the dialog can name what is about to be withdrawn;
   * "Withdraw this request?" over a list of six is not a question anybody can
   * answer safely.
   */
  const [confirming, setConfirming] = useState<MrfRequest | null>(null);

  if (isLoading) return <SkeletonRows rows={6} />;
  /* A read that failed is not an empty queue. Without this the page drew four
     zeroes and "no requests yet" over a request that exists — see
     `listMyMrfs`, which now raises rather than answering with `[]`. */
  if (requests.error)
    return (
      <QueryError
        queries={[requests]}
        message="Your material requests could not be loaded."
      />
    );

  return (
    <>
      {data && (
        <Tiles
          cells={[
            { label: "Total", value: data.stats.total },
            /* Anything with an item still waiting — a request three of whose
               five items already reached the store is still here. */
            { label: "Awaiting", value: data.stats.pending },
            { label: "Approved", value: data.stats.approved },
            { label: "Partly approved", value: data.stats.partiallyApproved },
            { label: "Closed", value: data.stats.closed },
          ]}
        />
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Your requests</h2>
        {!creating && (
          <Button size="sm" tone="primary" onClick={() => setCreating(true)}>
            New request
          </Button>
        )}
      </div>

      {creating && (
        <div className="mb-4">
          <NewMrfForm
            onDone={() => {
              setCreating(false);
              refetch();
            }}
          />
        </div>
      )}

      {!data?.requests.length ? (
        <Panel>
          <EmptyState
            title="No requests yet"
            body="Raise one when you need materials from the store."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {data.requests.map((m) => (
            <Panel key={m.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span data-figure className="text-sm font-medium text-ink">
                  {m.mrfNumber}
                </span>
                <StatusChip request={m} />
                <PriorityChip priority={m.priority} />
                {m.autoForwarded && <Chip tone="neutral">Auto-sent</Chip>}
                {isOverdue(m) && <Chip tone="overdue">Overdue</Chip>}
                <span className="ml-auto text-[11px] text-ink-faint">
                  {m.requestType === "time_based" ? "Borrowed" : "Consumed"}
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-ink-muted">{m.reason}</p>
              {m.storeNote && (
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  Store note: {m.storeNote}
                </p>
              )}
              <ItemLines request={m} />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
                {m.neededBy && <span>Needed by {formatDate(m.neededBy)}</span>}
                {m.deadline && <span>Return by {formatDate(m.deadline)}</span>}
                {m.approverName && <span>Approver: {m.approverName}</span>}
                <button
                  type="button"
                  onClick={() => setChatId((x) => (x === m.id ? null : m.id))}
                  className="ml-auto text-ink-muted underline underline-offset-2 hover:text-ink"
                >
                  {chatId === m.id ? "Hide chat" : "Chat"}
                </button>
                {canCancelMrf(m, viewerId ?? "") && (
                  <button
                    type="button"
                    onClick={() => setConfirming(m)}
                    className="text-ink-muted underline underline-offset-2 hover:text-ink"
                  >
                    Withdraw
                  </button>
                )}
              </div>
              <MrfHistory request={m} />
              {chatId === m.id && <MrfChat mrfId={m.id} />}
            </Panel>
          ))}
        </div>
      )}
      {confirming && (
        <WithdrawConfirm
          request={confirming}
          pending={cancelState.isPending}
          error={cancelState.error}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const r = await cancel(confirming.id);
            /* Closed only on success. A failure keeps the dialog open with the
               engine's own words — "Material has already been issued against
               this request" is the answer to a question the person just asked,
               and dismissing it back to an unchanged list would leave them
               guessing whether anything happened. */
            if (r.ok) {
              setConfirming(null);
              refetch();
            }
          }}
        />
      )}
    </>
  );
}

/**
 * Confirm a withdrawal.
 *
 * Withdrawing is not reversible — there is no un-withdraw, and the approver has
 * already been notified that a request needs them. So it is asked rather than
 * done, and the question names the request and its items: "Withdraw this
 * request?" over a list of six is not something anybody can answer safely.
 */
function WithdrawConfirm({
  request,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  request: MrfRequest;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mrf-withdraw-title"
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      {/* The scrim is a button so Escape-less dismissal works by click and is
          reachable by keyboard, matching the other dialogs in this product.
          `--body-bg`/60 with a 4px blur is what every other dialog uses; the
          flat `bg-black/50` this had instead read as a different product. */}
      <button
        type="button"
        aria-label="Keep this request"
        onClick={() => !pending && onCancel()}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />
      {/**
       * `frost-panel`, the surface every other dialog in this product uses.
       *
       * This said `bg-[var(--surface)]`, and **there is no such token** — the
       * system defines `--surface-raised` and `--surface-sunken` and nothing
       * called `--surface`. An undefined custom property with no fallback makes
       * the declaration invalid at computed-value time, so `background-color`
       * fell back to `transparent`: the panel had no surface at all and the
       * scrim showed straight through it. The dialog was rendering correctly
       * and was simply invisible, which is why it read as washed-out page
       * rather than as a broken dialog.
       */}
      <div className="frost-panel relative w-[min(460px,96vw)] rounded-panel px-6 py-5">
        <h2
          id="mrf-withdraw-title"
          className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
        >
          Withdraw {request.mrfNumber}?
        </h2>
        <p className="mt-1.5 max-w-[56ch] text-sm leading-relaxed text-ink-muted">
          {request.items.length === 1
            ? `“${request.items[0].name}” will be withdrawn.`
            : `${request.items.length} items will be withdrawn.`}{" "}
          {request.approverName
            ? `${request.approverName} will no longer be asked to approve it.`
            : "The approver will no longer be asked to approve it."}{" "}
          This cannot be undone — raise a new request if you need the material
          later.
        </p>
        {error && (
          <p className="mt-3 rounded-inset bg-[var(--state-rework-surface,var(--surface-sunken))] px-3 py-2 text-xs text-ink">
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button tone="ghost" size="sm" disabled={pending} onClick={onCancel}>
            Keep it
          </Button>
          <Button
            tone="destructive"
            size="sm"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Withdrawing…" : "Withdraw"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Approvals ────────────────────────────────────────────────────────────── */

function Approvals() {
  const [status, setStatus] = useState<MrfApprovalFilter>("pending");
  const approvals = useQuery((r) => r.listMrfApprovals(status), [status]);
  const { data, isLoading, refetch } = approvals;

  /* An approver shown an empty queue believes nothing is waiting on them. */
  if (approvals.error)
    return (
      <QueryError
        queries={[approvals]}
        message="The approval queue could not be loaded."
      />
    );

  return (
    <>
      {data && (
        <Tiles
          cells={[
            { label: "Awaiting you", value: data.stats.awaiting },
            { label: "Approved", value: data.stats.approved },
            { label: "Partly approved", value: data.stats.partiallyApproved },
            { label: "Rejected", value: data.stats.rejected },
            { label: "Total", value: data.stats.total },
          ]}
        />
      )}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink">Queue</h2>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as MrfApprovalFilter)}
          className="ml-auto w-[170px]"
          aria-label="Show requests"
        >
          <option value="pending">Awaiting</option>
          <option value="approved">Approved</option>
          <option value="partially_approved">Partly approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </Select>
      </div>

      {isLoading ? (
        <SkeletonRows rows={5} />
      ) : !data?.requests.length ? (
        <Panel>
          <EmptyState title="Nothing here" body="No requests match this filter." />
        </Panel>
      ) : (
        <div className="space-y-3">
          {data.requests.map((m) => (
            <ApprovalCard key={m.id} request={m} onDecided={refetch} />
          ))}
        </div>
      )}
    </>
  );
}

/* ── Deciding, item by item ───────────────────────────────────────────────── */

/** One item's undecided choice on screen. `qty` blank = the full quantity. */
interface Draft {
  decision: "approved" | "rejected" | null;
  qty: string;
  reason: string;
}
const EMPTY_DRAFT: Draft = { decision: null, qty: "", reason: "" };

/**
 * Approve / Reject for one item. Two toggle buttons rather than a segmented
 * control because "not decided yet" is a real, common state — an item left
 * untouched stays in the queue for later — and a segmented control always has
 * one option on. Pressing the chosen one again clears it.
 */
function DecisionToggle({
  value,
  onChange,
  itemName,
}: {
  value: Draft["decision"];
  onChange: (v: Draft["decision"]) => void;
  itemName: string;
}) {
  return (
    <div
      role="group"
      aria-label={`Decision for ${itemName}`}
      className="inline-flex shrink-0 gap-0.5 rounded-full bg-[var(--surface-sunken)] p-[3px]"
    >
      {(["approved", "rejected"] as const).map((v) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : v)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-[180ms] ${
              on
                ? v === "approved"
                  ? "bg-[color-mix(in_srgb,var(--state-positive)_30%,transparent)] text-[var(--state-positive-ink)]"
                  : "bg-[color-mix(in_srgb,var(--state-overdue)_26%,transparent)] text-[var(--state-overdue-ink)]"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {v === "approved" ? "Approve" : "Reject"}
          </button>
        );
      })}
    </div>
  );
}

function ApprovalCard({
  request,
  onDecided,
}: {
  request: MrfRequest;
  onDecided: () => void;
}) {
  const viewerId = useViewerId();
  const canDecide = canDecideMrf(request, viewerId ?? "");
  const waiting = awaitingItems(request);
  const decided = decidedItems(request);
  const [submit, state] = useAction(
    (r, decisions: Parameters<typeof r.decideMrfItems>[1]) =>
      r.decideMrfItems(request.id, decisions),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /* "Reject all" asks for one reason that covers every rejected item without
     its own — typing the same sentence five times is not a safeguard. */
  const [sharedReason, setSharedReason] = useState("");
  const [askShared, setAskShared] = useState(false);
  /* Problems are shown once the approver has tried to submit, not while they
     are still choosing — a red "give a reason" under an item they have only
     just marked Reject is nagging, not help. */
  const [tried, setTried] = useState(false);
  const [showDecided, setShowDecided] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const draftOf = (id: string): Draft => drafts[id] ?? EMPTY_DRAFT;
  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY_DRAFT), ...patch } }));
  const markAll = (decision: "approved" | "rejected") =>
    setDrafts((d) => {
      const next = { ...d };
      for (const it of waiting) next[it.id] = { ...(d[it.id] ?? EMPTY_DRAFT), decision };
      return next;
    });

  const chosen: MrfItemDecisionDraft[] = waiting
    .filter((it) => draftOf(it.id).decision)
    .map((it) => {
      const d = draftOf(it.id);
      return {
        itemId: it.id,
        decision: d.decision!,
        approvedQty:
          d.decision === "approved" && d.qty.trim() !== "" ? Number(d.qty) : null,
        reason: d.reason,
      };
    });
  const check = validateItemDecisions(request, chosen, sharedReason);
  const toApprove = chosen.filter((d) => d.decision === "approved").length;
  const toReject = chosen.length - toApprove;
  const leftOver = waiting.length - chosen.length;

  const reset = () => {
    setDrafts({});
    setSharedReason("");
    setAskShared(false);
    setTried(false);
  };

  const onSubmit = async () => {
    setTried(true);
    if (!check.ok) return;
    const res = await submit(check.decisions);
    if (res.ok) {
      reset();
      onDecided();
    }
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <span data-figure className="text-sm font-medium text-ink">
          {request.mrfNumber}
        </span>
        <StatusChip request={request} />
        <PriorityChip priority={request.priority} />
        {isOverdue(request) && <Chip tone="overdue">Overdue</Chip>}
        <span className="ml-auto text-[11px] text-ink-faint">
          {request.requesterName}
          {request.requesterDepartment ? ` · ${request.requesterDepartment}` : ""}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-ink-muted">{request.reason}</p>
      {request.storeNote && (
        <p className="mt-0.5 text-[11px] text-ink-faint">
          Store note: {request.storeNote}
        </p>
      )}

      {canDecide ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Awaiting your decision ·{" "}
              <span data-figure>{waiting.length}</span>
            </p>
            {waiting.length > 1 && (
              <span className="ml-auto flex gap-1">
                <Button tone="ghost" size="sm" onClick={() => markAll("approved")}>
                  Approve all
                </Button>
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => {
                    markAll("rejected");
                    setAskShared(true);
                  }}
                >
                  Reject all
                </Button>
              </span>
            )}
          </div>

          <ul className="mt-2 space-y-2">
            {waiting.map((it) => {
              const d = draftOf(it.id);
              const asked = itemApprovalOf(it, request).requestedQty;
              const qty = d.qty.trim() === "" ? asked : Number(d.qty);
              const reduced = d.decision === "approved" && Number.isFinite(qty) && qty < asked;
              const problem =
                tried && !check.ok && check.itemId === it.id ? check.message : null;
              return (
                <li
                  key={it.id}
                  data-mrf-item={it.id}
                  className={`rounded-inset border px-3 py-2.5 ${
                    problem ? "border-[var(--state-rework-ink)]" : "border-hairline"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="min-w-0 flex-1 text-[13px]">
                      <span className="text-ink">{it.name}</span>{" "}
                      <span data-figure className="text-ink-muted">
                        {asked} {it.unit}
                      </span>
                      {it.isUnmatched && (
                        <span className="text-[11px] text-ink-faint"> · new item</span>
                      )}
                    </span>
                    <DecisionToggle
                      itemName={it.name}
                      value={d.decision}
                      onChange={(v) => setDraft(it.id, { decision: v })}
                    />
                  </div>
                  {it.description && (
                    <p className="mt-0.5 text-[11px] text-ink-faint">{it.description}</p>
                  )}
                  <ItemPhotos images={it.images} />

                  {d.decision === "approved" && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Field label={`Approve (${it.unit})`} className="w-[130px]">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={d.qty}
                          placeholder={String(asked)}
                          aria-label={`Quantity of ${it.name} to approve`}
                          onChange={(e) => setDraft(it.id, { qty: e.target.value })}
                        />
                      </Field>
                      {reduced ? (
                        <Field
                          label={`Why only ${qty} of ${asked}?`}
                          required
                          className="min-w-[200px] flex-1"
                        >
                          <Input
                            value={d.reason}
                            placeholder="The requester sees this"
                            onChange={(e) => setDraft(it.id, { reason: e.target.value })}
                          />
                        </Field>
                      ) : (
                        <span className="pb-2 text-[11px] text-ink-faint">
                          Leave blank to approve all {asked} {it.unit}.
                        </span>
                      )}
                    </div>
                  )}
                  {d.decision === "rejected" && (
                    <Field label="Reason for rejecting" required className="mt-2">
                      <Input
                        value={d.reason}
                        placeholder={
                          sharedReason.trim()
                            ? `Uses: “${sharedReason.trim()}”`
                            : "The requester sees this"
                        }
                        onChange={(e) => setDraft(it.id, { reason: e.target.value })}
                      />
                    </Field>
                  )}
                  {problem && (
                    <p className="mt-1.5 text-[11px] text-[var(--state-rework-ink)]">
                      {problem}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {askShared && (
            <Field
              label="Reason for rejecting — used for every rejected item without its own"
              className="mt-2"
            >
              <Input
                value={sharedReason}
                autoFocus
                onChange={(e) => setSharedReason(e.target.value)}
                placeholder="The requester sees this"
              />
            </Field>
          )}

          {decided.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowDecided((v) => !v)}
                className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                {showDecided
                  ? `Hide already decided (${decided.length})`
                  : `Already decided (${decided.length})`}
              </button>
              {showDecided && (
                <ItemLines request={{ ...request, items: decided }} />
              )}
            </div>
          )}
        </>
      ) : (
        <ItemLines request={request} />
      )}

      <MrfHistory request={request} />
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-faint">
        {request.neededBy && <span>Needed by {formatDate(request.neededBy)}</span>}
        {request.deadline && <span>Return by {formatDate(request.deadline)}</span>}
        <button
          type="button"
          onClick={() => setChatOpen((v) => !v)}
          className="ml-auto text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          {chatOpen ? "Hide chat" : "Chat"}
        </button>
      </div>

      {chatOpen && <MrfChat mrfId={request.id} />}

      {canDecide && (
        <div className="mt-3 border-t border-hairline pt-3">
          {state.error && (
            <div className="mb-2">
              <InlineError message={state.error} />
            </div>
          )}
          {tried && !check.ok && !check.itemId && chosen.length > 0 && (
            <div className="mb-2">
              <InlineError message={check.message} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={state.isPending}
              tone="primary"
              size="sm"
              disabled={!chosen.length || state.isPending}
              onClick={onSubmit}
            >
              {chosen.length
                ? `Submit decisions (${chosen.length})`
                : "Submit decisions"}
            </Button>
            {chosen.length > 0 && !state.isPending && (
              <Button tone="ghost" size="sm" onClick={reset}>
                Clear
              </Button>
            )}
            <span className="text-[11px] text-ink-faint">
              {chosen.length === 0
                ? "Choose Approve or Reject for each item. Approved items go to the store as soon as you submit."
                : [
                    toApprove ? `${toApprove} to approve` : "",
                    toReject ? `${toReject} to reject` : "",
                    leftOver ? `${leftOver} left for later` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}
