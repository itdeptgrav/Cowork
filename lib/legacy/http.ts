import { joinUrl, readConfig } from "./config.ts";
import { type LegacyResult, failure, unwrap } from "./envelope.ts";
import { isForbiddenPath } from "./permissions.ts";
import { PUBLIC_ENV } from "./publicEnv.ts";

/**
 * The one way the adapter talks to the legacy Express backend.
 *
 * Every call returns a `LegacyResult` — a discriminated union a caller cannot
 * forget to check. Nothing here throws on an HTTP failure, because a thrown
 * error at this layer becomes a `try`/`catch` at every call site and, in the
 * legacy client, became no error handling at all: a failed read there leaves
 * stale data on screen with no indication anything went wrong.
 *
 * It transports. It does not interpret. Whether an empty list means "none" or
 * "not allowed" is a question for the module above.
 */

export interface LegacyRequest {
  /** Path under the legacy base URL, e.g. `/cowork/me`. */
  path: string;
  /**
   * `PUT` is here for REPLACEMENT, and only that.
   *
   * Legacy answers almost everything with POST or PATCH. The one caller that
   * needs PUT is the mindmap card tree, which is replaced whole on every save
   * rather than patched — see `saveMindMapNodes`. Widening the union is the
   * honest fix; sending a replacement as a PATCH would describe it as a
   * partial update to anybody reading the network tab.
   */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body. Omit for GET. */
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /**
   * Envelope key to unwrap, e.g. `"employees"` for `{ employees: [...] }`.
   *
   * Legacy answers in at least four shapes, sometimes within one route file.
   * Naming the key per call is deliberate — a client that guessed would
   * eventually guess wrong and silently return the envelope as the payload.
   */
  envelopeKey?: string;
  /** Firebase ID token. Absent means the call goes out unauthenticated. */
  token?: string | null;
  signal?: AbortSignal;
  /** Override the default 20s timeout for calls that are expected to be slow. */
  timeoutMs?: number;
  /**
   * Let the browser REVALIDATE this GET instead of always re-downloading it.
   *
   * Everything here fetches `cache: "no-store"` by default — never keep a copy,
   * always fetch fresh — which is right for data that changes on every write and
   * is why the app trusts its own version-based cache instead of the browser's.
   *
   * A few reads are different: the employee directory is byte-identical between
   * calls almost every time, and it measured 99% duplicate traffic. For those,
   * `revalidate: true` switches to `cache: "no-cache"` — the browser keeps a
   * copy but still contacts the server EVERY time, sending `If-None-Match`. When
   * nothing changed the server answers `304` with no body and the browser serves
   * its copy; when it did, the browser gets the new body. **The data is never
   * stale** — the request still goes out every time and the server still decides
   * — only the bytes of an unchanged body stop crossing the wire. Pair only with
   * a route that sets an ETag (`services/httpCache.js`).
   */
  revalidate?: boolean;
}

/**
 * How long the engine has to answer before a request is treated as failed.
 *
 * Generous, because this is a backstop rather than a latency budget: a slow
 * engine should still work. What it prevents is the unbounded case — a
 * connection accepted and never answered — which no caller can recover from
 * because it never rejects.
 */
export const LEGACY_TIMEOUT_MS = 20_000;

/**
 * One signal that aborts when any of its inputs does.
 *
 * `AbortSignal.any` exists in current browsers and not in every runtime this
 * code is type-checked against, so the composition is written out. Listeners
 * are one-shot and the signals are request-scoped, so there is nothing to
 * detach afterwards.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

/**
 * Call the legacy backend.
 *
 * Refuses outright for the two debug routes that ship with no middleware —
 * `force-repair-self-assign` does a full-collection scan-and-write, and no new
 * UI has any business reaching it. A refusal here is cheaper than remembering
 * not to call it.
 */
export async function legacyFetch<T>(
  request: LegacyRequest,
  env: Record<string, string | undefined> = PUBLIC_ENV,
): Promise<LegacyResult<T>> {
  if (isForbiddenPath(request.path)) {
    return {
      ok: false,
      error: {
        message: `${request.path} is an unauthenticated legacy debug route and is not callable.`,
        status: 0,
        kind: "permission",
      },
    };
  }

  let url: string;
  try {
    url = joinUrl(readConfig(env).apiUrl, request.path) + queryString(request.query);
  } catch (e) {
    return {
      ok: false,
      error: {
        message: e instanceof Error ? e.message : "The legacy backend is not configured.",
        status: 0,
        kind: "malformed",
      },
    };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (request.token) headers.Authorization = `Bearer ${request.token}`;
  if (request.body !== undefined) headers["Content-Type"] = "application/json";

  /**
   * **Every request is bounded, because none of them was.**
   *
   * `fetch` has no timeout of its own: a connection the engine accepts and then
   * never answers stays pending for as long as the tab is open. `signal` was
   * available here and nothing ever passed one, so every call in this file —
   * `/cowork/me` among them — could hang indefinitely.
   *
   * That is the shape of failure that strands a caller: it never rejects, so no
   * `catch` runs, no retry fires, and any state machine waiting on it stays
   * where it is. Signing in awaits `/cowork/me` before it can set a status, so
   * one unanswered request is a permanent "Signing you in…".
   *
   * A caller's own `signal` still wins where it passes one — that is a
   * navigation cancelling its own request, and it must not be overridden. The
   * timeout is composed with it rather than replacing it.
   */
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(),
    request.timeoutMs ?? LEGACY_TIMEOUT_MS,
  );
  const signal = request.signal
    ? anySignal([request.signal, timeoutController.signal])
    : timeoutController.signal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal,
      /* `no-cache` still hits the server every time — it just lets the browser
         hold a copy and revalidate with `If-None-Match`, so an unchanged body
         comes back as a bodyless 304. `no-store` keeps nothing at all. Only
         reads that opt in and whose route sets an ETag use the former. */
      cache: request.revalidate ? "no-cache" : "no-store",
    });
  } catch (e) {
    /* A timeout aborts, so it arrives here as an AbortError like any other.
       Distinguished by asking OUR controller, because the two mean opposite
       things to a caller: a cancelled navigation is not a fault and must not
       raise a banner, while a timed-out engine is exactly what the caller needs
       to hear about — and what lets a retry ladder run instead of hanging. */
    if (timeoutController.signal.aborted) {
      return {
        ok: false,
        error: {
          message: `The Cowork engine did not answer within ${(request.timeoutMs ?? LEGACY_TIMEOUT_MS) / 1000}s.`,
          status: 0,
          kind: "network",
        },
      };
    }
    /* An aborted request is a navigation, not a fault. Reporting it as a network
       error puts an error banner on a screen the person has already left. */
    if (e instanceof Error && e.name === "AbortError") {
      return {
        ok: false,
        error: { message: "Request cancelled.", status: 0, kind: "network" },
      };
    }
    return {
      ok: false,
      error: {
        message: "Could not reach the Cowork server. Check your connection and try again.",
        status: 0,
        kind: "network",
      },
    };
  } finally {
    /* The response may still be streaming, but the abort timer must not keep
       firing behind it — an abort after a successful response would tear down
       a body the caller is still reading. */
    clearTimeout(timer);
  }

  const payload = await readBody(response);
  if (!response.ok) return failure(response.status, payload);
  return unwrap<T>(payload, request.envelopeKey);
}

/**
 * The response body, parsed as JSON where possible.
 *
 * Legacy occasionally answers with an HTML error page from a proxy rather than
 * JSON. Returning the raw text lets the envelope reader fall back to a generic
 * message instead of throwing a `SyntaxError` that reads like a bug in this
 * code.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function queryString(
  query: Record<string, string | number | undefined> | undefined,
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
