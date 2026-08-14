import { classify, type LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";
import { readConfig } from "./config.ts";
import { PUBLIC_ENV } from "./publicEnv.ts";

/**
 * C2 · goal tasks, across the wire.
 *
 * The engine already carries this. `routes/task_routes/c2Band.routes.js` is
 * mounted at `/cowork` and serves the pool and its validation, and
 * `POST /cowork/sop/goal-credit` pays a node out. Nothing here is a new
 * protocol — these are the calls the old Cowork made, given types.
 *
 * ## The pool, and who is counted in it
 *
 * The engine sums `c2Config.weightagePercent` across tasks where
 * `isGoldTask == true` and the status is not done or cancelled. That flag is
 * the engine's own accounting key, so a goal task written from this app sets it
 * — see `createTask`. The Gold Task **concept** is gone from the interface by
 * owner decision (every goal task scores C2, so an opt-in is one state too
 * many); the flag survives underneath it, because removing it would take the
 * new app's goals out of a pool the old app is still counting.
 */

/** What is set aside for C2, and how much of it is spoken for. */
export interface LegacyC2Pool {
  /** The whole year's C2 points, from `cowork_sop_settings/task_events`. */
  globalMaxPoints: number;
  /** Percent of the pool already claimed by live goal tasks. */
  claimedPercent: number;
  /** Percent still unclaimed. The engine's own figure, not recomputed here. */
  remainingPercent: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `GET /cowork/c2/config` — the pool and what is left of it. */
export async function fetchC2Pool(
  token: string,
): Promise<LegacyResult<LegacyC2Pool>> {
  const r = await legacyFetch<{
    c2GlobalMaxPoints?: unknown;
    totalUsed?: unknown;
    remaining?: unknown;
  }>({ path: "/cowork/c2/config", token });
  if (!r.ok) return r;

  return {
    ok: true,
    data: {
      globalMaxPoints: num(r.data?.c2GlobalMaxPoints),
      claimedPercent: num(r.data?.totalUsed),
      /* The engine's own remainder. Recomputing `100 - claimed` here would be a
         second opinion about the same number, and the two would disagree the
         first time a task was excluded from the sum for a reason this side
         does not know about. */
      remainingPercent: num(r.data?.remaining),
    },
  };
}

/** The engine's verdict on a share, and its own wording for a refusal. */
export interface LegacyWeightageVerdict {
  valid: boolean;
  remainingPercent: number;
  /** The engine's message when it refuses. Shown as written. */
  error: string | null;
}

/**
 * `POST /cowork/c2/validate-weightage` — the HARD BLOCK before creation.
 *
 * Asked even though `weightageRefusal` has already checked the same thing on
 * this side: the local check is instant and keeps the form honest while
 * somebody types, and this one is the truth at the moment of writing. Between
 * the two, another task can claim the pool.
 */
export async function validateWeightage(input: {
  token: string;
  weightagePercent: number;
  excludeTaskId?: string | null;
}): Promise<LegacyResult<LegacyWeightageVerdict>> {
  const r = await legacyFetch<{
    valid?: unknown;
    remaining?: unknown;
    error?: unknown;
  }>({
    path: "/cowork/c2/validate-weightage",
    method: "POST",
    token: input.token,
    body: {
      weightagePercent: input.weightagePercent,
      excludeTaskId: input.excludeTaskId ?? null,
    },
  });
  if (!r.ok) return r;

  return {
    ok: true,
    data: {
      valid: r.data?.valid === true,
      remainingPercent: num(r.data?.remaining),
      error: typeof r.data?.error === "string" ? r.data.error : null,
    },
  };
}

/* ── The roadmap ──────────────────────────────────────────────────────────── */

/**
 * One step of a goal task, in the engine's own shape.
 *
 * The engine stores the whole roadmap as an array on the task document and
 * writes it back wholesale — there is no per-node endpoint. Every field the old
 * Cowork wrote is preserved on read and written back untouched, including the
 * ones this app does not yet render (`status`, `report`, `history`,
 * `perUserStatus`), because a save that dropped them would erase a person's
 * submitted work.
 */
export interface LegacyGoalActivity {
  id: string;
  heading: string;
  description: string;
  /** ISO. */
  deadline: string | null;
  /** Share of the task's pool, as a percentage. */
  percentage: number | null;
  /** What the node is worth, as the engine computed it. */
  points: number;
  /** `pending`, `pending_approval` or `done` — the engine's own words. */
  status: string;
  /** The report handed in against this step, where there is one. */
  report: {
    text: string;
    submittedAt: string | null;
    submittedBy: string | null;
    /** What was attached to it. Empty where nothing was. */
    files: LegacyGoalFile[];
  } | null;
  /** Everything else the engine keeps, carried through untouched. */
  rest: Record<string, unknown>;
}

export interface LegacyRoadmap {
  activities: LegacyGoalActivity[];
  /** Whether the roadmap has been finalised and handed to the assignee. */
  submitted: boolean;
  submittedAt: string | null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * The files on a report, as the engine stored them.
 *
 * A file with no link is DROPPED rather than shown: the old Cowork wrote these
 * by hand over several years, and a row that opens nothing reads as a broken
 * attachment when what it actually is, is not an attachment.
 */
function readFiles(raw: unknown): LegacyGoalFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const f = (entry ?? {}) as Record<string, unknown>;
    const view = text(f.driveUrl) || text(f.viewUrl) || text(f.url);
    if (!view) return [];
    return [
      {
        name: text(f.name) || text(f.fileName) || "Attachment",
        driveUrl: view,
        downloadUrl: text(f.downloadUrl) || view,
        mimeType: text(f.mimeType) || "application/octet-stream",
        size: Number.isFinite(Number(f.size)) ? Number(f.size) : 0,
      },
    ];
  });
}

function readActivity(raw: unknown, index: number): LegacyGoalActivity {
  const r = (raw ?? {}) as Record<string, unknown>;
  const {
    id: _id,
    heading: _h,
    description: _d,
    deadline: _dl,
    percentage: _p,
    points: _pts,
    status: _st,
    ...rest
  } = r;
  /* `report` is deliberately NOT destructured out: it stays in `rest` so the
     save carries the engine's own version — `files`, `submittedById` — and the
     typed view below is a read of it rather than a replacement for it. */
  const rep = (rest.report ?? null) as Record<string, unknown> | null;
  return {
    /* `pending` when the engine has said nothing. A step nobody has touched and
       a step whose status was lost read the same way, which is the safe
       direction: it offers the work rather than claiming it is done. */
    status: text(_st) || "pending",
    report: rep
      ? {
          text: text(rep.text),
          submittedAt: text(rep.submittedAt) || null,
          submittedBy: text(rep.submittedBy) || null,
          files: readFiles(rep.files),
        }
      : null,
    /* The engine's own id where it has one. A roadmap written before ids
       existed falls back to the position, which is stable for as long as the
       array is — and the array is what the engine keys everything else on. */
    id: text(_id) || `node-${index + 1}`,
    heading: text(_h),
    description: text(_d),
    deadline: text(_dl) || null,
    percentage: Number.isFinite(Number(_p)) ? Number(_p) : null,
    points: Number.isFinite(Number(_pts)) ? Number(_pts) : 0,
    rest,
  };
}

/** `GET /cowork/task/:taskId/goal-activities`. */
export async function fetchRoadmap(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<LegacyRoadmap>> {
  const r = await legacyFetch<{
    activities?: unknown;
    submitted?: unknown;
    submittedAt?: unknown;
  }>({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/goal-activities`,
    token: input.token,
  });
  if (!r.ok) return r;

  const raw = Array.isArray(r.data?.activities) ? r.data.activities : [];
  return {
    ok: true,
    data: {
      activities: raw.map(readActivity),
      submitted: r.data?.submitted === true,
      submittedAt: text(r.data?.submittedAt) || null,
    },
  };
}

/**
 * `POST /cowork/task/:taskId/goal-activities` — the whole roadmap, at once.
 *
 * **Everything unrecognised is written back.** `rest` carries the fields this
 * app does not render, and they go up unchanged: a save that dropped `status`
 * or `report` would delete work somebody had already submitted, and the engine
 * replaces the array rather than merging it.
 */
export async function saveRoadmap(input: {
  token: string;
  taskId: string;
  activities: readonly LegacyGoalActivity[];
  submitted?: boolean;
  submittedAt?: string | null;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/goal-activities`,
    method: "POST",
    token: input.token,
    body: {
      activities: input.activities.map((a) => ({
        ...a.rest,
        id: a.id,
        heading: a.heading,
        description: a.description,
        deadline: a.deadline,
        percentage: a.percentage,
        points: a.points,
        /* Written back EXPLICITLY, because they are no longer inside `rest`.
           The engine replaces the whole array on every write, so a save that
           omitted these would delete a submitted report and reset a step's
           status — the exact failure `rest` exists to prevent. */
        status: a.status,
        report: a.report
          ? {
              /* Merged over whatever the engine already holds, so the fields
                 this app does not read — `files`, `submittedById` — survive. */
              ...((a.rest.report as Record<string, unknown> | undefined) ?? {}),
              text: a.report.text,
              submittedAt: a.report.submittedAt,
              submittedBy: a.report.submittedBy,
            }
          : null,
      })),
      ...(input.submitted === undefined ? {} : { submitted: input.submitted }),
      ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
    },
  });
}

/**
 * `POST /cowork/task/:taskId/goal-activity/:activityId/submit-report`.
 *
 * The engine writes the report, moves the step to `pending_approval` and tells
 * the heads. It refuses anybody who is not an assignee of the task, which is
 * the rule that matters: a report is the person doing the work saying they have
 * done it.
 *
 * `files` is sent empty. The old Cowork uploaded attachments to Drive first and
 * passed the resulting links; that is a separate dependency and is not carried
 * yet, so a report here is its text. The field is sent so the engine's shape is
 * respected rather than left undefined.
 */
export async function submitNodeReport(input: {
  token: string;
  taskId: string;
  activityId: string;
  text: string;
  /** Files already uploaded by `uploadReportFile`. */
  files?: LegacyGoalFile[];
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/goal-activity/${encodeURIComponent(input.activityId)}/submit-report`,
    method: "POST",
    token: input.token,
    body: { text: input.text, files: input.files ?? [] },
  });
}

/**
 * `POST /cowork/sop/goal-credit` — pay a step out.
 *
 * **The engine decides whether it pays, not this.** It re-checks
 * `submittedAt <= deadline` and answers `skipped` for a late one, and it
 * refuses to credit the same task-and-step twice in a year. Both guards are
 * the engine's, and neither is duplicated here — `approvalOutcome` says what
 * WILL happen so the head can see it before deciding, and this is what
 * actually happens.
 */
export async function creditNode(input: {
  token: string;
  targetEmployeeId: string;
  taskId: string;
  componentId: string;
  componentName: string;
  taskTitle: string;
  points: number;
  submittedAt: string | null;
  deadline: string | null;
  weightagePercent: number | null;
  taskMaxPoints: number | null;
}): Promise<LegacyResult<unknown>> {
  const { token, ...body } = input;
  return legacyFetch({
    path: "/cowork/sop/goal-credit",
    method: "POST",
    token,
    body: {
      ...body,
      /* The engine gates its C2 score cache on this. Every goal task claims a
         share of the pool now, so every credit belongs in that cache. */
      isC2Band: true,
      c2WeightagePercent: input.weightagePercent,
      c2TaskMaxPoints: input.taskMaxPoints,
    },
  });
}

/* ── Where somebody's C2 came from ────────────────────────────────────────── */

/** One goal task's contribution to somebody's C2. */
export interface LegacyC2TaskScore {
  taskId: string;
  taskTitle: string;
  /** The task's whole pool. */
  taskMaxPoints: number;
  /** What has actually been earned from it so far. */
  earnedPoints: number;
  /** The share of the company pool the task claimed. */
  weightagePercent: number;
}

export interface LegacyC2Score {
  /** Everything earned across every goal, this year. */
  totalEarned: number;
  /** The company pool the total is measured against. */
  globalMaxPoints: number;
  tasks: LegacyC2TaskScore[];
}

/**
 * `GET /cowork/c2/scores/:employeeId` — the per-goal breakdown.
 *
 * The C2 tab can already show the individual credits: each one lands in the
 * ledger as a `type: "C2"` entry and the ledger panel lists them. What it
 * cannot show from that is WHICH GOAL each belongs to and how far through its
 * pool that goal is — a list of credits answers "what did I earn" and not
 * "where is this coming from".
 *
 * The engine keeps that in `cowork_c2_scores`, written as each step is
 * approved. Read rather than reassembled from the ledger: the two are written
 * by the same call, and recomputing one from the other is how a page comes to
 * disagree with the score it is explaining.
 *
 * An employee may read their own; the engine refuses anybody else's.
 */
export async function fetchC2Score(input: {
  token: string;
  employeeId: string;
}): Promise<LegacyResult<LegacyC2Score>> {
  const r = await legacyFetch<{
    totalEarned?: unknown;
    globalMaxPoints?: unknown;
    taskBreakdown?: unknown;
  }>({
    path: `/cowork/c2/scores/${encodeURIComponent(input.employeeId)}`,
    token: input.token,
  });
  if (!r.ok) return r;

  const breakdown = (r.data?.taskBreakdown ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      totalEarned: num(r.data?.totalEarned),
      globalMaxPoints: num(r.data?.globalMaxPoints),
      tasks: Object.values(breakdown)
        .map((raw) => {
          const t = (raw ?? {}) as Record<string, unknown>;
          return {
            taskId: text(t.taskId),
            taskTitle: text(t.taskTitle),
            taskMaxPoints: num(t.taskMaxPoints),
            earnedPoints: num(t.earnedPoints),
            weightagePercent: num(t.weightagePercent),
          };
        })
        .filter((t) => t.taskId)
        /* Biggest contribution first: the question this answers is "where is my
           C2 coming from", and the answer starts with the largest source. */
        .sort((a, b) => b.earnedPoints - a.earnedPoints),
    },
  };
}

/* ── Files on a report ────────────────────────────────────────────────────── */

/** A file attached to a step's report, in the shape the engine stores. */
export interface LegacyGoalFile {
  name: string;
  driveUrl: string;
  downloadUrl: string;
  mimeType: string;
  size: number;
}

/**
 * `POST /cowork/upload/pdf` — a file, to Google Drive.
 *
 * The goal report keeps its files INLINE, as `{name, driveUrl, …}` on the
 * report itself, and that is the shape `submit-report` already accepts. It is
 * deliberately not the new app's `/cowork/attachments` system: that one hangs
 * files off an entity id and has no entity for a goal step, so using it would
 * mean a second place a report's files can live and two answers to "what was
 * handed in".
 *
 * The route is `upload/pdf` by name and takes anything — it is multer plus a
 * Drive upload, and the engine's own comment marks it LEGACY. Kept because it
 * is what the stored links point at.
 */
export async function uploadReportFile(input: {
  token: string;
  file: File;
}): Promise<LegacyResult<LegacyGoalFile>> {
  /* **Not through `legacyFetch`.** That helper JSON-encodes every body and
     sets `Content-Type: application/json`; an upload is `multipart/form-data`,
     and a `FormData` put through it arrives as `"[object FormData]"`. The same
     reasoning, and the same shape, as `attachments.ts` — which is written out
     for exactly this reason. */
  const form = new FormData();
  form.append("file", input.file);

  const base = readConfig(PUBLIC_ENV).apiUrl.replace(/\/+$/, "");
  let r: Response;
  try {
    r = await fetch(`${base}/cowork/upload/pdf`, {
      method: "POST",
      /* No `Content-Type`: the browser sets it, WITH the multipart boundary.
         Setting it by hand omits the boundary and the server parses nothing. */
      headers: { Authorization: `Bearer ${input.token}` },
      body: form,
    });
  } catch {
    return {
      ok: false,
      error: {
        message: "That file could not be uploaded — the connection failed.",
        status: 0,
        kind: "network",
      },
    };
  }

  const body = (await r.json().catch(() => ({}))) as {
    viewUrl?: unknown;
    downloadUrl?: unknown;
    url?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (!r.ok) {
    return {
      ok: false,
      error: {
        /* The engine's own words. It distinguishes "no file provided" from
           "Drive credentials are wrong", and only one of those is the
           uploader's problem. */
        message:
          text(body.message) ||
          text(body.error) ||
          "That file could not be uploaded.",
        status: r.status,
        kind: classify(r.status),
      },
    };
  }

  /* `viewUrl` where Drive gave one, `url` on an older response. A file that
     uploaded but came back with no link is a failure, not a file: storing it
     would put a name on the report that opens nothing. */
  const view = text(body.viewUrl) || text(body.url);
  if (!view) {
    return {
      ok: false,
      error: {
        message: "The file uploaded but came back without a link.",
        status: 502,
        kind: "malformed",
      },
    };
  }

  return {
    ok: true,
    data: {
      name: input.file.name,
      driveUrl: view,
      downloadUrl: text(body.downloadUrl) || view,
      mimeType: input.file.type || "application/octet-stream",
      size: input.file.size,
    },
  };
}
