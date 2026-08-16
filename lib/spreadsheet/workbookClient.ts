/**
 * The workbook repository, browser side.
 *
 * This is the client half of the persistence seam: the UI calls these, they
 * talk to the Node API over `fetch`, and the API talks to the store. The browser
 * therefore never holds a database credential — it holds a session cookie, and
 * the server decides everything from it (`credentials: "include"` carries it).
 *
 * Every failure the routes can return is turned into a typed
 * `WorkbookRequestError` with a `kind`, so the caller (autosave, load) can react
 * to each — retry a network drop, surface an unauthorized, reconcile a conflict
 * — rather than parsing HTTP statuses at the call site.
 */

import type { SerializedWorkbook } from "./persistence";

export interface WorkbookSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Who owns it. */
  ownerId?: string;
  /** Who it is shared with. Present only when YOU own it — a person it was
      shared with cannot see who else holds it. */
  shares?: { principalId: string; role: "viewer" | "commenter" | "editor" }[];
  /** How the SIGNED-IN caller reaches this workbook — theirs, or the role they
      were granted. The server stamps it per request, so it describes you and
      never another person's standing. */
  access?: "owner" | "viewer" | "commenter" | "editor";
}

export interface LoadedWorkbook {
  id: string;
  title: string;
  revision: number;
  data: SerializedWorkbook;
}

export type WorkbookErrorKind =
  | "network"
  | "unauthorized"
  | "not-found"
  | "conflict"
  | "bad-request"
  | "server";

export class WorkbookRequestError extends Error {
  kind: WorkbookErrorKind;
  status: number;
  /** On a conflict, the revision the server currently holds. */
  currentRevision?: number;
  constructor(kind: WorkbookErrorKind, status: number, message: string, currentRevision?: number) {
    super(message);
    this.name = "WorkbookRequestError";
    this.kind = kind;
    this.status = status;
    this.currentRevision = currentRevision;
  }
}

const BASE = "/api/spreadsheet/workbooks";

/** Map a non-ok response to a typed error, reading the server's message. */
async function errorFrom(res: Response): Promise<WorkbookRequestError> {
  let payload: { error?: string; currentRevision?: number } = {};
  try {
    payload = await res.json();
  } catch {
    /* Some responses (e.g. 204) or failures have no JSON body. */
  }
  const message = payload.error ?? `Request failed (${res.status}).`;
  const kind: WorkbookErrorKind =
    res.status === 401
      ? "unauthorized"
      : res.status === 404
        ? "not-found"
        : res.status === 409
          ? "conflict"
          : res.status === 400
            ? "bad-request"
            : "server";
  return new WorkbookRequestError(kind, res.status, message, payload.currentRevision);
}

/** Run a fetch, turning a dropped connection into a `network` error. */
async function request(input: RequestInfo, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { credentials: "include", ...init });
  } catch {
    throw new WorkbookRequestError("network", 0, "Could not reach the server.");
  }
}

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const res = await request(BASE);
  if (!res.ok) throw await errorFrom(res);
  const body = (await res.json()) as { workbooks: WorkbookSummary[] };
  return body.workbooks;
}

export async function createWorkbook(
  title: string,
  data: SerializedWorkbook,
): Promise<{ id: string; title: string; revision: number }> {
  const res = await request(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, data }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function loadWorkbook(id: string): Promise<LoadedWorkbook> {
  const res = await request(`${BASE}/${encodeURIComponent(id)}`);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function saveWorkbook(
  id: string,
  data: SerializedWorkbook,
  baseRevision: number,
): Promise<{ revision: number; updatedAt: string }> {
  const res = await request(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, baseRevision }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function renameWorkbook(id: string, title: string): Promise<{ title: string }> {
  const res = await request(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function deleteWorkbook(id: string): Promise<void> {
  const res = await request(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await errorFrom(res);
}

/** One person's standing on a workbook, as the sharing UI edits it. */
export interface ShareGrant {
  principalId: string;
  role: "viewer" | "commenter" | "editor";
}

/** Who a workbook is shared with. Owner-only; a 403 means you are not the owner. */
export async function listShares(id: string): Promise<ShareGrant[]> {
  const res = await request(`/api/spreadsheet/workbooks/${encodeURIComponent(id)}/shares`);
  if (!res.ok) throw await errorFrom(res);
  return ((await res.json()) as { shares: ShareGrant[] }).shares ?? [];
}

/** Replace the whole share list. Passing `[]` makes the workbook private again. */
export async function setShares(id: string, shares: ShareGrant[]): Promise<ShareGrant[]> {
  const res = await request(`/api/spreadsheet/workbooks/${encodeURIComponent(id)}/shares`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shares }),
  });
  if (!res.ok) throw await errorFrom(res);
  return ((await res.json()) as { shares: ShareGrant[] }).shares ?? [];
}

/** Copy a workbook, content and all, under a new title. */
export async function duplicateWorkbook(
  id: string,
  title: string,
): Promise<{ id: string; title: string; revision: number }> {
  const source = await loadWorkbook(id);
  return createWorkbook(title, source.data);
}
