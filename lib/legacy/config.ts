/**
 * Where the legacy system lives, and whether we are configured to reach it.
 *
 * **Fails loudly, never silently.** A missing credential must produce a clear
 * error on the screen, not an empty employee list that reads as "your company
 * has no staff". Legacy's own client had no such distinction, which is why a
 * failed read there leaves stale data on screen with no indication anything is
 * wrong.
 */

/** Environment variables the adapter reads. Names match legacy exactly. */
export const LEGACY_ENV = {
  /** Base URL of the legacy Express backend, e.g. `https://api.example.com`. */
  apiUrl: "NEXT_PUBLIC_LEGACY_API_URL",
  /**
   * The name `cowork-old-frontend` uses for the same value.
   *
   * Hooks copied from it read `NEXT_PUBLIC_API_URL` literally, and editing
   * them would be re-writing a copy. So both names are accepted and both are
   * set, from one value — see `.env.local`. A copied hook that reaches for the
   * old name finds the right backend without being touched.
   */
  apiUrlLegacyAlias: "NEXT_PUBLIC_API_URL",
  firebase: {
    apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
    authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
  },
  /** Server-side only. The Admin SDK credential for the proxy routes. */
  serviceAccount: "LEGACY_FIREBASE_SERVICE_ACCOUNT",
} as const;

export interface LegacyFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface LegacyConfig {
  apiUrl: string;
  firebase: LegacyFirebaseConfig;
}

/**
 * Why the adapter cannot reach the legacy system, or null.
 *
 * Returns the FIRST problem rather than a list. Somebody configuring this fixes
 * one variable at a time, and a list of six names is harder to act on than one
 * sentence naming the next thing to do.
 */
export function configRefusal(
  env: Record<string, string | undefined>,
): string | null {
  if (!env[LEGACY_ENV.apiUrl] && !env[LEGACY_ENV.apiUrlLegacyAlias])
    return `Set ${LEGACY_ENV.apiUrl} to the legacy backend's base URL.`;

  for (const name of Object.values(LEGACY_ENV.firebase)) {
    if (!env[name])
      return `Set ${name}. The legacy backend accepts only Firebase ID tokens, so the Firebase client configuration is required to sign in.`;
  }
  return null;
}

/**
 * The configuration, or a thrown error naming what is missing.
 *
 * Throwing rather than returning a partial config is deliberate: a half-built
 * client that fails later, deep inside a request, is much harder to diagnose
 * than one that refuses at startup.
 */
export function readConfig(
  env: Record<string, string | undefined>,
): LegacyConfig {
  const refusal = configRefusal(env);
  if (refusal) throw new LegacyConfigError(refusal);

  return {
    apiUrl: stripTrailingSlash(
      (env[LEGACY_ENV.apiUrl] ?? env[LEGACY_ENV.apiUrlLegacyAlias])!,
    ),
    firebase: {
      apiKey: env[LEGACY_ENV.firebase.apiKey]!,
      authDomain: env[LEGACY_ENV.firebase.authDomain]!,
      projectId: env[LEGACY_ENV.firebase.projectId]!,
      storageBucket: env[LEGACY_ENV.firebase.storageBucket]!,
      messagingSenderId: env[LEGACY_ENV.firebase.messagingSenderId]!,
      appId: env[LEGACY_ENV.firebase.appId]!,
    },
  };
}

/** Whether the adapter is configured at all, without throwing. */
export function isConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return configRefusal(env) === null;
}

export class LegacyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyConfigError";
  }
}

/**
 * A base URL joined to a path, with exactly one slash between them.
 *
 * Trivial, and it earns its place: `${base}${path}` with a trailing slash on the
 * base produces `//cowork/me`, which some proxies rewrite and others 404.
 */
export function joinUrl(base: string, path: string): string {
  return `${stripTrailingSlash(base)}/${path.replace(/^\/+/, "")}`;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
