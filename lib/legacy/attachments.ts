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
  /**
   * A token taken NOW, for the call that happens after the bytes.
   *
   * **Reported 28 September 2026: a 3 GB file uploaded to 100% and then
   * failed.** `token` is read once, before the first byte moves, and the
   * finalize an hour later was still sending that same string. A sign-in token
   * lives for one hour, so the upload delivered every byte to Google and then
   * died on the one small call that records it — the worst possible place,
   * because all the waiting had already been paid.
   *
   * It is not only enormous files. The token can already be fifty-nine minutes
   * old when the upload STARTS, so a five-minute upload hits it just as
   * surely — which is exactly why this looked random rather than like a rule.
   *
   * Optional so a caller with nothing to refresh with still works: absent, the
   * finalize uses `token` exactly as it did.
   */
  freshToken?: () => Promise<string | null>;
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

  /**
   * **A large file is never sent down the fallback, because it cannot survive
   * it.**
   *
   * The resumable path streams browser-to-Google in bounded chunks and has no
   * size ceiling — which is why the message composer, which uses only that
   * path, takes a file of any size. This fallback is the opposite shape: ONE
   * POST carrying the whole file, through the engine, into
   * `multer.memoryStorage()`. A 200 MB submission attempted there spends
   * minutes uploading to a server that has to hold all of it in memory, and
   * then fails — after the person has watched a bar climb, which is worse than
   * refusing immediately.
   *
   * So the safety net is kept for the files it can actually catch, and a large
   * one is answered with the reason the RESUMABLE path gave. That failure is
   * the true one and the one worth fixing; burying it under a doomed second
   * attempt is how "big files just do not upload" stayed unexplained.
   *
   * It also brings this path in line with the message thread, which has no
   * fallback at all — the same concept, and the same result for a big file.
   */
  if (input.file.size > MULTIPART_CEILING_BYTES) return r;
  return uploadViaMultipart(input);
}

/**
 * The largest file worth attempting through the whole-file fallback.
 *
 * Not a limit on uploads — the resumable path above has none and keeps none.
 * This is only the point past which the FALLBACK is known to be futile, so the
 * real error is reported instead of being replaced by a slower one.
 */
const MULTIPART_CEILING_BYTES = 25 * 1024 * 1024;

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

  /**
   * 3 — finalize into the private record (sniffs the mime, no public grant).
   *
   * **With a token taken now, not the one from before the bytes.** See
   * `freshToken`: every byte is already at Google by this point, and failing
   * here throws away the entire transfer over a header. Tried twice — a token
   * that was valid when this call was assembled can still expire in the
   * moments before the server reads it, and the second attempt costs one small
   * request against a file that may have taken an hour.
   */
  for (let attempt = 1; attempt <= 2; attempt++) {
    const current = (await input.freshToken?.().catch(() => null)) ?? input.token;
    try {
      const res = await fetch(`${baseUrl()}/cowork/attachments/finalize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${current}`,
          "Content-Type": "application/json",
        },
        signal: input.signal,
        body: JSON.stringify({ fileId, entityType: input.entityType, entityId: input.entityId }),
      });
      const body = (await res.json().catch(() => ({}))) as { attachment?: AttachmentMeta; error?: string };
      if (res.ok && body.attachment) return { ok: true, data: body.attachment };
      /* Only a refusal is worth a second go, and only when there is something
         new to send — repeating a rejected body with the same token would just
         be the same refusal twice. */
      if ((res.status === 401 || res.status === 403) && attempt === 1 && input.freshToken)
        continue;
      return failure(res.status, body.error ?? "The upload could not be saved.");
    } catch {
      if (input.signal?.aborted) return failure(0, "Upload cancelled.");
      if (attempt === 1) continue;
      return failure(0, "The upload could not be saved.");
    }
  }
  return failure(0, "The upload could not be saved.");
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

/**
 * A URL the BROWSER can open on its own, for one file, for ten minutes.
 *
 * **Reported 28 September 2026: a 3 GB file showed "Opening…" for ever.** The
 * download above is the reason. An anchor with a `download` attribute cannot
 * carry an Authorization header, so the page fetched the file itself and
 * `res.blob()` buffered every byte into memory before anything was handed
 * over. At a few megabytes nobody notices. At three gigabytes it is a tab
 * holding 3 GB of RAM, no progress, no save dialog, and — often — a crash.
 *
 * With a ticket the browser does the downloading: straight to disk, with a
 * progress bar and a cancel button, at any size, and it survives leaving the
 * page. The engine issues one only after the same permission check the
 * authenticated route performs.
 *
 * Returns the full URL to open. A 404 here means the engine predates the
 * route, and the caller falls back to fetching the bytes itself.
 */
export async function createDownloadTicket(input: {
  token: string;
  id: string;
}): Promise<LegacyResult<{ url: string }>> {
  try {
    const r = await fetch(
      `${baseUrl()}/cowork/attachments/${encodeURIComponent(input.id)}/download-ticket`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.token}` },
      },
    );
    const body = (await r.json().catch(() => ({}))) as {
      path?: string;
      error?: string;
    };
    if (!r.ok || !body.path) {
      return failure(
        r.status,
        body.error ??
          (r.status === 403
            ? "You do not have access to this file."
            : "That file could not be opened."),
      );
    }
    /* The engine returns a PATH — it does not reliably know the origin it was
       reached on, and this side already does. */
    return { ok: true, data: { url: `${baseUrl()}${body.path}` } };
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
