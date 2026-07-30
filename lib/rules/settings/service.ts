import { auditEntry, type AuditEntry } from "./audit.ts";

/**
 * Settings changes go through here, or they do not happen.
 *
 * **Centralised so the audit cannot be skipped.** Settings reads were scattered
 * — `getOfficePolicy` called from the mapper, the chain, the preview and three
 * components — and the single write went straight to the document. Any new
 * caller was free to write without logging, and the only thing stopping it was
 * that nobody had thought to.
 *
 * `applySettingsChange` takes the read, the write and the log as one operation.
 * A caller cannot supply a new value without the old one, because the audit
 * entry is built from both — so "I did not have the previous value" is not a
 * state this function can be in.
 *
 * ## Ordering
 *
 * The write happens FIRST and the log second. The other order would record
 * changes that then failed to save, and a log claiming a change nobody can see
 * is worse than a missing entry — somebody would trust it.
 *
 * A failed log is reported but does not roll back the write: the setting really
 * did change, and pretending otherwise would leave the system describing itself
 * wrongly. The result says which half succeeded.
 */

export interface SettingsChangeResult<T> {
  ok: boolean;
  /** The value now in force. */
  value: T | null;
  /** Null when nothing changed, or when the log could not be written. */
  entry: AuditEntry | null;
  /** Present when the WRITE failed. The setting is unchanged. */
  error?: string;
  /**
   * The write landed and the log did not.
   *
   * Surfaced rather than swallowed: a change with no record is exactly the
   * thing this module exists to prevent, so somebody has to be told it
   * happened.
   */
  unlogged?: boolean;
}

export async function applySettingsChange<T>(input: {
  section: string;
  /** The event name for the log, e.g. `OFFICE_POLICY_CHANGED`. */
  type?: string;
  changedById: string | null;
  /** ISO, injected so a test is reproducible. */
  changedAt: string;
  /** What is in force now. Read before the write, by the caller. */
  before: T;
  /** What it should become. */
  after: T;
  reason?: string | null;
  /** Generates the entry id. Injected for the same reason as the clock. */
  newId: () => string;
  write: (value: T) => Promise<{ ok: boolean; message?: string }>;
  log: (entry: AuditEntry) => Promise<void>;
}): Promise<SettingsChangeResult<T>> {
  const entry = auditEntry({
    id: input.newId(),
    section: input.section,
    type: input.type,
    changedById: input.changedById,
    changedAt: input.changedAt,
    before: input.before,
    after: input.after,
    reason: input.reason ?? null,
  });

  /* Nothing changed. Not an error, and not worth a row — pressing Save without
     editing is ordinary. */
  if (!entry) return { ok: true, value: input.after, entry: null };

  const written = await input.write(input.after);
  if (!written.ok) {
    return {
      ok: false,
      value: null,
      entry: null,
      error: written.message ?? "The setting could not be saved.",
    };
  }

  try {
    await input.log(entry);
  } catch {
    return { ok: true, value: input.after, entry: null, unlogged: true };
  }

  return { ok: true, value: input.after, entry };
}
