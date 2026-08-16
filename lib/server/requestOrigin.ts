/**
 * The origin to put in a URL a browser will actually be sent to.
 *
 * The rule callers want is right: use **the origin the request arrived at**,
 * because the session cookie is host-scoped and `localhost` / `127.0.0.1` are
 * different origins to browsers and to Google alike.
 *
 * What breaks it: `new URL(request.url).origin` is not that origin. Under
 * `next dev -H 0.0.0.0` the framework reports the BIND address. Reported
 * 17 Aug 2026 — a finished Gmail consent redirected to
 * `http://0.0.0.0:3000/settings`, `ERR_ADDRESS_INVALID`, on the last hop of a
 * flow that had otherwise succeeded. The same expression built the admin's
 * password-reset links, which an administrator copies and sends to somebody:
 * an unopenable address handed to a person who cannot diagnose it.
 *
 * The browser's own `Host` header is the faithful source; the URL is only a
 * fallback.
 *
 * Deliberately dependency-free — no `server-only` — so it stays testable.
 */

/** Hosts that are bind addresses, not places a browser can be sent. */
function isUnroutable(host: string): boolean {
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "0.0.0.0" || name === "::" || name === "";
}

export function callbackOrigin(input: {
  /** `request.url` — trusted for scheme and as the last-resort host. */
  requestUrl: string;
  /** The browser's `Host` header, or null. The faithful origin. */
  hostHeader: string | null;
  /** `x-forwarded-proto`, where a proxy terminates TLS. */
  forwardedProto?: string | null;
  /**
   * `GOOGLE_REDIRECT_URI`, or null when unconfigured.
   *
   * The final fallback: Google will only ever have redirected the browser to
   * this exact address, so its origin is by construction one the browser can
   * reach — which is more than can be said for a bind address.
   */
  configuredRedirectUri?: string | null;
}): string {
  const url = new URL(input.requestUrl);
  const scheme =
    input.forwardedProto?.trim() || url.protocol.replace(/:$/, "") || "http";

  let host = input.hostHeader?.trim() || url.host;
  if (isUnroutable(host)) {
    if (input.configuredRedirectUri) {
      try {
        return new URL(input.configuredRedirectUri).origin;
      } catch {
        /* fall through to the port rewrite below */
      }
    }
    /* No configured URI to lean on: keep the port, name the loopback. */
    const port = host.match(/:(\d+)$/)?.[1];
    host = port ? `localhost:${port}` : "localhost";
  }

  return `${scheme}://${host}`;
}
