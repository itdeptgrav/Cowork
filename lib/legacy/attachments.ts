import { readConfig } from "./config.ts";
import { PUBLIC_ENV } from "./publicEnv.ts";
import type { LegacyResult } from "./envelope.ts";
import { putToSession } from "./driveUpload.ts";

/**
 * Private Cowork attachments, over the wire.
 *
 * **Not through `legacyFetch`, and deliberately.** That helper serialises a
 * JSON body and parses a JSON response; an upload is `multipart/form-data` and
 * a download is a byte stream. Forcing both through it would mean teaching it
 * two shapes it exists to avoid, so these two calls are written out and share
 * its base-URL and error conventions.
 *
 * **No storage URL ever appears here.** The engine returns an id, and bytes are
 * fetched from the authenticated route with that id. A Drive link in this file
 * would be a second way to the file with none of the permission checks the
 * route performs.
 */

export interface AttachmentMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedBy?: string;
  uploadedAt?: string | null;
}

/** Every entity type the engine will hang a file off. */
export type AttachmentEntity =
  | "task"
  | "rework"
  | "submission"
  | "review"
  | "comment";

function baseUrl(): string {
  return readConfig(PUBLIC_ENV).apiUrl.replace(/\/+$/, "");
}

function failure(status: number, message: string): LegacyResult<never> {
  return {
    ok: false,
    error: {
      message,
      status,
      /* The kind decides whether a retry is offered. A refusal and a missing
         file cannot succeed on a second press; a dropped connection can. */
      kind:
        status === 401
          ? "auth"
          : status === 403
            ? "permission"
            : status === 404
              ? "not_found"
              : status === 0
                ? "network"
                : status >= 500
                  ? "server"
                  : "malformed",
    },
  };
}

interface UploadInput {
  token: string;
  file: File;
  entityType: AttachmentEntity;
  entityId: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload one private attachment.
 *
 * **Resumable, direct-to-Drive — with the multipart route as a fallback.** The
 * bytes go straight from the browser to Google (a session, then a resumable
 * PUT), so this never routes a large submission through the server's memory and
 * a drop at 95% resumes rather than restarting. The file stays PRIVATE: the
 * finalize records it with no public grant, exactly as the multipart path did,
 * and it is only reachable through the authenticated download route.
 *
 * If the resumable path cannot even START — a server or network failure opening
 * the session, never a permission refusal — it falls back to the old multipart
 * upload, so a file still lands. A refusal (auth/permission) is returned as-is:
 * it would fail identically on the fallback.
 */
export async function uploadAttachment(
  input: UploadInput,
): Promise<LegacyResult<AttachmentMeta>> {
  const r = await uploadViaResumable(input);
  if (r.ok) return r;
  /* Only fall back when the RESUMABLE path failed to start for a reason the
     multipart path might survive — not on a refusal, which is the same either
     way, and not once bytes were already flowing. */
  if (r.error.kind === "auth" || r.error.kind === "permission") return r;
  if ((r as { fallback?: boolean }).fallback !== true) return r;
  return uploadViaMultipart(input);
}

/** Open a private resumable session, PUT the bytes straight to Google, then
 *  finalize into the private record. */
async function uploadViaResumable(
  input: UploadInput,
): Promise<LegacyResult<AttachmentMeta> & { fallback?: boolean }> {
  const auth = { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" };

  /* 1 — open the session. A failure here is before any byte moved, so it is
     safe to fall back to multipart. */
  let sessionUrl: string;
  try {
    const res = await fetch(`${baseUrl()}/cowork/attachments/resumable-session`, {
      method: "POST",
      headers: auth,
      signal: input.signal,
      body: JSON.stringify({
        fileName: input.file.name,
        mimeType: input.file.type || "application/octet-stream",
        fileSize: input.file.size,
        entityType: input.entityType,
        entityId: input.entityId,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { sessionUrl?: string; error?: string };
    if (!res.ok || !body.sessionUrl) {
      /* A refusal is returned as-is; anything else is fallback-eligible. */
      const f = failure(res.status, body.error ?? "Could not start the upload.");
      return { ...f, fallback: res.status !== 401 && res.status !== 403 };
    }
    sessionUrl = body.sessionUrl;
  } catch {
    if (input.signal?.aborted) return failure(0, "Upload cancelled.");
    return { ...failure(0, "Could not start the upload."), fallback: true };
  }

  /* 2 — the browser streams the file to Google, resumable, with progress. */
  const put = await putToSession(sessionUrl, input.file, input.onProgress, input.signal);
  if ("expired" in put) {
    return { ...failure(0, "The upload session expired — please try again."), fallback: false };
  }
  if (!put.ok) return put; // already a LegacyResult; do not fall back mid-flight
  const fileId = put.data.id;

  /* 3 — finalize into the private record (sniffs the mime, no public grant). */
  try {
    const res = await fetch(`${baseUrl()}/cowork/attachments/finalize`, {
      method: "POST",
      headers: auth,
      signal: input.signal,
      body: JSON.stringify({ fileId, entityType: input.entityType, entityId: input.entityId }),
    });
    const body = (await res.json().catch(() => ({}))) as { attachment?: AttachmentMeta; error?: string };
    if (res.ok && body.attachment) return { ok: true, data: body.attachment };
    return failure(res.status, body.error ?? "The upload could not be saved.");
  } catch {
    if (input.signal?.aborted) return failure(0, "Upload cancelled.");
    return failure(0, "The upload could not be saved.");
  }
}

/**
 * The original multipart upload — kept as the fallback.
 *
 * `onProgress` reports 0–1 and is driven by `XMLHttpRequest` rather than
 * `fetch`, which cannot report upload progress at all. That is the only reason
 * this is not a `fetch` call — a 40 MB reference document uploading behind a
 * silent spinner is indistinguishable from a hung one.
 */
function uploadViaMultipart(input: UploadInput): Promise<LegacyResult<AttachmentMeta>> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("file", input.file);
    form.append("entityType", input.entityType);
    form.append("entityId", input.entityId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl()}/cowork/attachments`);
    xhr.setRequestHeader("Authorization", `Bearer ${input.token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && input.onProgress) {
        input.onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      let body: { attachment?: AttachmentMeta; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        /* A non-JSON body from a proxy or gateway. The status still tells us
           what happened, and inventing a message from HTML would be worse. */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.attachment) {
        resolve({ ok: true, data: body.attachment });
        return;
      }
      resolve(
        failure(
          xhr.status,
          body.error ?? `The file could not be uploaded (${xhr.status}).`,
        ),
      );
    };

    xhr.onerror = () =>
      resolve(failure(0, "The file could not be uploaded — the request failed."));
    xhr.onabort = () => resolve(failure(0, "Upload cancelled."));

    input.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** Everything attached to one entity. Metadata only — never bytes. */
export async function listAttachments(input: {
  token: string;
  entityType: AttachmentEntity;
  entityId: string;
}): Promise<LegacyResult<AttachmentMeta[]>> {
  try {
    const r = await fetch(
      `${baseUrl()}/cowork/attachments/entity/${encodeURIComponent(
        input.entityType,
      )}/${encodeURIComponent(input.entityId)}`,
      { headers: { Authorization: `Bearer ${input.token}` } },
    );
    const body = (await r.json().catch(() => ({}))) as {
      attachments?: AttachmentMeta[];
      error?: string;
    };
    if (!r.ok) {
      return failure(r.status, body.error ?? "Those files could not be listed.");
    }
    return { ok: true, data: body.attachments ?? [] };
  } catch (e) {
    return failure(0, e instanceof Error ? e.message : "The request failed.");
  }
}

/**
 * Fetch the bytes as a blob.
 *
 * A blob rather than a URL, because the route requires an `Authorization`
 * header and an `<img src>` or an `<a href>` cannot carry one. The caller turns
 * this into a short-lived object URL and revokes it — which is also what keeps
 * the file out of the browser's history and off the clipboard as a shareable
 * link.
 */
export async function downloadAttachment(input: {
  token: string;
  id: string;
}): Promise<LegacyResult<Blob>> {
  try {
    const r = await fetch(
      `${baseUrl()}/cowork/attachments/${encodeURIComponent(input.id)}`,
      { headers: { Authorization: `Bearer ${input.token}` } },
    );
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return failure(
        r.status,
        body.error ??
          (r.status === 403
            ? "You do not have access to this file."
            : "That file could not be opened."),
      );
    }
    return { ok: true, data: await r.blob() };
  } catch (e) {
    return failure(0, e instanceof Error ? e.message : "The request failed.");
  }
}

export async function deleteAttachment(input: {
  token: string;
  id: string;
}): Promise<LegacyResult<void>> {
  try {
    const r = await fetch(
      `${baseUrl()}/cowork/attachments/${encodeURIComponent(input.id)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${input.token}` } },
    );
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return failure(r.status, body.error ?? "That file could not be removed.");
    }
    return { ok: true, data: undefined };
  } catch (e) {
    return failure(0, e instanceof Error ? e.message : "The request failed.");
  }
}
