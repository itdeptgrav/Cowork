/**
 * Verifying a Firebase ID token, without the Admin SDK.
 *
 * A Firebase ID token is an RS256 JWT signed by Google, and Google publishes the
 * public keys. So verification needs no service account and no secret — only the
 * published certificates and Web Crypto, which means this runs on the Edge in
 * middleware as well as in a route handler.
 *
 * That matters: the obvious route is `firebase-admin`, which needs
 * `LEGACY_FIREBASE_SERVICE_ACCOUNT`. Requiring a secret to check who somebody is
 * would have made this migration wait on a credential we do not have, for no
 * reason. The service account stays needed only for Firestore writes.
 *
 * **What this proves and what it does not.** A valid token proves Google
 * authenticated this person against the Cowork Firebase project. It does *not*
 * prove they have a `cowork_employees` record, which is what the engine checks
 * and what carries the role. Identity comes from here; authority comes from
 * `GET /cowork/me`. Conflating them would let anybody with a Firebase account in
 * the project act as an employee.
 */

/** Google's published signing certificates for Firebase ID tokens. */
const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

export interface FirebaseClaims {
  /** Firebase user id. Matches `cowork_employees.authUid`. */
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  /** Seconds since epoch. */
  exp: number;
  iat: number;
}

export type VerifyFailure =
  | "malformed"
  | "unknown_key"
  | "bad_signature"
  | "expired"
  | "wrong_issuer"
  | "wrong_audience"
  | "no_subject";

export type VerifyResult =
  | { ok: true; claims: FirebaseClaims }
  | { ok: false; reason: VerifyFailure };

/* ── Pure decoding ────────────────────────────────────────────────────────── */

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
  } catch {
    return null;
  }
}

export interface DecodedToken {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** The `header.payload` bytes the signature covers. */
  signed: string;
  signature: Uint8Array;
}

/** Split and decode without verifying. Never trust the result on its own. */
export function decode(token: string): DecodedToken | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (!header || !payload) return null;
  try {
    return {
      header,
      payload,
      signed: `${parts[0]}.${parts[1]}`,
      signature: base64UrlDecode(parts[2]),
    };
  } catch {
    return null;
  }
}

/**
 * Everything except the cryptography.
 *
 * Separated so the rules — issuer, audience, expiry, subject — are testable
 * without a network or a real key, and so the order of checks is visible. Expiry
 * is checked against a caller-supplied time for the same reason.
 */
export function checkClaims(input: {
  payload: Record<string, unknown>;
  projectId: string;
  nowSeconds: number;
  /** Tolerance for clock skew between this machine and Google. */
  leewaySeconds?: number;
}): VerifyResult {
  const { payload, projectId } = input;
  const leeway = input.leewaySeconds ?? 60;

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    return { ok: false, reason: "wrong_issuer" };
  }
  if (payload.aud !== projectId) {
    return { ok: false, reason: "wrong_audience" };
  }

  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub) return { ok: false, reason: "no_subject" };

  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  if (exp + leeway <= input.nowSeconds) return { ok: false, reason: "expired" };

  return {
    ok: true,
    claims: {
      uid: sub,
      email: typeof payload.email === "string" ? payload.email : null,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === "string" ? payload.name : null,
      exp,
      iat: typeof payload.iat === "number" ? payload.iat : 0,
    },
  };
}

/* ── Key material ─────────────────────────────────────────────────────────── */

interface CachedKeys {
  keys: Record<string, string>;
  expiresAtMs: number;
}
let cache: CachedKeys | null = null;

/**
 * Google's certificates, cached for as long as Google says.
 *
 * The `max-age` on the response is respected rather than a fixed interval:
 * Google rotates these, and a cache that outlived the rotation would reject
 * every freshly-signed token — an outage that looks like "nobody can log in".
 */
export async function fetchCertificates(
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  if (cache && cache.expiresAtMs > nowMs) return cache.keys;

  const response = await fetchImpl(CERT_URL, { cache: "no-store" });
  if (!response.ok) {
    /* Serve stale rather than locking everybody out over one failed fetch. */
    if (cache) return cache.keys;
    throw new Error(`Could not fetch Google's signing keys (${response.status}).`);
  }

  const keys = (await response.json()) as Record<string, string>;
  cache = { keys, expiresAtMs: nowMs + maxAgeMs(response.headers.get("cache-control")) };
  return keys;
}

export function maxAgeMs(cacheControl: string | null): number {
  const match = /max-age=(\d+)/.exec(cacheControl ?? "");
  const seconds = match ? Number(match[1]) : 0;
  /* An hour when Google says nothing; never longer than six. */
  return Math.min(seconds > 0 ? seconds * 1000 : 3_600_000, 21_600_000);
}

/** Test seam. */
export function resetCertificateCache(): void {
  cache = null;
}

/* ── Full verification ────────────────────────────────────────────────────── */

/**
 * Verify a Firebase ID token end to end.
 *
 * Claims are checked **before** the signature, deliberately: an expired or
 * wrong-project token is rejected without an RSA verification, and the common
 * case — a token that simply aged out — costs nothing.
 */
export async function verifyIdToken(input: {
  token: string;
  projectId: string;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * How far past `exp` this token may be and still verify.
   *
   * Defaults to the ordinary clock-skew tolerance. A caller passes something
   * larger only to answer a different question — not *"may this token read
   * data"*, which is always no once it has expired, but *"was this browser
   * genuinely signed in"*, which stays true long after the hour is up and is
   * what decides whether to render the application or a sign-in form. See
   * `EXPIRY_GRACE_SECONDS` and `proxy.ts`.
   *
   * The signature is checked either way. Nothing here accepts a token Google
   * did not sign for this project.
   */
  leewaySeconds?: number;
}): Promise<VerifyResult> {
  const nowMs = input.nowMs ?? Date.now();
  const decoded = decode(input.token);
  if (!decoded) return { ok: false, reason: "malformed" };

  const claims = checkClaims({
    payload: decoded.payload,
    projectId: input.projectId,
    nowSeconds: Math.floor(nowMs / 1000),
    leewaySeconds: input.leewaySeconds,
  });
  if (!claims.ok) return claims;

  const kid = typeof decoded.header.kid === "string" ? decoded.header.kid : "";
  if (!kid || decoded.header.alg !== "RS256") {
    return { ok: false, reason: "malformed" };
  }

  const certificates = await fetchCertificates(nowMs, input.fetchImpl);
  const pem = certificates[kid];
  if (!pem) return { ok: false, reason: "unknown_key" };

  const key = await importCertificate(pem);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decoded.signature as BufferSource,
    new TextEncoder().encode(decoded.signed) as BufferSource,
  );

  return valid ? claims : { ok: false, reason: "bad_signature" };
}

/**
 * An X.509 certificate as a Web Crypto key.
 *
 * Google publishes certificates, not raw public keys, and `importKey` has no
 * `x509` format — so the SubjectPublicKeyInfo is located inside the DER by
 * walking it, rather than by assuming a byte offset that changes with key size.
 */
async function importCertificate(pem: string): Promise<CryptoKey> {
  const der = base64UrlDecode(
    pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""),
  );
  return crypto.subtle.importKey(
    "spki",
    findSubjectPublicKeyInfo(der) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/**
 * The SubjectPublicKeyInfo inside an X.509 certificate.
 *
 * Found by scanning for the RSA algorithm identifier — the OID
 * `1.2.840.113549.1.1.1` wrapped in a SEQUENCE — and taking the enclosing
 * structure. Crude next to a real DER parser, and sufficient: the sequence is
 * unambiguous in a certificate, and this avoids carrying a parser for one field.
 */
function findSubjectPublicKeyInfo(der: Uint8Array): Uint8Array {
  const marker = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
  for (let i = 0; i + marker.length < der.length; i++) {
    let hit = true;
    for (let j = 0; j < marker.length; j++) {
      if (der[i + j] !== marker[j]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;

    /* Walk back to the SEQUENCE that encloses the algorithm identifier and the
       bit string — that whole structure is the SPKI. */
    for (let start = i - 4; start >= 0 && start > i - 8; start--) {
      if (der[start] === 0x30 && der[start + 1] === 0x82) {
        const length = (der[start + 2] << 8) | der[start + 3];
        return der.slice(start, start + 4 + length);
      }
    }
  }
  throw new Error("No RSA public key found in the certificate.");
}
