/**
 * The workbook repository, browser side.
 *
 * ## Where these calls go now, and why it changed
 *
 * They go to the engine — `grav-cms-backend`, `/cowork/workbooks…` — with a
 * Firebase ID token, exactly as mindmaps and documents do. They used to go to
 * this app's own `/api/spreadsheet/workbooks` routes, which wrote a JSON file on
 * the Next.js server's disk (`lib/server/workbookStore.ts`). That server is
 * Vercel, its disk is ephemeral, and every deploy began with an empty file: a
 * sheet built on Monday was gone by the next release while the chip said
 * "Saved". Firestore, behind the engine, is where every other Cowork record
 * lives, and now sheets do too. See `routes/task_routes/coworkWorkbooks.js` in
 * the engine for how a workbook is split to fit and why only changed parts are
 * written.
 *
 * **The exported API is unchanged.** `SheetsArea`, `FileMenu` and
 * `useWorkbookPersistence` call the same functions with the same shapes and
 * receive the same typed `WorkbookRequestError`s, so the surfaces above did not
 * have to move. Only the transport under them did.
 *
 * ## Identity
 *
 * The principal is the Cowork employee id, resolved by the engine from the
 * verified token — the same id mindmap and document membership uses. Share
 * grants therefore name colleagues the way the rest of the workspace does,
 * rather than a Firebase uid the sharing UI could not display.
 */

import { idToken } from "@/lib/legacy/firebase";
import { joinUrl, readConfig } from "@/lib/legacy/config";
import { PUBLIC_ENV } from "@/lib/legacy/publicEnv";
import type { SerializedWorkbook } from "./persistence";

export interface WorkbookSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Who owns it — an employee id. */
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
  access?: "owner" | "viewer" | "commenter" | "editor";
  data: SerializedWorkbook;
}

export type WorkbookErrorKind =
  | "network"
  | "unauthorized"
  | "forbidden"
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

const PATH = "/cowork/workbooks";

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
      : res.status === 403
        ? "forbidden"
        : res.status === 404
          ? "not-found"
          : res.status === 409
            ? "conflict"
            : res.status === 400
              ? "bad-request"
              : "server";
  return new WorkbookRequestError(kind, res.status, message, payload.currentRevision);
}

/**
 * Run a request against the engine.
 *
 * A missing token is `unauthorized` rather than a thrown configuration error:
 * the autosaver's error handler already knows what to do with that — stop
 * trying, keep editing locally, say "Sign in to save" — and a throw of any other
 * shape would land in its generic branch and lose that sentence.
 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let base: string;
  try {
    base = readConfig(PUBLIC_ENV).apiUrl;
  } catch {
    throw new WorkbookRequestError("server", 0, "Cowork is not connected to its backend.");
  }

  const token = await idToken().catch(() => null);
  if (!token) throw new WorkbookRequestError("unauthorized", 401, "Sign in to save your workbook.");

  try {
    return await fetch(joinUrl(base, path), {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new WorkbookRequestError("network", 0, "Could not reach the server.");
  }
}

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const res = await request(PATH);
  if (!res.ok) throw await errorFrom(res);
  const body = (await res.json()) as { workbooks: WorkbookSummary[] };
  return body.workbooks ?? [];
}

export async function createWorkbook(
  title: string,
  data: SerializedWorkbook,
): Promise<{ id: string; title: string; revision: number }> {
  const res = await request(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, data }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function loadWorkbook(id: string): Promise<LoadedWorkbook> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}`);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function saveWorkbook(
  id: string,
  data: SerializedWorkbook,
  baseRevision: number,
): Promise<{ revision: number; updatedAt: string }> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, baseRevision }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function renameWorkbook(id: string, title: string): Promise<{ title: string }> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function deleteWorkbook(id: string): Promise<void> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await errorFrom(res);
}

/** One person's standing on a workbook, as the sharing UI edits it. */
export interface ShareGrant {
  /** An employee id. */
  principalId: string;
  role: "viewer" | "commenter" | "editor";
}

/** Who a workbook is shared with. Owner-only; a 403 means you are not the owner. */
export async function listShares(id: string): Promise<ShareGrant[]> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}/shares`);
  if (!res.ok) throw await errorFrom(res);
  return ((await res.json()) as { shares: ShareGrant[] }).shares ?? [];
}

/** Replace the whole share list. Passing `[]` makes the workbook private again. */
export async function setShares(id: string, shares: ShareGrant[]): Promise<ShareGrant[]> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}/shares`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
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

/* ── Version history ─────────────────────────────────────────────────────── */

export interface WorkbookVersion {
  id: string;
  label: string;
  revision: number;
  createdAt: string;
  createdById: string;
  createdByName: string;
  auto: boolean;
}

export async function listVersions(id: string): Promise<WorkbookVersion[]> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}/versions`);
  if (!res.ok) throw await errorFrom(res);
  const body = (await res.json()) as { versions: WorkbookVersion[] };
  return body.versions ?? [];
}

export async function saveVersion(id: string, label: string, auto = false): Promise<WorkbookVersion> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, auto }),
  });
  if (!res.ok) throw await errorFrom(res);
  const body = (await res.json()) as { version: WorkbookVersion };
  return body.version;
}

export async function restoreVersion(id: string, versionId: string): Promise<{ revision: number; data: SerializedWorkbook }> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, { method: "POST" });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function deleteVersion(id: string, versionId: string): Promise<void> {
  const res = await request(`${PATH}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`, { method: "DELETE" });
  if (!res.ok) throw await errorFrom(res);
}
