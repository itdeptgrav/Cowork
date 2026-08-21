/**
 * Making legacy's inconsistent responses one shape.
 *
 * The legacy backend answers in at least four ways — `{ employees: [...] }`,
 * `{ success, data }`, `{ error }`, and bare objects or arrays — sometimes
 * within the same route file. Every caller currently reimplements the guesswork.
 *
 * This is where that stops. One function decides what a response meant, and
 * everything above it receives a discriminated union it cannot forget to check.
 *
 * It parses; it does not interpret. Whether an empty list is an error is a
 * question for the caller, not for the parser.
 */

export type LegacyResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LegacyError };

export interface LegacyError {
  /** What to show a person. Legacy's own message when it gave one. */
  message: string;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
  /**
   * Why this failed, for deciding whether to offer a retry.
   *
   * `network` and `server` are worth retrying; `auth`, `permission` and
   * `not_found` are not, and offering a retry button for them wastes somebody's
   * time on an action that cannot succeed.
   */
  kind: "network" | "auth" | "permission" | "not_found" | "server" | "malformed";
}

/**
 * The error message a legacy response carries, if any.
 *
 * Legacy uses `error` in most places and `message` in others, and occasionally
 * returns a bare string. Preferring its wording over a generic one matters:
 * `"TL can only bleach employees in their own department."` explains the refusal;
 * "Request failed" does not.
 */
export function readErrorMessage(body: unknown): string | null {
  /* A plain-text body IS the message — legacy answers some failures that way.
     A markup body is not: it is a page from Express's default 404 handler, or
     from nginx, or from whatever sits in front of the engine, and none of them
     wrote it for a person to read. Passing it through put a literal
     `<!DOCTYPE html> … <pre>Cannot POST /cowork/…` into the UI where the
     explanation should have been. */
  if (typeof body === "string" && body.trim())
    return looksLikeMarkup(body) ? null : body.trim();
  if (!isRecord(body)) return null;

  for (const key of ["error", "message", "msg", "detail"]) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** What an HTTP status means for retry-ability. */
export function classify(status: number): LegacyError["kind"] {
  if (status === 0) return "network";
  if (status === 401) return "auth";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "server";
}

/**
 * Whether offering a retry is honest.
 *
 * A 403 will still be a 403 after a retry. Only failures that might resolve on
 * their own get a button.
 */
export function isRetryable(error: LegacyError): boolean {
  return error.kind === "network" || error.kind === "server";
}

/**
 * The payload inside whatever envelope legacy used.
 *
 * `key` names the field for the `{ employees: [...] }` style. When legacy
 * answered `{ success, data }` the data is unwrapped; when it answered bare,
 * the body is the payload.
 *
 * **`success: false` is an error even with HTTP 200.** Legacy does this, and a
 * parser that only looked at the status code would report a refusal as a
 * successful empty result — which is the failure that puts "no employees" on
 * screen when the real answer was "you are not allowed to see them".
 */
export function unwrap<T>(
  body: unknown,
  key?: string,
): LegacyResult<T> {
  if (isRecord(body) && body.success === false) {
    return {
      ok: false,
      error: {
        message: readErrorMessage(body) ?? "The request was refused.",
        status: 200,
        kind: "server",
      },
    };
  }

  if (key && isRecord(body) && key in body) {
    return { ok: true, data: body[key] as T };
  }

  if (isRecord(body) && "data" in body && body.success !== undefined) {
    return { ok: true, data: body.data as T };
  }

  if (body === null || body === undefined) {
    return {
      ok: false,
      error: {
        message: "The server returned an empty response.",
        status: 0,
        kind: "malformed",
      },
    };
  }

  return { ok: true, data: body as T };
}

/** A failed result from an HTTP status and body. */
export function failure(status: number, body: unknown): LegacyResult<never> {
  return {
    ok: false,
    error: {
      message: readErrorMessage(body) ?? defaultMessage(status, looksLikeMarkup(body)),
      status,
      kind: classify(status),
    },
  };
}

/**
 * Whether a body is a web page rather than an answer.
 *
 * Deliberately crude — a leading `<` after trimming, or a doctype. Anything an
 * application route writes for a person to read does not start that way, and
 * anything that does was written by a framework's default handler for a
 * browser's benefit, not a reader's.
 */
function looksLikeMarkup(body: unknown): boolean {
  if (typeof body !== "string") return false;
  const head = body.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<");
}

/**
 * @param servedMarkup Whether the engine answered with a page instead of an
 *   answer. It changes what a 404 MEANS: a route that exists and found nothing
 *   replies in JSON, so an HTML 404 is Express's fallback saying no such route
 *   is mounted at all — which is a stale deployment, not a missing record.
 *   Telling somebody "that could not be found" when the truth is "this server
 *   has not been updated" sends them looking for the wrong thing.
 */
function defaultMessage(status: number, servedMarkup = false): string {
  switch (classify(status)) {
    case "network":
      return "Could not reach the server. Check your connection and try again.";
    case "auth":
      return "Your session has expired. Sign in again.";
    case "permission":
      return "You do not have access to this.";
    case "not_found":
      return servedMarkup
        ? "This server does not have that feature yet — it may be running an older version."
        : "That could not be found.";
    default:
      return servedMarkup
        ? "The server answered with an error page rather than an answer."
        : "Something went wrong on the server.";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
