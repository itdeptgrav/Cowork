"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Primitives";
import type { MindNode, MindNodeStyle, MindPriority, MindProgress } from "@/lib/domain";
import { priorityMarker, type MindTheme } from "@/lib/rules/mindmap/theme";

/**
 * How one card looks and what it is marked with.
 *
 * The controls a person reaches for on a card in XMind or MindMeister, in the
 * same order they reach for them: colour, then shape, then text, then the
 * markers, then tags. Every control commits immediately — there is no Apply —
 * because a thinking tool that makes you confirm a colour is one you stop
 * colouring in.
 *
 * "None" is a real choice on every row. A card that has been coloured and then
 * un-coloured must go back to carrying nothing, not to carrying an explicit
 * default: the optional fields are absent on an untouched card and the CRDT
 * and the undo stack both rely on "absent" and "unset" being the same thing.
 */

const SHAPES: { id: NonNullable<MindNodeStyle["shape"]>; label: string }[] = [
  { id: "rounded", label: "Rounded" },
  { id: "rect", label: "Square" },
  { id: "pill", label: "Pill" },
  { id: "underline", label: "Underline" },
];

const SIZES: { id: NonNullable<MindNodeStyle["size"]>; label: string }[] = [
  { id: "s", label: "S" },
  { id: "m", label: "M" },
  { id: "l", label: "L" },
  { id: "xl", label: "XL" },
];

const PRIORITIES: MindPriority[] = [1, 2, 3, 4, 5];
const PROGRESS: MindProgress[] = [0, 25, 50, 75, 100];

/** The emoji people put on cards. A curated grid beats a 3,000-entry picker. */
const EMOJI = [
  "💡", "⭐", "🔥", "✅", "❌", "⚠️", "❓", "❗", "📌", "🎯",
  "🚀", "🏁", "📅", "⏰", "💰", "📈", "📉", "🧩", "🔑", "🔒",
  "👤", "👥", "💬", "📝", "📎", "🔗", "🧠", "❤️", "👍", "👎",
  "🟢", "🟡", "🔴", "🔵", "⚫", "⚪", "🟣", "🟠", "1️⃣", "2️⃣",
];

export function NodeStylePanel({
  node,
  theme,
  onChange,
}: {
  node: MindNode;
  theme: MindTheme;
  onChange: (patch: Partial<MindNode>) => void;
}) {
  const style = node.style ?? {};
  const [tagDraft, setTagDraft] = useState("");
  const [customColour, setCustomColour] = useState(style.fill ?? "");

  /** Merge a style change, dropping the whole object when nothing is left. */
  const setStyle = (patch: Partial<MindNodeStyle>) => {
    const next: MindNodeStyle = { ...style, ...patch };
    for (const k of Object.keys(next) as (keyof MindNodeStyle)[]) {
      if (next[k] === undefined || next[k] === false) delete next[k];
    }
    onChange({ style: Object.keys(next).length ? next : undefined });
  };

  const addTag = () => {
    const t = tagDraft.trim().slice(0, 40);
    if (!t) return;
    const tags = node.tags ?? [];
    if (!tags.includes(t)) onChange({ tags: [...tags, t] });
    setTagDraft("");
  };

  return (
    <div className="mt-5 flex flex-col gap-4">
      {/* ── Colour ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-sm font-medium text-ink">Colour</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Swatch
            label="Theme colour"
            selected={!style.fill}
            onClick={() => setStyle({ fill: undefined, text: undefined })}
          >
            <span className="grid h-full w-full place-items-center text-[10px] text-ink-muted">×</span>
          </Swatch>
          {theme.swatches.map((c) => (
            <Swatch
              key={c}
              label={c}
              colour={c}
              selected={style.fill === c}
              onClick={() => setStyle({ fill: c, text: undefined })}
            />
          ))}
          <label className="relative ml-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-hairline" title="Any colour">
            <input
              type="color"
              aria-label="Any colour"
              value={/^#[0-9a-f]{6}$/i.test(customColour) ? customColour : "#888888"}
              onChange={(e) => {
                setCustomColour(e.target.value);
                setStyle({ fill: e.target.value, text: undefined });
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 rounded-full"
              style={{ background: "conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
            />
          </label>
        </div>
      </div>

      {/* ── Shape and text ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm font-medium text-ink">Shape</p>
          <div className="mt-2 flex items-center gap-1 rounded-full border border-hairline bg-[var(--surface-sunken)] p-0.5">
            {SHAPES.map((s) => (
              <Pick
                key={s.id}
                label={s.label}
                active={(style.shape ?? "rounded") === s.id}
                onClick={() => setStyle({ shape: s.id === "rounded" ? undefined : s.id })}
              >
                <ShapeGlyph shape={s.id} />
              </Pick>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Text</p>
          <div className="mt-2 flex items-center gap-1 rounded-full border border-hairline bg-[var(--surface-sunken)] p-0.5">
            {SIZES.map((s) => (
              <Pick
                key={s.id}
                label={`Size ${s.label}`}
                active={(style.size ?? "m") === s.id}
                onClick={() => setStyle({ size: s.id === "m" ? undefined : s.id })}
              >
                <span className="text-[10px]">{s.label}</span>
              </Pick>
            ))}
            <span className="mx-0.5 h-4 w-px bg-hairline" aria-hidden="true" />
            <Pick label="Underline" active={style.underline === true} onClick={() => setStyle({ underline: style.underline ? undefined : true })}>
              <span className="text-[11px] underline">U</span>
            </Pick>
            <Pick label="Strikethrough" active={style.strike === true} onClick={() => setStyle({ strike: style.strike ? undefined : true })}>
              <span className="text-[11px] line-through">S</span>
            </Pick>
            <Pick label="Bold" active={style.bold === true} onClick={() => setStyle({ bold: style.bold ? undefined : true })}>
              <span className="text-[11px] font-bold">B</span>
            </Pick>
            <Pick label="Italic" active={style.italic === true} onClick={() => setStyle({ italic: style.italic ? undefined : true })}>
              <span className="text-[11px] italic">I</span>
            </Pick>
          </div>
        </div>
      </div>

      {/* ── Icon ────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-sm font-medium text-ink">Icon</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            aria-label="No icon"
            aria-pressed={!node.icon}
            onClick={() => onChange({ icon: undefined })}
            className={`grid h-7 w-7 place-items-center rounded-inset text-[11px] ${!node.icon ? "bg-[var(--control-active)] text-ink" : "text-ink-muted hover:bg-[var(--control)]"}`}
          >
            ×
          </button>
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={e}
              aria-pressed={node.icon === e}
              onClick={() => onChange({ icon: node.icon === e ? undefined : e })}
              className={`grid h-7 w-7 place-items-center rounded-inset text-[15px] leading-none ${node.icon === e ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)]"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* ── Markers ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm font-medium text-ink">Priority</p>
          <div className="mt-2 flex items-center gap-1">
            {PRIORITIES.map((p) => {
              const m = priorityMarker(p);
              const on = node.priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-label={`Priority ${p}`}
                  aria-pressed={on}
                  onClick={() => onChange({ priority: on ? undefined : p })}
                  className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white transition-transform ${on ? "scale-110 ring-2 ring-ink ring-offset-1" : "opacity-60 hover:opacity-100"}`}
                  style={{ background: m.colour }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Progress</p>
          <div className="mt-2 flex items-center gap-1">
            {PROGRESS.map((p) => {
              const on = node.progress === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-label={`${p}% done`}
                  aria-pressed={on}
                  onClick={() => onChange({ progress: on ? undefined : p })}
                  className={`grid h-6 w-6 place-items-center rounded-full ${on ? "ring-2 ring-ink ring-offset-1" : "opacity-70 hover:opacity-100"}`}
                  title={`${p}%`}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-ink)" strokeOpacity="0.25" strokeWidth="2.5" />
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      fill="none"
                      stroke="var(--color-ink)"
                      strokeWidth="2.5"
                      strokeDasharray={`${(p / 100) * 37.7} 37.7`}
                      transform="rotate(-90 8 8)"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Tags ────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-sm font-medium text-ink">Tags</p>
        {(node.tags ?? []).length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {(node.tags ?? []).map((t) => (
              <li key={t} className="inline-flex items-center gap-1 rounded-full bg-[var(--control)] px-2 py-0.5 text-[11px] text-ink">
                {t}
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => {
                    const rest = (node.tags ?? []).filter((x) => x !== t);
                    onChange({ tags: rest.length ? rest : undefined });
                  }}
                  className="text-ink-faint hover:text-ink"
                >
                  <Icon.close className="h-2.5 w-2.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <Input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder="Add a tag and press Enter"
            maxLength={40}
          />
        </div>
      </div>
    </div>
  );
}

function Swatch({
  label,
  colour,
  selected,
  onClick,
  children,
}: {
  label: string;
  colour?: string;
  selected: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      className={`h-6 w-6 rounded-full border transition-transform ${
        selected ? "scale-110 border-ink ring-2 ring-ink ring-offset-1" : "border-hairline hover:scale-105"
      }`}
      style={colour ? { background: colour } : undefined}
    >
      {children}
    </button>
  );
}

function Pick({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 transition-colors ${
        active ? "bg-ink text-[var(--body-bg)]" : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ShapeGlyph({ shape }: { shape: NonNullable<MindNodeStyle["shape"]> }) {
  const common = { width: 14, height: 9, x: 1, y: 3.5, fill: "none", stroke: "currentColor", strokeWidth: 1.4 };
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      {shape === "rounded" && <rect {...common} rx={2.5} />}
      {shape === "rect" && <rect {...common} rx={0.5} />}
      {shape === "pill" && <rect {...common} rx={4.5} />}
      {shape === "ellipse" && <ellipse cx="8" cy="8" rx="7" ry="4.5" fill="none" stroke="currentColor" strokeWidth={1.4} />}
      {shape === "underline" && <path d="M2 12.5h12" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />}
    </svg>
  );
}
