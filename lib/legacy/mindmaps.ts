import type {
  MindImage,
  MindLink,
  MindMapMember,
  MindMapRecord,
  MindNode,
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

export function readMindNode(raw: unknown): MindNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const id = str(n.id);
  if (!id) return null;
  return {
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
