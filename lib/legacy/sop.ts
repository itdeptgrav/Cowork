import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";
import {
  type LegacyBleach,
  type ScoreComponent,
  netPoints,
  readComponent,
  signedPoints,
} from "./wire.ts";

/**
 * SOP Points, from the legacy engine.
 *
 * **The concept is not redesigned.** An SOP is a named policy rule with a point
 * value; applying it to somebody records an entry against their per-year ledger;
 * `pmpService` reads that ledger. All of that stays exactly as it is.
 *
 * What this module does is stop the vocabulary leaking. Legacy calls a violation
 * a "bleach" of type `"credit"`, which means the opposite of what it sounds
 * like. Those words are converted here, once, and never appear above this line.
 *
 * ## Entities
 *
 * | Legacy | Where | Note |
 * |---|---|---|
 * | `Sop` | Mongo `sop_model` | The rule. Points + severity + approval |
 * | `SopFolder` | Mongo `sop_folder_model` | Grouping only |
 * | Ledger | `Employee.sopPoints[]` | Per-year, per-employee |
 * | Entry ("bleach") | `sopPoints[].bleaches[]` | One application |
 * | Thresholds | Firestore `cowork_sop_settings/task_events` | Timer-derived rules |
 * | Bands | Mongo `BandConfig` | Designation → score maxima |
 */

/* ── The rule ─────────────────────────────────────────────────────────────── */

/**
 * Severity, matching legacy's enum exactly.
 *
 * Identical to `ConductPolicy.severity` in the new project's domain — the one
 * place the two systems already agree without translation.
 *
 * `null` is documented by legacy as "created before this field existed; keeps
 * its stored `points` as-is", which is why **points and severity are two
 * independent sources for one number** and older rules only have one of them.
 * Never derive the points from the severity here; use what is stored.
 */
export type LegacySeverity =
  | "minor" | "moderate" | "serious" | "falsification" | "idle_pool";

export type LegacySopStatus = "pending" | "approved" | "rejected";

export interface LegacySopDoc {
  _id?: string;
  id?: string;
  name?: string;
  points?: number;
  severity?: LegacySeverity | null;
  description?: string;
  department?: string;
  folderId?: string | null;
  folderName?: string;
  status?: LegacySopStatus;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: unknown;
  createdBy?: string;
  createdByName?: string;
  createdByRole?: string;
}

export interface LegacySop {
  id: string;
  name: string;
  /** Always positive. Direction is decided when the rule is applied. */
  points: number;
  severity: LegacySeverity | null;
  description: string | null;
  department: string | null;
  folderId: string | null;
  folderName: string;
  status: LegacySopStatus;
  /** Only an approved rule may be applied — the engine refuses otherwise. */
  isApplicable: boolean;
  createdByName: string | null;
  approvedByName: string | null;
}

export function readSop(doc: LegacySopDoc): LegacySop | null {
  const id = doc._id ?? doc.id;
  if (!id || !doc.name) return null;

  return {
    id: String(id),
    name: doc.name.trim(),
    points: Math.abs(Number(doc.points) || 0),
    severity: doc.severity ?? null,
    description: doc.description?.trim() || null,
    department: doc.department?.trim() || null,
    folderId: doc.folderId ? String(doc.folderId) : null,
    /* Legacy's own default for an ungrouped rule. */
    folderName: doc.folderName?.trim() || "Uncategorized",
    status: doc.status ?? "pending",
    isApplicable: doc.status === "approved",
    createdByName: doc.createdByName?.trim() || null,
    approvedByName: doc.approvedByName?.trim() || null,
  };
}

export function readSops(docs: readonly LegacySopDoc[]): LegacySop[] {
  return docs.map(readSop).filter((s): s is LegacySop => s !== null);
}

/**
 * The engine's refusal when an unapproved rule is applied, verbatim.
 *
 * Quoted so a UI that disables the control explains it in the same words the
 * network would return.
 */
export const UNAPPROVED_SOP_REFUSAL = "Only approved SOPs can be applied.";

/** The engine's departmental refusal, verbatim. */
export const TL_DEPARTMENT_REFUSAL =
  "TL can only bleach employees in their own department.";

/* ── The ledger ───────────────────────────────────────────────────────────── */

/**
 * One ledger entry, in the new UI's vocabulary.
 *
 * `points` is **signed**: positive is a penalty, negative is a reward. That is
 * the same direction as legacy's `totalDeducted`, so summing these reproduces
 * the engine's figure — which is the property that matters, because the score
 * shown must never disagree with the score computed.
 */
export interface LegacyLedgerEntry {
  sopId: string | null;
  policyId: string | null;
  name: string;
  folderName: string;
  /** Signed. Positive = penalty, negative = reward. */
  points: number;
  isPenalty: boolean;
  component: ScoreComponent | null;
  description: string | null;
  date: string | null;
  appliedByName: string | null;
  appliedByRole: string | null;
  recheck: LegacyRecheck;
}

/**
 * The dispute state of an entry.
 *
 * Legacy resolves a dispute by **mutating the entry's `recheck` sub-document**.
 * The new project resolves by reversal and never mutates the original — a
 * better model, and one this adapter cannot impose, because the engine owns the
 * write. Read as-is; see the extension note at the foot of this file.
 */
export interface LegacyRecheck {
  status: string;
  requestNote: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
}

function readRecheck(raw: unknown): LegacyRecheck {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    status: typeof r.status === "string" && r.status ? r.status : "none",
    requestNote: asText(r.requestNote),
    reviewNote: asText(r.reviewNote),
    reviewedByName: asText(r.reviewedByName),
  };
}

function asText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function readLedgerEntry(bleach: LegacyBleach): LegacyLedgerEntry {
  const points = signedPoints(bleach);
  return {
    sopId: bleach.sopId ? String(bleach.sopId) : null,
    policyId: bleach.policyId ? String(bleach.policyId) : null,
    name: bleach.sopName?.trim() || "Unnamed",
    folderName: bleach.folderName?.trim() || "Uncategorized",
    points,
    isPenalty: points > 0,
    component: readComponent(bleach),
    description: asText(bleach.description),
    date: asText(bleach.date),
    appliedByName: asText(bleach.cutByName),
    appliedByRole: asText(bleach.cutByRole),
    recheck: readRecheck(bleach.recheck),
  };
}

/** One year of somebody's ledger. */
export interface LegacyLedgerYear {
  year: number;
  /**
   * The engine's own figure. **This is what the score is computed from.**
   *
   * Shown in preference to any recomputation — see `netMatchesStored`.
   */
  totalDeducted: number;
  entries: LegacyLedgerEntry[];
}

export interface LegacyLedgerYearDoc {
  year?: number;
  totalDeducted?: number;
  bleaches?: LegacyBleach[];
}

export function readLedgerYear(
  doc: LegacyLedgerYearDoc,
): LegacyLedgerYear | null {
  if (typeof doc.year !== "number") return null;
  return {
    year: doc.year,
    totalDeducted: Number(doc.totalDeducted) || 0,
    entries: (doc.bleaches ?? []).map(readLedgerEntry),
  };
}

export function readLedger(
  docs: readonly LegacyLedgerYearDoc[],
): LegacyLedgerYear[] {
  return docs
    .map(readLedgerYear)
    .filter((y): y is LegacyLedgerYear => y !== null)
    .sort((a, b) => b.year - a.year);
}

/**
 * Whether the recomputed net agrees with the engine's stored total.
 *
 * A diagnostic, not a correction. If they disagree, the stored figure is still
 * what scoring uses — but somebody should know, because it means an entry was
 * written without the total being updated, and the ledger has stopped
 * summarising its own history.
 *
 * Compared with a tolerance because legacy rounds `totalDeducted` to two
 * decimals on every write, so a long ledger drifts by fractions legitimately.
 */
export function netMatchesStored(
  year: LegacyLedgerYear,
  tolerance = 0.011,
): boolean {
  const recomputed = year.entries.reduce((sum, e) => sum + e.points, 0);
  return Math.abs(recomputed - year.totalDeducted) <= tolerance;
}

/** Signed total for one component within a year. */
export function componentTotal(
  year: LegacyLedgerYear,
  component: ScoreComponent,
): number {
  return year.entries
    .filter((e) => e.component === component)
    .reduce((sum, e) => sum + e.points, 0);
}

/* ── Calls ────────────────────────────────────────────────────────────────── */

/** `GET /cowork/sop/` — the rule catalogue. */
export async function listSops(
  token: string,
): Promise<LegacyResult<LegacySop[]>> {
  const r = await legacyFetch<LegacySopDoc[]>({
    path: "/cowork/sop/",
    envelopeKey: "sops",
    token,
  });
  return r.ok ? { ok: true, data: readSops(r.data) } : r;
}

/** `GET /cowork/sop/folders`. */
export async function listFolders(
  token: string,
): Promise<LegacyResult<{ id: string; name: string; department: string | null }[]>> {
  const r = await legacyFetch<
    { _id?: string; id?: string; name?: string; department?: string }[]
  >({ path: "/cowork/sop/folders", envelopeKey: "folders", token });
  if (!r.ok) return r;
  return {
    ok: true,
    data: r.data
      .filter((f) => (f._id ?? f.id) && f.name)
      .map((f) => ({
        id: String(f._id ?? f.id),
        name: f.name!.trim(),
        department: f.department?.trim() || null,
      })),
  };
}

/** `GET /cowork/sop/bleach/:employeeId` — somebody's ledger. */
export async function fetchLedger(input: {
  token: string;
  employeeId: string;
}): Promise<LegacyResult<LegacyLedgerYear[]>> {
  const r = await legacyFetch<LegacyLedgerYearDoc[]>({
    path: `/cowork/sop/bleach/${encodeURIComponent(input.employeeId)}`,
    envelopeKey: "sopPoints",
    token: input.token,
  });
  return r.ok ? { ok: true, data: readLedger(r.data) } : r;
}

/**
 * `POST /cowork/sop/bleach` — apply a rule to somebody.
 *
 * `sopId` **or** `manualPoints` is required; legacy refuses without one.
 * `manualPoints` records an arbitrary deduction with no rule behind it, named
 * `"Manual Deduction"` and filed under folder `"Task Event"` — it bypasses the
 * approval gate, which governs rules rather than deductions. Preserved because
 * removing it would change what supervisors can do.
 */
export async function applySop(input: {
  token: string;
  targetEmployeeId: string;
  sopId?: string;
  manualPoints?: number;
  manualSopName?: string;
  description?: string;
}): Promise<LegacyResult<unknown>> {
  const { token, ...body } = input;
  return legacyFetch({
    path: "/cowork/sop/bleach",
    method: "POST",
    token,
    body,
  });
}

/** `POST /cowork/sop/bleach/:employeeId/:bleachId/recheck` — dispute an entry. */
export async function requestRecheck(input: {
  token: string;
  employeeId: string;
  entryId: string;
  note: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/sop/bleach/${encodeURIComponent(input.employeeId)}/${encodeURIComponent(input.entryId)}/recheck`,
    method: "POST",
    token: input.token,
    body: { requestNote: input.note },
  });
}

/** `GET /cowork/sop/recheck/pending-count` — CEO or TL. */
export async function pendingRecheckCount(
  token: string,
): Promise<LegacyResult<number>> {
  const r = await legacyFetch<{ count?: number } | number>({
    path: "/cowork/sop/recheck/pending-count",
    token,
  });
  if (!r.ok) return r;
  const value = typeof r.data === "number" ? r.data : (r.data?.count ?? 0);
  return { ok: true, data: value };
}

/* ── Bands ────────────────────────────────────────────────────────────────── */

/**
 * `GET /cowork/band-config` — designation → score maxima.
 *
 * **A single document, ever.** An employee's maximum score depends on their
 * designation via their band; an unmapped designation falls back to
 * `globalSettings`. The new project uses flat maxima, so adopting bands changes
 * what every score means — an owner decision, not an adapter one. Exposed here
 * read-only so the UI can show the ceiling the engine is actually using.
 */
export interface LegacyBandConfig {
  bands: Record<
    string,
    { designations: string[]; c1Max: number; c2Max: number; c3Max: number; c4Max: number }
  >;
  global: {
    c1MaxPoints: number;
    c1BaseScore: number;
    deadlineDeduction: number;
    extensionDeduction: number;
    reworkDeduction: number;
    rejectDeduction: number;
    c2MaxPoints: number;
  };
}

export function readBandConfig(raw: unknown): LegacyBandConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const g = (r.globalSettings ?? {}) as Record<string, Record<string, { award?: number; deduction?: number }>>;
  const c1 = g.c1 ?? {};
  const c2 = g.c2 ?? {};

  const bands: LegacyBandConfig["bands"] = {};
  for (const [name, data] of Object.entries((r.bands ?? {}) as Record<string, Record<string, unknown>>)) {
    bands[name] = {
      designations: Array.isArray(data.designations) ? (data.designations as string[]) : [],
      c1Max: Number(data.c1Max) || 0,
      c2Max: Number(data.c2Max) || 0,
      c3Max: Number(data.c3Max) || 0,
      c4Max: Number(data.c4Max) || 0,
    };
  }

  /* Defaults transcribed from models/BandConfig.js. */
  return {
    bands,
    global: {
      c1MaxPoints: c1.maxPoints?.award ?? 35,
      c1BaseScore: c1.baseScore?.award ?? 1.0,
      deadlineDeduction: c1.deadline?.deduction ?? 0.2,
      extensionDeduction: c1.extension?.deduction ?? 0.1,
      reworkDeduction: c1.rework?.deduction ?? 0.2,
      rejectDeduction: c1.reject?.deduction ?? 0.3,
      c2MaxPoints: c2.globalMaxPoints?.award ?? 30,
    },
  };
}

export async function fetchBandConfig(
  token: string,
): Promise<LegacyResult<LegacyBandConfig>> {
  const r = await legacyFetch<unknown>({ path: "/cowork/band-config", token });
  return r.ok ? { ok: true, data: readBandConfig(r.data) } : r;
}

/**
 * The band a designation falls in, mirroring `getBandMaxForEmployee`.
 *
 * A lookup, not a calculation — the same traversal the engine performs, so the
 * UI can show which band applies without a second round trip. `null` means the
 * designation is mapped to no band and the global defaults apply.
 */
export function bandForDesignation(
  config: LegacyBandConfig,
  designation: string | null,
): { name: string; c1Max: number; c2Max: number; c3Max: number; c4Max: number } | null {
  if (!designation) return null;
  for (const [name, band] of Object.entries(config.bands)) {
    if (band.designations.includes(designation)) return { name, ...band };
  }
  return null;
}

export { netPoints };
