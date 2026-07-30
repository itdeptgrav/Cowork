/**
 * Development-only persistence for the mock store.
 *
 * The mock repository is a module singleton, so its entire world lives for
 * exactly one page load. That is fine for a demo and fatal for verification:
 * any flow whose steps belong to different people — create, route, approve,
 * release, confirm — cannot be walked in a browser, because reaching the next
 * person's view can cost a full load and a full load re-seeds. Every such flow
 * has, until now, been provable only at the repository layer.
 *
 * This writes the store to `localStorage` after each mutation and reads it back
 * at module init, so a reload continues the session instead of restarting it.
 *
 * Two things keep it out of production:
 *
 *  1. `process.env.NODE_ENV !== "production"` is inlined by Next at build time,
 *     so in a production build this constant folds to `false` and every call
 *     site is dead-code eliminated rather than merely skipped.
 *  2. `NEXT_PUBLIC_DISABLE_MOCK_PERSISTENCE=true` turns it off in development
 *     too, for the case where a stale fixture is getting in the way and you want
 *     the seed on every load without clearing storage by hand.
 *
 * It is deliberately ON by default in development. A flag you have to remember
 * to set before the session you needed it for is not a feature; and the "Reset
 * data" control in `DemoBar` is always a one-click way back to the seed.
 *
 * **It changes no rule.** Persistence stores and restores the same records the
 * store already held. Permissions, visibility filtering, approval routing and
 * every workflow decision are computed from that state by the same code as
 * before — none of them read this file, and nothing here writes a field they
 * consult.
 */

export const MOCK_PERSISTENCE_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_DISABLE_MOCK_PERSISTENCE !== "true";

export const MOCK_STORE_STORAGE_KEY = "cowork-mock-store";

/**
 * Bump when a persisted payload can no longer be trusted — a field that changed
 * meaning rather than one that was merely added. A mismatch discards the saved
 * state and falls back to the seed, which is always safe.
 *
 * v10: `officeHoursVersions` was added — append-only, one live configuration
 * per organisation. A v9 payload has none; the repository publishes v1 from
 * `DEFAULT_OFFICE_HOURS` on first read, so no manual migration is needed.
 *
 * v9: the mail collections (`mailThreads`, `mailMessages`, `mailAttachments`)
 * and the meeting participant/event collections were added. A v8 payload has
 * none of them, and a restored store would render an empty mailbox that looks
 * like data loss rather than an absent feature.
 *
 * v8: `breakSessions` and an organisation `settings` object were added. A v7
 * payload has neither, and a restored store with no `settings` would read the
 * break allowance as undefined on the first close-out.
 *
 * v7: the `emergencyRequests` collection was added and `DeadlineExtension`
 * gained a nullable `proposalId` — an emergency-driven extension settles no
 * negotiation. A v6 payload has neither.
 *
 * v6: `TimerSession` gained `startedAtRealMs`. A v5 payload holds sessions with
 * no real start, and a session restored mid-run would measure its duration
 * against the prototype clock — the behaviour that turned ten seconds of work
 * into a minute.
 *
 * v5: `Employee` gained `isFounder`. A v4 payload restores employees without
 * it, and `listUnattachedEmployees` reads it to decide who is an intentional
 * organisation root — so a stale store would report the founder as a gap and
 * invite an administrator to place them under somebody.
 *
 * v4: the `folders` and `forwards` collections were removed with the Folder
 * and Forward features, and `Task.folderId` went with them. A v3 payload
 * restores those collections, and `createStore` no longer declares them — the
 * store would carry two fields nothing reads and a `folderId` the type says
 * cannot exist.
 *
 * v3: `Task.requirements` became `CompletionRequirement[]` and tasks gained
 * `satisfiesRequirementIds` — a stored payload from v2 holds strings where the
 * completion model now expects records, which would throw on the first read.
 *
 * v2: `Employee` gained `email`. Strictly this is an addition, which the shape
 * fingerprint in `store.ts` now catches on its own — the bump is belt and
 * braces for anyone whose browser is holding a v1 payload written before that
 * fingerprint existed.
 */
export const MOCK_STORE_SCHEMA_VERSION = 10;
