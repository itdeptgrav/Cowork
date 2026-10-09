"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Field,
  InlineError,
  Input,
  Panel,
  Segmented,
  Select,
} from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import {
  draftItemProblem,
  newMrfChecklist,
  type MrfChecklistLine,
} from "@/lib/rules/mrf/lifecycle";
import { formatDate } from "@/lib/utils/format";
import { MrfPhotoUploader } from "./MrfPhotoUploader";
import type {
  MrfImage,
  MrfPriority,
  MrfRequestType,
  RawItemHit,
} from "@/lib/domain/mrf";

/**
 * Raise a material request — one page, two sections, and a checklist that says
 * what is still missing.
 *
 * Nothing here is new behaviour. Every field the old form had is still here
 * (type, priority, reason, needed-by, return-by for a borrowed request, items
 * typed or picked from the catalogue with their variants and stock, quantity,
 * unit, category and notes for a typed item, photos on any item); what changed
 * is that the person can SEE where they are: each section marks itself done,
 * each item says what it still needs, and "Ready to send?" lists every gap — a
 * gap is a button that takes you to the field.
 *
 * UI ONLY, deliberately (owner, 9 Oct 2026: "all logic remain same"). The
 * checklist GUIDES and never blocks: Send behaves exactly as the old form's
 * did — pressable whenever nothing is sending, and what reaches `createMrf` is
 * the same input built the same way, judged by the same server. Its wording
 * comes from `newMrfChecklist` in lib/rules/mrf/lifecycle.ts.
 */

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

/* Field ids, so a checklist line can take the person straight to its field. */
const FIELD = {
  reason: "mrf-new-reason",
  deadline: "mrf-new-deadline",
  neededBy: "mrf-new-needed-by",
  addTyped: "mrf-new-add-typed",
  itemName: (i: number) => `mrf-new-item-${i}-name`,
  itemQty: (i: number) => `mrf-new-item-${i}-qty`,
  itemUnit: (i: number) => `mrf-new-item-${i}-unit`,
};

function focusField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  (el as HTMLElement).focus({ preventScroll: true });
}

export function NewMrfForm({ onDone }: { onDone: () => void }) {
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
  // catalogue. Catalogue search is secondary, so it starts closed.
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

  const addTyped = () => {
    const at = items.length;
    setItems((xs) => [...xs, { ...emptyItem }]);
    /* The new card's name field exists on the next paint. */
    requestAnimationFrame(() => focusField(FIELD.itemName(at)));
  };

  const addFromCatalogue = (item: RawItemHit, variant?: RawItemHit["variants"][number]) => {
    const at = items.length;
    setItems((xs) => [
      ...xs,
      {
        name: variant ? `${item.name} · ${variant.combination.join(" / ")}` : item.name,
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
    requestAnimationFrame(() => focusField(FIELD.itemQty(at)));
  };

  const checklist = newMrfChecklist(
    { requestType, reason, neededBy, deadline, items },
    formatDate,
  );

  const goTo = (line: MrfChecklistLine) => {
    if (line.key === "reason") return focusField(FIELD.reason);
    if (line.key === "deadline") return focusField(FIELD.deadline);
    if (line.key === "neededBy") return focusField(FIELD.neededBy);
    if (line.key === "items") return focusField(FIELD.addTyped);
    if (line.itemIndex !== undefined) {
      const it = items[line.itemIndex];
      const problem = it ? draftItemProblem(it) ?? "" : "";
      focusField(
        /name/.test(problem)
          ? FIELD.itemName(line.itemIndex)
          : /quantity/.test(problem)
            ? FIELD.itemQty(line.itemIndex)
            : FIELD.itemUnit(line.itemIndex),
      );
    }
  };

  const send = async () => {
    const input = {
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
    };
    const res = await create(input);
    if (res.ok) onDone();
  };

  return (
    <Panel label="New material request" padded={false}>
      <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[17px] leading-tight font-medium tracking-[-0.02em] text-ink">
            New material request
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Say what it&rsquo;s for and list what you need. It goes to your manager to approve,
            then to the store.
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          aria-label="Close without sending"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.close />
        </button>
      </div>

      <div className="grid gap-x-8 gap-y-6 px-5 py-5 sm:px-6 deck:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 max-w-[760px] space-y-8">
          {/* ── 1 · What it is for ──────────────────────────────────────── */}
          <section aria-labelledby="mrf-new-purpose">
            <StepHead id="mrf-new-purpose" n={1} done={checklist.purposeDone} title="What is it for?" />

            <div className="mt-4 space-y-5">
              <Field label="Reason" required>
                <Input
                  id={FIELD.reason}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Trims for the sample run"
                />
              </Field>

              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">Type</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <TypeOption
                    name="mrf-new-type"
                    checked={requestType === "uses_based"}
                    onChange={() => setType("uses_based")}
                    title="Consumed"
                    sub="Used up — it is not coming back"
                  />
                  <TypeOption
                    name="mrf-new-type"
                    checked={requestType === "time_based"}
                    onChange={() => setType("time_based")}
                    title="Borrowed"
                    sub="Returned to the store by a date"
                  />
                </div>
              </fieldset>

              <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div>
                  <span className="mb-1.5 block text-sm font-medium text-ink">Priority</span>
                  <Segmented<MrfPriority>
                    label="Priority"
                    size="sm"
                    value={priority === "urgent" ? "urgent" : "normal"}
                    onChange={setPriority}
                    options={[
                      { id: "normal", label: "Normal" },
                      { id: "urgent", label: "Urgent" },
                    ]}
                  />
                </div>
                <Field label="Needed by" hint="Optional" className="w-[200px]">
                  <Input
                    id={FIELD.neededBy}
                    type="date"
                    value={neededBy}
                    onChange={(e) => setNeededBy(e.target.value)}
                  />
                </Field>
                {requestType === "time_based" && (
                  <Field label="Return by" required className="w-[200px]">
                    <Input
                      id={FIELD.deadline}
                      type="date"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            </div>
          </section>

          {/* ── 2 · Items ───────────────────────────────────────────────── */}
          <section aria-labelledby="mrf-new-items">
            <StepHead
              id="mrf-new-items"
              n={2}
              done={checklist.itemsDone}
              title="Items"
              count={items.length}
            />

            {items.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                Nothing added yet. Type what you need, or pick it from the store&rsquo;s catalogue
                to see what is in stock.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {items.map((it, i) => (
                  <ItemCard
                    key={i}
                    index={i}
                    item={it}
                    onChange={(patch) => setItem(i, patch)}
                    onRemove={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                  />
                ))}
              </ol>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button id={FIELD.addTyped} tone="secondary" size="sm" onClick={addTyped}>
                <Icon.plus /> Type an item
              </Button>
              <Button
                tone="ghost"
                size="sm"
                aria-expanded={showSearch}
                onClick={() => {
                  setShowSearch((s) => !s);
                  if (showSearch) {
                    setSearch("");
                    setQ("");
                    setExpanded(null);
                  }
                }}
              >
                <Icon.search /> {showSearch ? "Close catalogue search" : "Pick from the catalogue"}
              </Button>
            </div>

            {/* Catalogue search — the real store items and their variants, with stock. */}
            {showSearch && (
              <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] p-3">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search the store catalogue by name or SKU…"
                  aria-label="Search the store catalogue"
                  autoFocus
                />
                {q && (results.data?.length ?? 0) > 0 && (
                  <div className="scroll-slim mt-2 max-h-[280px] overflow-y-auto rounded-inset bg-[var(--surface-raised)] shadow-[inset_0_0_0_1px_var(--color-hairline)]">
                    {results.data!.map((item) => (
                      <div key={item.id} className="border-b border-hairline last:border-0">
                        <button
                          type="button"
                          aria-expanded={item.variants.length ? expanded === item.id : undefined}
                          onClick={() =>
                            item.variants.length
                              ? setExpanded((x) => (x === item.id ? null : item.id))
                              : addFromCatalogue(item)
                          }
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--control)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] text-ink">{item.name}</span>
                            <span className="block text-[11px] text-ink-faint">
                              {item.sku ? `${item.sku} · ` : ""}
                              {item.baseUnit}
                              {item.variants.length
                                ? ` · ${item.variants.length} variants — choose one`
                                : " · press to add"}
                            </span>
                          </span>
                          <StockFigure qty={item.quantity} unit={item.baseUnit} />
                        </button>
                        {expanded === item.id && (
                          <div className="bg-[var(--surface-sunken)] px-2 py-1.5">
                            {item.variants.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => addFromCatalogue(item, v)}
                                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--control)]"
                              >
                                <span className="text-[13px] text-ink">
                                  {v.combination.join(" / ") || "Default"}
                                </span>
                                <StockFigure qty={v.quantity} unit={item.baseUnit} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {q && !results.isLoading && (results.data?.length ?? 0) === 0 && (
                  <p className="mt-2 text-xs text-ink-faint">
                    Nothing in the catalogue for &ldquo;{q}&rdquo;. Use Type an item instead.
                  </p>
                )}
                {!q && (
                  <p className="mt-2 text-xs text-ink-faint">
                    Start typing to search. Items with variants open so you can choose one.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* ── Ready to send? ────────────────────────────────────────────── */}
        <aside aria-label="Ready to send?" className="deck:sticky deck:top-4 deck:self-start">
          <div className="rounded-inset bg-[var(--surface-sunken)] p-4">
            <p className="text-sm font-medium text-ink" aria-live="polite">
              {checklist.ready
                ? "Ready to send"
                : `${checklist.missing} thing${checklist.missing === 1 ? "" : "s"} left to fill in`}
            </p>
            <ul className="mt-3 space-y-1.5">
              {checklist.lines.map((line) => (
                <ChecklistRow key={line.key} line={line} onGo={() => goTo(line)} />
              ))}
            </ul>

            {state.error && (
              <div className="mt-3">
                <InlineError message={state.error} />
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button
                tone="primary"
                loading={state.isPending}
                disabled={state.isPending}
                onClick={send}
                className="w-full"
              >
                <Icon.send /> {state.isPending ? "Sending…" : "Send request"}
              </Button>
              <Button tone="ghost" onClick={onDone} className="w-full">
                Cancel
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Your manager approves each item on its own. Approved items go to the store straight
              away.
            </p>
          </div>
        </aside>
      </div>
    </Panel>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/** A section heading whose marker turns into a tick once the section is complete. */
function StepHead({
  id,
  n,
  done,
  title,
  count,
}: {
  id: string;
  n: number;
  done: boolean;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors duration-[180ms] ${
          done
            ? "bg-[color-mix(in_srgb,var(--state-positive)_30%,transparent)] text-[var(--state-positive-ink)]"
            : "bg-[var(--control)] text-ink-muted"
        }`}
      >
        {done ? <Icon.check className="h-3.5 w-3.5" /> : n}
      </span>
      <h3 id={id} className="text-[15px] font-medium tracking-[-0.012em] text-ink">
        {title}
        {count ? (
          <span data-figure className="ml-1.5 text-ink-faint">
            {count}
          </span>
        ) : null}
      </h3>
      <span className="sr-only">{done ? "— complete" : "— not complete yet"}</span>
    </div>
  );
}

/** One of the two request types, as a choice you can read rather than a select. */
function TypeOption({
  name,
  checked,
  onChange,
  title,
  sub,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  sub: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-inset px-3.5 py-3 transition-[background-color,box-shadow] duration-[180ms] ${
        checked
          ? "bg-[var(--surface-raised)] shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
          : "bg-[var(--surface-raised)] shadow-[inset_0_0_0_1px_var(--color-hairline)] hover:bg-[var(--control)]"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-faint">{sub}</span>
      </span>
    </label>
  );
}

function StockFigure({ qty, unit }: { qty: number; unit: string }) {
  return (
    <span
      data-figure
      className={`shrink-0 text-[11px] ${
        qty > 0 ? "text-[var(--state-positive-ink)]" : "text-ink-faint"
      }`}
    >
      {qty > 0 ? `${qty} ${unit} in stock` : "Out of stock"}
    </span>
  );
}

/** One item on the request: what it is, how much, and whether it is complete. */
function ItemCard({
  index,
  item: it,
  onChange,
  onRemove,
}: {
  index: number;
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const problem = draftItemProblem(it);
  const label = it.name.trim() || `Item ${index + 1}`;
  return (
    <li className="rounded-inset bg-[var(--surface-sunken)] p-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
            problem
              ? "bg-[var(--control)] text-ink-muted"
              : "bg-[color-mix(in_srgb,var(--state-positive)_30%,transparent)] text-[var(--state-positive-ink)]"
          }`}
        >
          {problem ? index + 1 : <Icon.check className="h-3.5 w-3.5" />}
        </span>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_130px]">
            <Field label={it.matched ? "Item · from the catalogue" : "Item"} required>
              <Input
                id={FIELD.itemName(index)}
                value={it.name}
                readOnly={it.matched}
                placeholder="What do you need?"
                onChange={(e) => onChange({ name: e.target.value })}
              />
            </Field>
            <Field label="Quantity" required>
              <Input
                id={FIELD.itemQty(index)}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={it.requestedQty}
                placeholder="0"
                onChange={(e) => onChange({ requestedQty: e.target.value })}
              />
            </Field>
            <Field label="Unit" required>
              {it.units.length > 1 ? (
                <Select
                  id={FIELD.itemUnit(index)}
                  value={it.unit}
                  onChange={(e) => onChange({ unit: e.target.value })}
                >
                  {it.units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id={FIELD.itemUnit(index)}
                  value={it.unit}
                  placeholder="e.g. Pcs"
                  onChange={(e) => onChange({ unit: e.target.value })}
                />
              )}
            </Field>
          </div>

          {/* A typed item is a new-product request: the store will match or
              register it. A category and notes help them find it. */}
          {!it.matched && (
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <Field label="Category" hint="Optional">
                <Input
                  value={it.category}
                  onChange={(e) => onChange({ category: e.target.value })}
                  placeholder="e.g. Fabric"
                />
              </Field>
              <Field label="Notes for the store" hint="Optional">
                <Input
                  value={it.description}
                  onChange={(e) => onChange({ description: e.target.value })}
                  placeholder="Colour, size, brand — anything that helps them find it"
                />
              </Field>
            </div>
          )}

          <div>
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <Icon.attach className="h-3.5 w-3.5" /> Photos
              <span className="font-normal text-ink-faint">· optional, up to 5</span>
            </span>
            <MrfPhotoUploader images={it.images} onChange={(imgs) => onChange({ images: imgs })} />
          </div>

          <p
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
              problem ? "text-[var(--state-rework-ink)]" : "text-[var(--state-positive-ink)]"
            }`}
          >
            <span>{problem ?? "Complete"}</span>
            {it.stock != null && (
              <span data-figure className="text-ink-faint">
                In stock: {it.stock} {it.matched ? it.units[0] ?? it.unit : it.unit}
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.trash />
        </button>
      </div>
    </li>
  );
}

/** One line of "Ready to send?" — a gap is a button that goes to its field. */
function ChecklistRow({ line, onGo }: { line: MrfChecklistLine; onGo: () => void }) {
  const mark =
    line.state === "done" ? (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--state-positive)_30%,transparent)] text-[var(--state-positive-ink)]">
        <Icon.check className="h-3 w-3" />
      </span>
    ) : line.state === "missing" ? (
      <span className="h-4 w-4 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--state-rework-ink)]" />
    ) : (
      <span className="h-4 w-4 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--color-hairline)]" />
    );
  const text = (
    <span
      className={`min-w-0 break-words ${
        line.state === "missing"
          ? "text-[var(--state-rework-ink)]"
          : line.state === "optional"
            ? "text-ink-faint"
            : "text-ink-muted"
      }`}
    >
      {line.label}
    </span>
  );
  return (
    <li>
      {line.state === "done" && line.key === "type" ? (
        <span className="flex items-start gap-2 text-xs">
          {mark}
          {text}
        </span>
      ) : (
        <button
          type="button"
          onClick={onGo}
          className="flex w-full items-start gap-2 rounded-md text-left text-xs underline-offset-2 hover:underline focus-visible:underline"
        >
          {mark}
          {text}
        </button>
      )}
    </li>
  );
}
