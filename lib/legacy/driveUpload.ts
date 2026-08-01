import { readConfig } from "./config.ts";
import { PUBLIC_ENV } from "./publicEnv.ts";
import type { LegacyResult } from "./envelope.ts";

/**
 * Public media, straight to Google Drive.
 *
 * **This is the old application's pipeline, not a new one.** `lib/mediaUploadApi.js`
 * in `grav-CoworkSpace` does exactly these three steps, and the backend routes
 * it calls (`mediaUpload.js`) are already deployed. Everything a person attaches
 * — a screenshot in a chat, a picture on a mind-map card, an image in a document
 * — belongs in the same place the old product put it, so that one file is one
 * file no matter which application wrote it.
 *
 * ## Three steps, and the middle one does not touch our servers
 *
 *   1. `POST /cowork/upload/drive-session` — the backend asks Drive for a
 *      resumable session and hands back the URL. Bytes: none.
 *   2. `PUT <sessionUrl>` — the BROWSER streams the file straight to Google.
 *   3. `POST /cowork/upload/drive-finalize` — the backend marks the file
 *      readable and reports its metadata. Bytes: none.
 *
 * The shape matters. The alternative — and what this product was doing for chat
 * attachments — is `POST /cowork/upload/pdf`, which multiparts the whole file
 * through the Express process into memory before forwarding it. That works for a
 * screenshot and falls over for a video: the backend's own comment on the
 * resumable route says it exists because "500MB files hammering backend RAM/
 * bandwidth" was a real failure. There is no reason to keep a second, worse path
 * for the same job.
 *
 * ## What "public" means here, and what it excludes
 *
 * `drive-finalize` grants `role: reader, type: anyone`, because an `<img>` cannot
 * carry an Authorization header and `lh3.googleusercontent.com` will not serve a
 * private file. That is the trade the old product made for inline media and it
 * is the one being kept.
 *
 * It is **not** the trade for task attachments. Those go through
 * `lib/legacy/attachments.ts` to a different service that grants no permission at
 * all and streams bytes back through an authenticated route. Anything
 * confidential belongs there. This module is for media meant to be seen by
 * whoever can see the thing it is attached to.
 */

/** What the engine reports once the bytes have landed. */
export interface DriveFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  /** Bytes, from Drive's own metadata. Falls back to the local size. */
  sizeBytes: number;
  /** Drive's thumbnail URL for an image, its view link otherwise. */
  url: string;
  thumbnailUrl: string | null;
  downloadUrl: string | null;
  viewUrl: string | null;
}

function baseUrl(): string {
  return readConfig(PUBLIC_ENV).apiUrl.replace(/\/+$/, "");
}

function failure(status: number, message: string): LegacyResult<never> {
  return {
    ok: false,
    error: {
      message,
      status,
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

async function postJson<T>(
  token: string,
  path: string,
  body: unknown,
): Promise<LegacyResult<T>> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    > & { error?: string };
    if (!res.ok) {
      /* The engine's own wording where it gave one. "Attachment storage is not
         configured on this server" is actionable; "Upload failed" is not. */
      return failure(res.status, data.error ?? `The upload failed (${res.status}).`);
    }
    return { ok: true, data: data as T };
  } catch (e) {
    return failure(0, e instanceof Error ? e.message : "The request failed.");
  }
}

/**
 * Step 2: the bytes, from the browser to Google.
 *
 * `XMLHttpRequest` rather than `fetch`, and for the one reason that matters —
 * `fetch` cannot report upload progress at all, so a 40 MB file behind a silent
 * spinner is indistinguishable from a hung one.
 */
function putToSession(
  sessionUrl: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<LegacyResult<{ id: string }>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        resolve(failure(xhr.status, `Google refused the upload (${xhr.status}).`));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { id?: string };
        if (!body.id) {
          resolve(failure(0, "The upload finished without a file id."));
          return;
        }
        resolve({ ok: true, data: { id: body.id } });
      } catch {
        resolve(failure(0, "Google returned an unreadable response."));
      }
    };
    xhr.onerror = () =>
      resolve(failure(0, "The connection dropped during the upload."));
    xhr.onabort = () => resolve(failure(0, "Upload cancelled."));

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * Upload one file and return what it takes to render it.
 *
 * `onProgress` reports 0–1 across the byte transfer only. The two metadata calls
 * either side are a few hundred bytes each and reporting them would make the bar
 * jump rather than move.
 */
export async function uploadToDrive(input: {
  token: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<LegacyResult<DriveFile>> {
  const { file } = input;

  const session = await postJson<{ sessionUrl?: string }>(
    input.token,
    "/cowork/upload/drive-session",
    {
      fileName: file.name || "upload.bin",
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
    },
  );
  if (!session.ok) return session;
  if (!session.data.sessionUrl) {
    return failure(0, "The server did not open an upload session.");
  }

  const put = await putToSession(
    session.data.sessionUrl,
    file,
    input.onProgress,
    input.signal,
  );
  if (!put.ok) return put;

  const done = await postJson<Record<string, unknown>>(
    input.token,
    "/cowork/upload/drive-finalize",
    { fileId: put.data.id },
  );
  if (!done.ok) return done;

  const d = done.data;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;

  return {
    ok: true,
    data: {
      /* The id the engine confirms, not the one the browser was handed — they
         are the same string, and trusting the confirmation is what makes this a
         finalize rather than a formality. */
      fileId: str(d.fileId) ?? put.data.id,
      fileName: str(d.fileName) ?? file.name ?? "file",
      mimeType: str(d.mimeType) ?? file.type ?? "application/octet-stream",
      /* Drive reports size as a STRING. `Number` on the local file is the
         fallback, so a missing field never becomes NaN on screen. */
      sizeBytes: Number(d.size) || file.size || 0,
      url: str(d.url) ?? str(d.thumbnailUrl) ?? str(d.viewUrl) ?? "",
      thumbnailUrl: str(d.thumbnailUrl),
      downloadUrl: str(d.downloadUrl),
      viewUrl: str(d.viewUrl),
    },
  };
}
