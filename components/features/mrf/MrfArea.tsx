"use client";

import { useEffect, useState } from "react";
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
  PanelHead,
  Select,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import {
  canCancelMrf,
  canDecideMrf,
  mrfStatusLabel,
} from "@/lib/rules/mrf/lifecycle";
import { formatDate } from "@/lib/utils/format";
import { MrfChat } from "./MrfChat";
import { MrfPhotoUploader } from "./MrfPhotoUploader";
import type {
  MrfImage,
  MrfPriority,
  MrfRequest,
  MrfRequestType,
  RawItemHit,
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

function StatusChip({ status }: { status: MrfRequest["status"] }) {
  const tone =
    status === "approved"
      ? "positive"
      : status === "rejected"
        ? "rework"
        : status === "cancelled"
          ? "neutral"
          : "info";
  return <Chip tone={tone as never}>{mrfStatusLabel(status)}</Chip>;
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
  auto_forwarded: "Auto-forwarded to the store",
  item_matched: "Item matched to a catalogue product",
  item_rematched: "Item re-matched to a catalogue product",
  item_registered: "Item registered as a new inventory item",
  item_rejected: "Item rejected",
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

function ItemLines({ request }: { request: MrfRequest }) {
  const [zoomed, setZoomed] = useState<MrfImage | null>(null);
  return (
    <ul className="mt-2 space-y-1.5">
      {request.items.map((it) => {
        const avail =
          it.availability && it.availability !== "unreviewed"
            ? it.availability
            : null;
        const tag = ITEM_STATUS_LABEL[it.status];
        const issuedQty = it.issuedQty ?? 0;
        const returnedQty = it.returnedQty ?? 0;
        return (
          <li key={it.id} className="text-[13px]">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink">{it.name}</span>
              <span data-figure className="text-ink-muted">
                {it.requestedQty} {it.unit}
              </span>
              {it.isUnmatched && (
                <span className="text-[11px] text-ink-faint">· not in catalogue</span>
              )}
              {tag && (
                <span
                  className={`text-[11px] ${
                    it.status === "rejected" || it.status === "overdue"
                      ? "text-[var(--state-rework-ink)]"
                      : "text-ink-faint"
                  }`}
                >
                  · {tag}
                </span>
              )}
            </div>
            {(avail || !!issuedQty || !!returnedQty) && (
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
                {/* What the store still owes on this line — 0 once fully issued. */}
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
            {!!it.images?.length && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {it.images.map((im, k) => (
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
            )}
          </li>
        );
      })}
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

function Tiles({ cells }: { cells: { label: string; value: number }[] }) {
  return (
    <Panel padded={false} className="mb-4">
      <div className="grid grid-cols-2 divide-x divide-y divide-hairline sm:grid-cols-4 sm:divide-y-0">
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
  const { data, isLoading, refetch } = useQuery((r) => r.listMyMrfs(), []);
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

  return (
    <>
      {data && (
        <Tiles
          cells={[
            { label: "Total", value: data.stats.total },
            { label: "Awaiting", value: data.stats.pending },
            { label: "Approved", value: data.stats.approved },
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
          <NewMrf
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
                <StatusChip status={m.status} />
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

/* ── New request ──────────────────────────────────────────────────────────── */

interface DraftItem {
  name: string;
  requestedQty: string;
  unit: string;
  description: string;
  /** True when chosen from the catalogue rather than typed free-hand. */
  matched: boolean;
  rawItemId: string | null;
  variantId: string | null;
  variantCombination: string[];
  /** Units offered in the picker — base unit plus conversions. */
  units: string[];
  /** Stock on hand for the chosen line, for display. */
  stock: number | null;
  /** For a typed (new) item the store hasn't catalogued yet. */
  category: string;
  images: MrfImage[];
}
const emptyItem: DraftItem = {
  name: "",
  requestedQty: "",
  unit: "",
  description: "",
  matched: false,
  rawItemId: null,
  variantId: null,
  variantCombination: [],
  units: [],
  stock: null,
  category: "",
  images: [],
};

function NewMrf({ onDone }: { onDone: () => void }) {
  const [requestType, setType] = useState<MrfRequestType>("uses_based");
  const [priority, setPriority] = useState<MrfPriority>("normal");
  const [reason, setReason] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [deadline, setDeadline] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Adding a typed item is the common path — most requests aren't in the
  // catalogue. Catalogue search is secondary, so it starts collapsed.
  const [showSearch, setShowSearch] = useState(false);
  const [create, state] = useAction((r, input: Parameters<typeof r.createMrf>[0]) =>
    r.createMrf(input),
  );

  // Debounce the catalogue search, matching the old app's 300ms.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const results = useQuery((r) => r.searchMrfItems(q), [q]);

  const setItem = (i: number, patch: Partial<DraftItem>) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const addFromCatalogue = (
    item: RawItemHit,
    variant?: RawItemHit["variants"][number],
  ) => {
    setItems((xs) => [
      ...xs,
      {
        name: variant
          ? `${item.name} · ${variant.combination.join(" / ")}`
          : item.name,
        requestedQty: "",
        unit: item.baseUnit,
        description: "",
        matched: true,
        rawItemId: item.id,
        variantId: variant?.id ?? null,
        variantCombination: variant?.combination ?? [],
        units: item.units.length ? item.units : [item.baseUnit],
        stock: variant ? variant.quantity : item.quantity,
        category: "",
        images: [],
      },
    ]);
    setSearch("");
    setQ("");
    setExpanded(null);
  };

  return (
    <Panel>
      <PanelHead title="New request" sub="It routes to your manager to approve." />
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}
      <div className="grid gap-3 deck:grid-cols-2">
        <Field label="Type">
          <Select
            value={requestType}
            onChange={(e) => setType(e.target.value as MrfRequestType)}
          >
            <option value="uses_based">Consumed (used up)</option>
            <option value="time_based">Borrowed (returned)</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value as MrfPriority)}
          >
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Field label="Reason" required className="deck:col-span-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What it's for"
          />
        </Field>
        <Field label="Needed by">
          <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </Field>
        {requestType === "time_based" && (
          <Field label="Return by" required>
            <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        )}
      </div>

      <p className="mt-4 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Items
      </p>

      {/* Adding a typed item is the primary action — most requests are for
          something not in the catalogue. Catalogue search is optional and
          collapsed behind a text button until asked for. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          size="sm"
          onClick={() => setItems((xs) => [...xs, { ...emptyItem }])}
        >
          + Add a typed item
        </Button>
        <button
          type="button"
          onClick={() => {
            setShowSearch((s) => !s);
            if (showSearch) {
              setSearch("");
              setQ("");
              setExpanded(null);
            }
          }}
          className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          {showSearch ? "Hide catalogue search" : "Search the catalogue instead"}
        </button>
      </div>

      {/* Catalogue search — the real store items and their variants, with stock. */}
      {showSearch && (
      <div className="mt-1.5">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the store catalogue…"
          autoFocus
        />
        {q && (results.data?.length ?? 0) > 0 && (
          <div className="mt-1 max-h-[260px] overflow-y-auto rounded-inset border border-hairline scroll-slim">
            {results.data!.map((item) => (
              <div key={item.id} className="border-b border-hairline last:border-0">
                <button
                  type="button"
                  onClick={() =>
                    item.variants.length
                      ? setExpanded((x) => (x === item.id ? null : item.id))
                      : addFromCatalogue(item)
                  }
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">
                      {item.name}
                    </span>
                    <span className="block text-[11px] text-ink-faint">
                      {item.sku ? `${item.sku} · ` : ""}
                      {item.baseUnit}
                      {item.variants.length
                        ? ` · ${item.variants.length} variants`
                        : ""}
                    </span>
                  </span>
                  <span
                    data-figure
                    className="shrink-0 text-[11px] text-ink-muted"
                  >
                    {item.quantity} {item.baseUnit}
                  </span>
                </button>
                {expanded === item.id && (
                  <div className="bg-[var(--surface-sunken)] px-2 py-1.5">
                    {item.variants.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => addFromCatalogue(item, v)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--control)]"
                      >
                        <span className="text-[13px] text-ink">
                          {v.combination.join(" / ") || "Default"}
                        </span>
                        <span
                          data-figure
                          className={`shrink-0 text-[11px] ${
                            v.quantity > 0
                              ? "text-[var(--state-positive-ink)]"
                              : "text-ink-faint"
                          }`}
                        >
                          {v.quantity} {item.baseUnit}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {q && !results.isLoading && (results.data?.length ?? 0) === 0 && (
          <p className="mt-1 text-[11px] text-ink-faint">
            Nothing in the catalogue for &ldquo;{q}&rdquo;. Add it as a typed
            item above.
          </p>
        )}
      </div>
      )}

      {items.length > 0 && (
        <div className="mt-3 space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field
                label={it.matched ? "Item (catalogue)" : "Item"}
                className="min-w-[160px] flex-1"
              >
                <Input
                  value={it.name}
                  readOnly={it.matched}
                  onChange={(e) => setItem(i, { name: e.target.value })}
                />
              </Field>
              <Field label="Qty" className="w-[80px]">
                <Input
                  type="number"
                  min={0}
                  value={it.requestedQty}
                  onChange={(e) => setItem(i, { requestedQty: e.target.value })}
                />
              </Field>
              <Field label="Unit" className="w-[110px]">
                {it.units.length > 1 ? (
                  <Select
                    value={it.unit}
                    onChange={(e) => setItem(i, { unit: e.target.value })}
                  >
                    {it.units.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={it.unit}
                    onChange={(e) => setItem(i, { unit: e.target.value })}
                  />
                )}
              </Field>
              <button
                type="button"
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                className="pb-2 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Remove
              </button>
              {it.stock != null && (
                <span className="w-full text-[11px] text-ink-faint">
                  In stock: <span data-figure>{it.stock}</span>{" "}
                  {it.matched ? it.units[0] ?? it.unit : it.unit}
                </span>
              )}
              {/* A typed item is a new-product request: the store will match or
                  register it. Give them a category, notes and a photo to help. */}
              <div className="w-full space-y-1.5">
                {!it.matched && (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Category" className="w-[140px]">
                      <Input
                        value={it.category}
                        onChange={(e) => setItem(i, { category: e.target.value })}
                        placeholder="e.g. Fabric"
                      />
                    </Field>
                    <Field
                      label="Notes for the store"
                      className="min-w-[160px] flex-1"
                    >
                      <Input
                        value={it.description}
                        onChange={(e) =>
                          setItem(i, { description: e.target.value })
                        }
                        placeholder="Anything that helps them find it"
                      />
                    </Field>
                  </div>
                )}
                <MrfPhotoUploader
                  images={it.images}
                  onChange={(imgs) => setItem(i, { images: imgs })}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
        <Button
          tone="primary"
          size="sm"
          disabled={state.isPending}
          onClick={async () => {
            const res = await create({
              requestType,
              priority,
              reason,
              neededBy: neededBy || null,
              deadline: requestType === "time_based" ? deadline || null : null,
              items: items.map((it) => ({
                name: it.name,
                requestedQty: Number(it.requestedQty) || 0,
                unit: it.unit,
                description: it.description || null,
                isUnmatched: !it.matched,
                rawItemId: it.rawItemId,
                variantId: it.variantId,
                variantCombination: it.variantCombination,
                images: it.images,
                category: it.category || null,
              })),
            });
            if (res.ok) onDone();
          }}
        >
          {state.isPending ? "Sending…" : "Send request"}
        </Button>
        <Button tone="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

/* ── Approvals ────────────────────────────────────────────────────────────── */

function Approvals() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">(
    "pending",
  );
  const { data, isLoading, refetch } = useQuery(
    (r) => r.listMrfApprovals(status),
    [status],
  );

  return (
    <>
      {data && (
        <Tiles
          cells={[
            { label: "Awaiting you", value: data.stats.awaiting },
            { label: "Approved", value: data.stats.approved },
            { label: "Rejected", value: data.stats.rejected },
            { label: "Total", value: data.stats.total },
          ]}
        />
      )}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink">Queue</h2>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="ml-auto w-[150px]"
        >
          <option value="pending">Awaiting</option>
          <option value="approved">Approved</option>
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

function ApprovalCard({
  request,
  onDecided,
}: {
  request: MrfRequest;
  onDecided: () => void;
}) {
  const viewerId = useViewerId();
  const [decide, state] = useAction(
    (
      r,
      d: {
        approve: boolean;
        note?: string;
        itemDecisions?: Record<string, "approved" | "rejected">;
      },
    ) => r.decideMrf(request.id, d),
  );
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const canDecide = canDecideMrf(request, viewerId ?? "");

  // Per-item approve/skip, so a manager can approve part of a request. Defaults
  // to approving every item; only shown when there is more than one.
  const [itemOk, setItemOk] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(request.items.map((it) => [it.id, true])),
  );
  const itemDecisions = (): Record<string, "approved" | "rejected"> =>
    Object.fromEntries(
      request.items.map((it) => [it.id, itemOk[it.id] ? "approved" : "rejected"]),
    );

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2">
        <span data-figure className="text-sm font-medium text-ink">
          {request.mrfNumber}
        </span>
        <StatusChip status={request.status} />
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
      {canDecide && request.items.length > 1 ? (
        <ul className="mt-2 space-y-1">
          {request.items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 text-[13px]">
              <button
                type="button"
                aria-pressed={itemOk[it.id]}
                onClick={() =>
                  setItemOk((m) => ({ ...m, [it.id]: !m[it.id] }))
                }
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  itemOk[it.id]
                    ? "bg-[var(--state-positive-surface,var(--control))] text-[var(--state-positive-ink)]"
                    : "bg-[var(--control)] text-ink-faint line-through"
                }`}
              >
                {itemOk[it.id] ? "Approve" : "Skip"}
              </button>
              <span className="text-ink">{it.name}</span>
              <span data-figure className="text-ink-muted">
                {it.requestedQty} {it.unit}
              </span>
              {it.isUnmatched && (
                <span className="text-[11px] text-ink-faint">· new item</span>
              )}
            </li>
          ))}
        </ul>
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

      {state.error && (
        <div className="mt-2">
          <InlineError message={state.error} />
        </div>
      )}

      {canDecide && (
        <div className="mt-3 border-t border-hairline pt-3">
          {rejecting ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Reason for rejecting" required className="min-w-[200px] flex-1">
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button
                tone="primary"
                size="sm"
                disabled={!note.trim() || state.isPending}
                onClick={async () => {
                  const res = await decide({ approve: false, note });
                  if (res.ok) onDecided();
                }}
              >
                Reject
              </Button>
              <Button tone="ghost" size="sm" onClick={() => setRejecting(false)}>
                Back
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                tone="primary"
                size="sm"
                disabled={state.isPending}
                onClick={async () => {
                  const res = await decide({
                    approve: true,
                    itemDecisions:
                      request.items.length > 1 ? itemDecisions() : undefined,
                  });
                  if (res.ok) onDecided();
                }}
              >
                Approve
              </Button>
              <Button tone="ghost" size="sm" onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
