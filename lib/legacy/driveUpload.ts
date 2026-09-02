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

/**
 * How many times a step is attempted before it is called a failure.
 *
 * Three, and not more, because the two metadata calls are small and fast: a
 * step that has failed three times over roughly four seconds is failing for a
 * reason a fourth attempt will not fix.
 */
const MAX_ATTEMPTS = 3;

/** Waits between attempts: 500ms, then 1500ms. Doubling from a short base. */
function backoffMs(attempt: number): number {
  return 500 * 3 ** (attempt - 1);
}

/**
 * How long a metadata call may take. The bytes are NOT on these requests —
 * they are a few hundred each — so a slow one is a stalled one.
 */
const META_TIMEOUT_MS = 30_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether a failed step is worth trying again.
 *
 * **Only transport faults and server faults.** A 401 will be a 401 next time,
 * and a 403 means the answer is no — retrying those turns an instant, readable
 * refusal into a four-second wait for the same words. `status: 0` is the case
 * that matters most: it is a connection that dropped, which is exactly what
 * "the upload sometimes fails for no reason" turns out to be.
 */
function worthRetrying(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

async function postJsonOnce<T>(
  token: string,
  path: string,
  body: unknown,
): Promise<LegacyResult<T>> {
  /* Bounded, because `fetch` has no timeout of its own: a connection the server
     accepts and never answers stays pending for as long as the tab is open, and
     an upload that never resolves is the one shape no caller can recover from. */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
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
    if (controller.signal.aborted)
      return failure(0, `The server did not answer within ${META_TIMEOUT_MS / 1000}s.`);
    return failure(0, e instanceof Error ? e.message : "The request failed.");
  } finally {
    clearTimeout(timer);
  }
}

/** A metadata call, retried while the failure looks transient. */
async function postJson<T>(
  token: string,
  path: string,
  body: unknown,
): Promise<LegacyResult<T>> {
  let last: LegacyResult<T> = failure(0, "The request was never attempted.");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await postJsonOnce<T>(token, path, body);
    if (last.ok || !worthRetrying(last.error.status)) return last;
    if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt));
  }
  return last;
}

/**
 * How long the byte transfer may stall before it is treated as dead.
 *
 * This is a STALL timer, not a duration cap: `xhr.timeout` measures the whole
 * request, which would kill a large upload that is progressing perfectly well
 * over a slow line. It is reset on every progress event, so it only fires when
 * nothing has moved for two minutes — which is a dropped connection the socket
 * has not noticed yet, the case that otherwise hangs for ever.
 */
const STALL_TIMEOUT_MS = 120_000;

/** What one attempt at sending bytes ended in. */
type PutOutcome =
  /** Google has the whole file. */
  | { kind: "complete"; id: string }
  /** Google has this many bytes and wants the rest. */
  | { kind: "incomplete"; received: number }
  /** The session is gone; only a fresh one can help. */
  | { kind: "expired" }
  | { kind: "failed"; result: LegacyResult<never> };

/**
 * Ask Google how much of the file it already has.
 *
 * **This is the call that makes a resumable upload resumable, and it did not
 * exist.** The code opened a resumable session, streamed to it, and treated a
 * dropped connection as fatal — so a 40 MB file that failed at 95% was
 * re-uploaded from zero, or simply reported as a failure. That is the whole of
 * "uploads sometimes fail unexpectedly, and it is worse on big files".
 *
 * The protocol: a PUT with an empty body and `Content-Range: bytes` STAR/total
 * answers `308` plus a `Range: bytes=0-N` header naming the last byte received.
 * `200`/`201` means it already has everything; `404`/`410` means the session
 * has expired and nothing can be resumed onto it.
 */
function queryReceived(
  sessionUrl: string,
  total: number,
): Promise<PutOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader("Content-Range", `bytes */${total}`);
    xhr.onload = () => {
      if (xhr.status === 308) {
        /* `Range: bytes=0-1023` means 1024 bytes are in. A 308 with NO Range
           header means Google has nothing yet, which is a resume from zero
           rather than an error. */
        const range = xhr.getResponseHeader("Range");
        const end = range ? Number(range.split("-")[1]) : NaN;
        resolve({
          kind: "incomplete",
          received: Number.isFinite(end) ? end + 1 : 0,
        });
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { id?: string };
          if (body.id) {
            resolve({ kind: "complete", id: body.id });
            return;
          }
        } catch {
          /* Complete but unreadable — fall through and let the caller retry. */
        }
        resolve({ kind: "failed", result: failure(0, "Google returned an unreadable response.") });
        return;
      }
      if (xhr.status === 404 || xhr.status === 410) {
        resolve({ kind: "expired" });
        return;
      }
      resolve({
        kind: "failed",
        result: failure(xhr.status, `Google refused the upload (${xhr.status}).`),
      });
    };
    xhr.onerror = () =>
      resolve({ kind: "failed", result: failure(0, "The connection dropped.") });
    xhr.send();
  });
}

/**
 * Send the file from `offset` onward.
 *
 * `XMLHttpRequest` rather than `fetch`, and for the one reason that matters —
 * `fetch` cannot report upload progress at all, so a 40 MB file behind a silent
 * spinner is indistinguishable from a hung one.
 *
 * Progress is reported against the WHOLE file, not the slice, so a resumed
 * upload continues the bar from where it stopped instead of restarting it at
 * zero — which would look exactly like the failure this is recovering from.
 */
function putFrom(
  sessionUrl: string,
  file: File,
  offset: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<PutOutcome> {
  const total = file.size;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    /* Only on a resume: a `Content-Range` on a whole-file PUT is legal but
       redundant, and omitting it keeps the first attempt byte-identical to what
       this did before. */
    if (offset > 0) {
      xhr.setRequestHeader(
        "Content-Range",
        `bytes ${offset}-${total - 1}/${total}`,
      );
    }

    let stall: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: PutOutcome) => {
      if (stall) clearTimeout(stall);
      resolve(outcome);
    };
    const armStall = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => {
        xhr.abort();
        settle({
          kind: "failed",
          result: failure(0, "The upload stopped responding."),
        });
      }, STALL_TIMEOUT_MS);
    };
    armStall();

    xhr.upload.onprogress = (e) => {
      armStall();
      if (e.lengthComputable && onProgress) {
        onProgress(Math.min(1, (offset + e.loaded) / total));
      }
    };
    xhr.onload = () => {
      if (xhr.status === 308) {
        const range = xhr.getResponseHeader("Range");
        const end = range ? Number(range.split("-")[1]) : NaN;
        settle({
          kind: "incomplete",
          received: Number.isFinite(end) ? end + 1 : offset,
        });
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        settle({
          kind: xhr.status === 404 || xhr.status === 410 ? "expired" : "failed",
          result: failure(xhr.status, `Google refused the upload (${xhr.status}).`),
        } as PutOutcome);
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { id?: string };
        if (!body.id) {
          settle({ kind: "failed", result: failure(0, "The upload finished without a file id.") });
          return;
        }
        settle({ kind: "complete", id: body.id });
      } catch {
        settle({ kind: "failed", result: failure(0, "Google returned an unreadable response.") });
      }
    };
    xhr.onerror = () =>
      settle({
        kind: "failed",
        result: failure(0, "The connection dropped during the upload."),
      });
    xhr.onabort = () =>
      settle({ kind: "failed", result: failure(0, "Upload cancelled.") });

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(offset > 0 ? file.slice(offset) : file);
  });
}

/**
 * Get the whole file to Google, resuming across interruptions.
 *
 * Each attempt asks where it got to and continues from there, so a connection
 * that drops at 95% costs the last 5% rather than the whole transfer. An
 * expired session cannot be resumed onto and is reported so the caller can open
 * a fresh one.
 *
 * A CANCELLED upload is never retried. The signal aborting is somebody's
 * decision, not a fault, and retrying it would ignore them.
 */
export async function putToSession(
  sessionUrl: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<LegacyResult<{ id: string }> | { expired: true }> {
  let offset = 0;
  let last: LegacyResult<never> = failure(0, "The upload was never attempted.");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return failure(0, "Upload cancelled.");

    const outcome = await putFrom(sessionUrl, file, offset, onProgress, signal);
    if (outcome.kind === "complete") return { ok: true, data: { id: outcome.id } };
    if (outcome.kind === "expired") return { expired: true };
    if (outcome.kind === "incomplete") {
      /* Progress without completion: continue from where it got to, and do NOT
         count it as a failed attempt — it is the protocol working. */
      offset = outcome.received;
      attempt--;
      if (offset >= file.size) {
        /* Everything is there but no id came back. Ask once more; the query
           returns the id when Google considers the upload finished. */
        const q = await queryReceived(sessionUrl, file.size);
        if (q.kind === "complete") return { ok: true, data: { id: q.id } };
        if (q.kind === "expired") return { expired: true };
        return q.kind === "failed" ? q.result : failure(0, "The upload did not finish.");
      }
      continue;
    }

    last = outcome.result;
    if (signal?.aborted) return last;
    if (attempt >= MAX_ATTEMPTS) break;

    await sleep(backoffMs(attempt));
    /* Ask before resending: the connection may have dropped after Google had
       already taken most of the file, and starting from `offset` blind would
       re-send bytes it has — or worse, skip bytes it does not. */
    const where = await queryReceived(sessionUrl, file.size);
    if (where.kind === "complete") return { ok: true, data: { id: where.id } };
    if (where.kind === "expired") return { expired: true };
    if (where.kind === "incomplete") offset = where.received;
  }

  return last;
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

  /**
   * A session is opened at most twice.
   *
   * A resumable session can EXPIRE — Google drops one that has been idle, and
   * nothing can be resumed onto it afterwards. That is unrecoverable within a
   * session and trivially recoverable outside one: open another and send the
   * file again. Once, though, not in a loop, because a session that expires
   * immediately is a configuration problem and retrying it for ever would hide
   * that behind a spinner.
   */
  let put: LegacyResult<{ id: string }> | null = null;

  for (let round = 1; round <= 2 && put === null; round++) {
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

    const attempt = await putToSession(
      session.data.sessionUrl,
      file,
      input.onProgress,
      input.signal,
    );
    if ("expired" in attempt) {
      if (round === 2)
        return failure(0, "The upload session kept expiring. Please try again.");
      /* Back to zero on a genuinely new session — there is nothing on the far
         side to resume from. The bar restarting is honest here. */
      input.onProgress?.(0);
      continue;
    }
    put = attempt;
  }

  if (!put) return failure(0, "The upload could not be started.");
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
