import {
  DEFAULT_MINDMAP_SETTINGS,
  emptyExtras,
  type MindBoundary,
  type MindImage,
  type MindLayoutKind,
  type MindLink,
  type MindMapExtras,
  type MindMapMember,
  type MindMapRecord,
  type MindNode,
  type MindNodeStyle,
  type MindRelation,
  type MindSummary,
  type MindThemeKind,
} from "../domain/mindmap.ts";

/**
 * Reading what `/cowork/mindmaps` sent back.
 *
 * The engine already answers in the domain's shape — the route was written for
 * this client and there is no legacy shape to stay compatible with — so these
 * are not translators. They are the boundary check: a response is JSON from
 * over a network, and typing it as `MindMapRecord` because the route is
 * supposed to send one is how a missing field becomes `undefined.length` three
 * components later.
 *
 * The rule throughout is **drop, never guess**. A card with no id cannot be
 * addressed, drawn or deleted, so it is discarded rather than given a
 * generated id that would not match the one the server holds — and the next
 * save would then write a card the server has never seen alongside the one it
 * has.
 */

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function readMember(raw: unknown): MindMapMember | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const employeeId = str(m.employeeId);
  if (!employeeId) return null;
  return {
    employeeId,
    /* Anything unrecognised is an editor rather than an owner: guessing
       upward would hand somebody rename and delete on a map because a field
       arrived misspelt. */
    role: m.role === "owner" || m.role === "viewer" ? m.role : "editor",
    addedAt: str(m.addedAt),
  };
}

export function readMindMapRecord(raw: unknown): MindMapRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;

  const members = Array.isArray(r.members)
    ? r.members.map(readMember).filter((m): m is MindMapMember => m !== null)
    : [];
  /* A map with no members is unopenable by anybody including its author, so
     surfacing it would put a row on screen that cannot be clicked. */
  if (members.length === 0) return null;

  const createdAt = str(r.createdAt);
  return {
    organisationId: str(r.organisationId),
    id,
    title: str(r.title).trim() || "Untitled mindmap",
    createdById: str(r.createdById),
    lastEditedById:
      typeof r.lastEditedById === "string" ? r.lastEditedById : null,
    members,
    memberIds: [...new Set(members.map((m) => m.employeeId))],
    nodeCount: num(r.nodeCount),
    createdAt,
    /* Falls back to `createdAt` rather than to now. A record written before the
       field existed has not just been touched, and saying it was would sort it
       to the top of a list ordered by recency. */
    updatedAt: str(r.updatedAt, createdAt),
    deletedAt: typeof r.deletedAt === "string" ? r.deletedAt : null,
  };
}

function readLink(raw: unknown): MindLink | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const url = str(l.url);
  if (!url) return null;
  return { id: str(l.id) || url.slice(0, 40), url, label: str(l.label) };
}

function readImage(raw: unknown): MindImage | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>;
  const fileId = typeof i.fileId === "string" ? i.fileId : null;
  const dataUrl = typeof i.dataUrl === "string" ? i.dataUrl : undefined;
  /* A picture with neither a file nor bytes has nothing to draw. Kept out
     rather than rendered as a broken frame on somebody's card. */
  if (!fileId && !dataUrl) return null;
  return {
    id: str(i.id),
    name: str(i.name),
    fileId,
    url: typeof i.url === "string" ? i.url : null,
    ...(dataUrl ? { dataUrl } : {}),
    sizeBytes: num(i.sizeBytes),
  };
}

const SHAPES = new Set(["rounded", "rect", "pill", "underline", "ellipse"]);
const SIZES = new Set(["s", "m", "l", "xl"]);
const LINES = new Set(["curve", "straight", "elbow"]);
const LAYOUTS = new Set<string>(["right", "left", "both", "org", "tree", "radial", "timeline", "fishbone"]);
const THEMES = new Set<string>(["field", "mono", "vivid", "warm", "cool", "night"]);

/** A colour the canvas will paint: a palette name or a CSS colour token. */
function colour(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  /* Letters, digits, `#`, `(`, `)`, `,`, `.`, `%`, space and `-` — enough for a
     swatch name, a hex, or an rgb()/hsl(). Anything else (a `url(` or a
     semicolon) cannot be a colour and could be a style injection. */
  return /^[a-zA-Z0-9#(),.% -]{1,40}$/.test(t) ? t : undefined;
}

/**
 * A card's style, with every field checked. Returns undefined when nothing
 * survives, so an unstyled card stays exactly that rather than carrying an
 * empty object that would read as "styled, to nothing".
 */
function readStyle(raw: unknown): MindNodeStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const out: MindNodeStyle = {};
  const fill = colour(s.fill);
  const text = colour(s.text);
  if (fill) out.fill = fill;
  if (text) out.text = text;
  if (typeof s.shape === "string" && SHAPES.has(s.shape)) out.shape = s.shape as MindNodeStyle["shape"];
  if (typeof s.size === "string" && SIZES.has(s.size)) out.size = s.size as MindNodeStyle["size"];
  if (s.bold === true) out.bold = true;
  if (s.underline === true) out.underline = true;
  if (s.strike === true) out.strike = true;
  if (s.italic === true) out.italic = true;
  if (typeof s.line === "string" && LINES.has(s.line)) out.line = s.line as MindNodeStyle["line"];
  return Object.keys(out).length ? out : undefined;
}

export function readMindNode(raw: unknown): MindNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const id = str(n.id);
  if (!id) return null;
  const node: MindNode = {
    id,
    parentId: typeof n.parentId === "string" && n.parentId ? n.parentId : null,
    title: str(n.title),
    description: str(n.description),
    links: Array.isArray(n.links)
      ? n.links.map(readLink).filter((l): l is MindLink => l !== null)
      : [],
    images: Array.isArray(n.images)
      ? n.images.map(readImage).filter((i): i is MindImage => i !== null)
      : [],
    collapsed: n.collapsed === true,
  };

  /* The optional fields are ADDED only when present and valid, so a card
     that never had them round-trips byte-for-byte — which is what keeps the
     CRDT's change detection and the undo stack's folding honest. */
  const style = readStyle(n.style);
  if (style) node.style = style;
  if (typeof n.icon === "string" && n.icon.trim()) node.icon = n.icon.trim().slice(0, 8);
  if ([1, 2, 3, 4, 5].includes(n.priority as number)) node.priority = n.priority as MindNode["priority"];
  if ([0, 25, 50, 75, 100].includes(n.progress as number)) node.progress = n.progress as MindNode["progress"];
  if (Array.isArray(n.tags)) {
    const tags = n.tags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 20);
    if (tags.length) node.tags = tags;
  }
  if (typeof n.taskId === "string" && n.taskId) node.taskId = n.taskId;
  const f = n.floating as Record<string, unknown> | undefined;
  if (f && typeof f === "object" && typeof f.x === "number" && typeof f.y === "number" && Number.isFinite(f.x) && Number.isFinite(f.y) && node.parentId === null) {
    node.floating = { x: Math.round(f.x), y: Math.round(f.y) };
  }
  return node;
}

/* ── Map-level extras ──────────────────────────────────────────────────── */

function readRelation(raw: unknown): MindRelation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const from = str(r.from);
  const to = str(r.to);
  if (!id || !from || !to || from === to) return null;
  const out: MindRelation = { id, from, to, label: str(r.label).slice(0, 200) };
  if (r.line === "straight" || r.line === "curve") out.line = r.line;
  const c = colour(r.color);
  if (c) out.color = c;
  return out;
}

function readBoundary(raw: unknown): MindBoundary | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = str(b.id);
  const nodeId = str(b.nodeId);
  if (!id || !nodeId) return null;
  const out: MindBoundary = { id, nodeId, label: str(b.label).slice(0, 200) };
  const c = colour(b.color);
  if (c) out.color = c;
  return out;
}

function readSummary(raw: unknown): MindSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const id = str(s.id);
  const nodeId = str(s.nodeId);
  if (!id || !nodeId) return null;
  return { id, nodeId, text: str(s.text).slice(0, 500) };
}

/**
 * The map-level extras, defaulted. Never null: a map from before extras
 * existed simply has the default layout and theme and nothing drawn across it.
 *
 * Relations, boundaries and summaries that name a card not in `nodeIds` are
 * dropped here rather than drawn to nowhere — a dangling line is the visual
 * form of `undefined.x`.
 */
export function readMindMapExtras(raw: unknown, nodeIds: ReadonlySet<string>): MindMapExtras {
  const out = emptyExtras();
  if (!raw || typeof raw !== "object") return out;
  const e = raw as Record<string, unknown>;

  const settings = e.settings && typeof e.settings === "object" ? (e.settings as Record<string, unknown>) : {};
  out.settings = {
    layout:
      typeof settings.layout === "string" && LAYOUTS.has(settings.layout)
        ? (settings.layout as MindLayoutKind)
        : DEFAULT_MINDMAP_SETTINGS.layout,
    theme:
      typeof settings.theme === "string" && THEMES.has(settings.theme)
        ? (settings.theme as MindThemeKind)
        : DEFAULT_MINDMAP_SETTINGS.theme,
    ...(settings.numbering === true ? { numbering: true } : {}),
  };
  if (Array.isArray(e.relations))
    out.relations = e.relations
      .map(readRelation)
      .filter((r): r is MindRelation => r !== null && nodeIds.has(r.from) && nodeIds.has(r.to));
  if (Array.isArray(e.boundaries))
    out.boundaries = e.boundaries
      .map(readBoundary)
      .filter((b): b is MindBoundary => b !== null && nodeIds.has(b.nodeId));
  if (Array.isArray(e.summaries))
    out.summaries = e.summaries
      .map(readSummary)
      .filter((s): s is MindSummary => s !== null && nodeIds.has(s.nodeId));
  return out;
}

/**
 * A card tree, or null if what came back cannot be drawn.
 *
 * The server refuses to STORE a malformed tree, and this refuses to RENDER
 * one, and the two are not redundant: a record written before the route
 * existed, or by a script, reaches this client having never passed the
 * server's check. What that check guarantees on the way in, this establishes
 * on the way out — exactly one root, and every parent present.
 *
 * Returning null rather than a partial tree is the point. Half a map drawn as
 * if it were the whole map is the failure a person cannot see: they would edit
 * it, save it, and the save would be the truncation.
 */
export function readMindNodes(raw: unknown): MindNode[] | null {
  if (!Array.isArray(raw)) return null;
  const nodes = raw
    .map(readMindNode)
    .filter((n): n is MindNode => n !== null);
  if (nodes.length !== raw.length) return null;
  if (nodes.length === 0) return [];

  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return null;
  if (nodes.filter((n) => n.parentId === null).length !== 1) return null;
  if (nodes.some((n) => n.parentId !== null && !ids.has(n.parentId)))
    return null;
  return nodes;
}
