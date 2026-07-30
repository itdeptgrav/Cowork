/**
 * The legacy environment, read the one way that survives bundling.
 *
 * **Next.js only substitutes `process.env.NEXT_PUBLIC_X` when the property is
 * written out literally.** It is a compile-time text replacement, not a runtime
 * object: there is no `process.env` in a browser, so anything the compiler
 * cannot see it read stays `undefined` forever.
 *
 * That makes a dynamic lookup silently fatal:
 *
 * ```ts
 * env[LEGACY_ENV.apiUrl]        // ✗ compiler sees nothing — undefined at runtime
 * process.env[name]             // ✗ same
 * process.env.NEXT_PUBLIC_...   // ✓ replaced with the value at build time
 * ```
 *
 * The first form is what `config.ts` used, and the symptom was perfect: the
 * server rendered fine, `.env.local` was correct, `npm run verify` passed, and
 * the browser reported "Cowork is not connected" with every variable set. A
 * configuration bug that only exists after bundling and only in the browser.
 *
 * So the literal reads live here, once, and everything else takes an
 * `env`-shaped object. Server code may still pass `process.env`, which is real
 * on that side; client code gets this.
 */
export const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_LEGACY_API_URL: process.env.NEXT_PUBLIC_LEGACY_API_URL,
  /* The name the copied hooks use. Same value, read literally so Next inlines it. */
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
