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
  /**
   * What a breach costs, as a PERCENTAGE — see `LegacySop.percent`.
   *
   * `points` is the field every rule written before this carries, and the two
   * mean the same thing: C1, C2 and C4 are percentages and C3 is subtracted
   * from their average, so a cost has only ever been readable as percentage
   * points. `percent` is the name that says so.
   */
  percent?: number | null;
  points?: number;
  severity?: LegacySeverity | null;
  description?: string;
  department?: string;
  folderId?: string | null;
  folderName?: string;
  status?: LegacySopStatus;
  /** WHO must decide it — the author's own primary manager, stamped at
      creation so the decision belongs to one named person. */
  approverId?: string | null;
  approverName?: string | null;
  rejectedReason?: string;
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
  /**
   * How much of the score a breach takes off, in PERCENTAGE POINTS.
   *
   * Always positive; the direction is decided when the rule is applied. Five
   * here means a score of 80 becomes 75 — subtracted from the average of the
   * other components, which are themselves percentages.
   */
  percent: number;
  /** The same number under its old name, for anything not yet migrated. */
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
  createdById: string | null;
  /** WHO must decide it — the author's own primary manager. */
  approverId: string | null;
  approverName: string | null;
  approvedByName: string | null;
  rejectedReason: string | null;
}

export function readSop(doc: LegacySopDoc): LegacySop | null {
  const id = doc._id ?? doc.id;
  if (!id || !doc.name) return null;

  /* `percent` where the rule has one, `points` for everything written before
     the field existed. They are the same quantity — see the type. */
  const cost = Math.abs(Number(doc.percent ?? doc.points) || 0);

  return {
    id: String(id),
    name: doc.name.trim(),
    percent: cost,
    points: cost,
    severity: doc.severity ?? null,
    description: doc.description?.trim() || null,
    department: doc.department?.trim() || null,
    folderId: doc.folderId ? String(doc.folderId) : null,
    /* Legacy's own default for an ungrouped rule. */
    folderName: doc.folderName?.trim() || "Uncategorized",
    status: doc.status ?? "pending",
    isApplicable: doc.status === "approved",
    createdByName: doc.createdByName?.trim() || null,
    createdById: doc.createdBy?.trim() || null,
    approverId: doc.approverId?.trim() || null,
    approverName: doc.approverName?.trim() || null,
    approvedByName: doc.approvedByName?.trim() || null,
    rejectedReason: doc.rejectedReason?.trim() || null,
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
  /** The entry's own id, which is what a dispute is raised against. */
  entryId: string | null;
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
    entryId: bleach._id ? String(bleach._id) : null,
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

/* ── Writing a conduct rule, and the line that decides it ─────────────────── */

/**
 * Write a conduct rule. It applies to nobody until it is approved.
 *
 * **A manager writes it and their own manager approves it** — the reporting
 * line, not a job title. The engine stamps the approver at creation and tells
 * them, so the decision belongs to one named person rather than to whoever
 * happens to hold a senior role.
 *
 * `percent` is what a breach costs, in percentage points off the score. Nothing
 * about it is a "point count": C1, C2 and C4 are percentages, C3 is subtracted
 * from their average, and five here means eighty becomes seventy-five.
 */
export async function createSop(input: {
  token: string;
  name: string;
  percent: number;
  description: string;
  department: string;
  folderId?: string | null;
  severity?: LegacySeverity | null;
}): Promise<LegacyResult<{ sop: LegacySopDoc }>> {
  const { token, ...body } = input;
  return legacyFetch({ path: "/cowork/sop", method: "POST", token, body });
}

/**
 * Approve or reject a rule somebody who reports to you wrote.
 *
 * The engine refuses anyone but the named approver and administrators, and
 * refuses an author deciding their own — so this is a request, not an
 * assertion, and its refusal is worth showing verbatim.
 */
export async function decideSop(input: {
  token: string;
  sopId: string;
  decision: "approve" | "reject";
  reason?: string;
}): Promise<LegacyResult<{ sop: LegacySopDoc }>> {
  return legacyFetch({
    path: `/cowork/sop/${encodeURIComponent(input.sopId)}/${input.decision}`,
    method: "PATCH",
    token: input.token,
    body: { reason: input.reason ?? "" },
  });
}

/**
 * The rules waiting on THIS person to decide.
 *
 * Addressed by the engine rather than filtered here: a queue everybody senior
 * can see is a queue nobody owns.
 */
export async function fetchPendingApprovals(input: {
  token: string;
}): Promise<LegacyResult<LegacySop[]>> {
  const result = await legacyFetch<{ sops?: LegacySopDoc[] }>({
    path: "/cowork/sop/pending-approvals",
    token: input.token,
  });
  if (!result.ok) return result;
  return { ok: true, data: readSops(result.data?.sops ?? []) };
}

/**
 * Decide a disputed deduction.
 *
 * `confirm` REVERSES it — the employee was right — and `reject` lets it stand.
 * The words are the engine's and they are the wrong way round for a reader, so
 * nothing in the interface should repeat them without saying what they do.
 */
export async function reviewRecheck(input: {
  token: string;
  employeeId: string;
  entryId: string;
  action: "confirm" | "reject";
  reviewNote?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/sop/bleach/${encodeURIComponent(input.employeeId)}/${encodeURIComponent(input.entryId)}/recheck`,
    method: "PATCH",
    token: input.token,
    body: { action: input.action, reviewNote: input.reviewNote ?? "" },
  });
}

/** One person with disputes open, and the entries they are about. */
export interface LegacyPendingRecheck {
  employeeId: string;
  employeeName: string;
  entries: {
    entryId: string;
    name: string;
    /** What the disputed entry cost, in percentage points. Always positive. */
    points: number;
    date: string | null;
    requestNote: string | null;
  }[];
}

/**
 * Disputes waiting on this person, with the entry each one is about.
 *
 * Grouped by employee on the wire — one object per person, their open disputes
 * inside. The grouping is kept rather than flattened here, because a reviewer
 * settling three arguments with the same person wants them together.
 *
 * The engine addresses this queue by the reporting line: your own direct
 * reports, or everybody if you administer the place. It used to be addressed
 * by role, which showed leads disputes they would be refused on submitting.
 */
export async function fetchPendingRechecks(input: {
  token: string;
}): Promise<LegacyResult<LegacyPendingRecheck[]>> {
  const result = await legacyFetch<
    {
      employeeId?: string;
      name?: string;
      bleaches?: {
        bleachId?: string;
        sopName?: string;
        points?: number;
        date?: string;
        requestNote?: string;
      }[];
    }[]
  >({
    path: "/cowork/sop/recheck/pending-list",
    envelopeKey: "list",
    token: input.token,
  });
  if (!result.ok) return result;

  return {
    ok: true,
    data: result.data
      .filter((p) => p.employeeId)
      .map((p) => ({
        employeeId: String(p.employeeId),
        employeeName: p.name?.trim() || "Unknown",
        entries: (p.bleaches ?? [])
          .filter((b) => b.bleachId)
          .map((b) => ({
            entryId: String(b.bleachId),
            name: b.sopName?.trim() || "Unnamed",
            /* Absolute. Legacy stores the cost unsigned on the entry and
               decides the direction from `bleachType`; a dispute is only ever
               about a deduction, so the sign carries no information here. */
            points: Math.abs(Number(b.points) || 0),
            date: asText(b.date),
            requestNote: asText(b.requestNote),
          })),
      }))
      .filter((p) => p.entries.length > 0),
  };
}
