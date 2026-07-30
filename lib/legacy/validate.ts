import { readIdentity, type LegacyMe } from "./auth.ts";
import { readEmployee, readEmployees, readHierarchy } from "./employees.ts";
import { readDashboard } from "./scoring.ts";
import { readTasks } from "./tasks.ts";
import { legacyFetch } from "./http.ts";
import { isCeoOrTl } from "./permissions.ts";

/**
 * Does the adapter agree with the engine?
 *
 * Every check fetches the **raw** legacy response and the **adapter's** version
 * of it, then compares. Legacy is correct by definition, so any disagreement is
 * an adapter bug — that framing decides what every verdict here means.
 *
 * ## What this is really hunting
 *
 * Envelope keys. Eleven of the fifteen the adapter uses were inferred from route
 * files that never declare one, and a wrong key **fails silently**: `unwrap()`
 * falls back to returning the whole envelope, mapping produces nothing, and the
 * screen renders a perfectly good empty state. No error anywhere.
 *
 * So the checks below are written to catch *empty where data was expected*, not
 * just exceptions. `envelopeCheck` exists precisely because "the adapter
 * returned 0 rows" and "the engine has 0 employees" look identical from the UI
 * and are entirely different problems.
 */

export type Verdict = "pass" | "fail" | "warn" | "skip";

export interface Check {
  id: string;
  label: string;
  verdict: Verdict;
  /** What the engine actually sent. Truncated for display. */
  legacy?: string;
  /** What the adapter produced. */
  adapter?: string;
  detail: string;
}

const MAX = 220;

export function show(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX ? text.slice(0, MAX) + "…" : text;
}

/**
 * Whether a response envelope carried the payload where the adapter looked.
 *
 * The single most valuable check in this file. Returns the array found under
 * `key`, or reports what shape actually arrived — which is how a wrong key
 * becomes a visible failure instead of an empty screen.
 */
export function envelopeCheck(input: {
  id: string;
  label: string;
  raw: unknown;
  key: string;
  adapterCount: number;
}): Check {
  const { raw, key } = input;
  const isRecord =
    typeof raw === "object" && raw !== null && !Array.isArray(raw);
  const atKey = isRecord ? (raw as Record<string, unknown>)[key] : undefined;

  if (Array.isArray(atKey)) {
    const same = atKey.length === input.adapterCount;
    return {
      id: input.id,
      label: input.label,
      verdict: same ? "pass" : "warn",
      legacy: `${key}: ${atKey.length} item(s)`,
      adapter: `${input.adapterCount} row(s)`,
      detail: same
        ? `Envelope key "${key}" is correct and every item mapped.`
        : `Envelope key "${key}" is correct, but the adapter kept ${input.adapterCount} of ${atKey.length}. Rows without an identifier are dropped on purpose — check whether that accounts for the difference.`,
    };
  }

  if (Array.isArray(raw)) {
    return {
      id: input.id,
      label: input.label,
      /* Always a warning, even when every row mapped: the declared key is
         wrong and should be removed. Passing it would hide a real mapping
         error behind a working screen. */
      verdict: "warn",
      legacy: `bare array, ${raw.length} item(s)`,
      adapter: `${input.adapterCount} row(s)`,
      detail: `The engine returned a bare array, not { "${key}": [...] }. The adapter's fallback handled it, but the declared key is wrong and should be removed.`,
    };
  }

  const keys = isRecord ? Object.keys(raw as object) : [];
  return {
    id: input.id,
    label: input.label,
    verdict: "fail",
    legacy: keys.length ? `keys: ${keys.join(", ")}` : show(raw),
    adapter: `${input.adapterCount} row(s)`,
    detail: keys.length
      ? `Envelope key "${key}" is WRONG — no array there. The engine sent: ${keys.join(", ")}. This is the failure that renders an empty screen with no error.`
      : `Expected an array under "${key}" and got neither that nor a bare array.`,
  };
}

/* ── The suite ────────────────────────────────────────────────────────────── */

export async function runValidation(input: {
  token: string;
  employeeId: string;
  role: string;
}): Promise<Check[]> {
  const checks: Check[] = [];
  const { token, employeeId } = input;

  /* 1 · Identity. The one endpoint whose shape was read from source, so a
     failure here means something bigger than a mapping mistake. */
  const meRaw = await legacyFetch<LegacyMe>({ path: "/cowork/me", token });
  if (!meRaw.ok) {
    checks.push({
      id: "me",
      label: "GET /cowork/me",
      verdict: "fail",
      detail: meRaw.error.message,
    });
  } else {
    const me = meRaw.data;
    const mapped = readIdentity(me);
    const ok = Boolean(me.employeeId && me.role && me.name);
    checks.push({
      id: "me",
      label: "GET /cowork/me — identity",
      verdict: ok ? "pass" : "fail",
      legacy: show(me),
      adapter: show(mapped),
      detail: ok
        ? `Engine says ${me.name} (${me.employeeId}), role "${me.role}". The adapter reads role "${mapped.role}".`
        : "The response is missing employeeId, role or name.",
    });

    if (me.role && mapped.role !== me.role) {
      checks.push({
        id: "role-fallthrough",
        label: "Unrecognised role handling",
        verdict: "warn",
        legacy: me.role,
        adapter: mapped.role,
        detail: `The engine's role "${me.role}" is not one of ceo/tl/employee, so the adapter treats it as "employee" — matching the engine's own fallthrough. Worth confirming that is intended.`,
      });
    }
  }

  /* 2 · Directory. Role decides the endpoint, exactly as the screen does. */
  const listPath = isCeoOrTl(input.role)
    ? "/cowork/employee/list"
    : "/cowork/employee/list-members";
  const listRaw = await legacyFetch<unknown>({ path: listPath, token });

  if (!listRaw.ok) {
    checks.push({
      id: "list",
      label: `GET ${listPath}`,
      verdict: "fail",
      detail: `${listRaw.error.message} (HTTP ${listRaw.error.status})`,
    });
  } else {
    const rawBody = listRaw.data;
    const arr =
      typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>).employees
        : rawBody;
    const mapped = Array.isArray(arr) ? readEmployees(arr as never[]) : [];

    checks.push(
      envelopeCheck({
        id: "list",
        label: `GET ${listPath} — envelope`,
        raw: rawBody,
        key: "employees",
        adapterCount: mapped.length,
      }),
    );

    if (mapped.length > 0) {
      const first = mapped[0];
      checks.push({
        id: "list-fields",
        label: "Directory row mapping",
        verdict: first.name && first.employeeId ? "pass" : "fail",
        legacy: show(Array.isArray(arr) ? arr[0] : null),
        adapter: show(first),
        detail: `First row: ${first.name} (${first.employeeId}), department ${first.department ?? "—"}, role ${first.role}.`,
      });

      const leaked = (Array.isArray(arr) ? arr : []).some(
        (r) => r && typeof r === "object" && "tempPassword" in (r as object),
      );
      checks.push({
        id: "temp-password",
        label: "Temporary passwords not exposed",
        verdict: leaked ? "fail" : "pass",
        detail: leaked
          ? "The engine returned tempPassword on directory rows. It must never be rendered."
          : "No tempPassword field on any row, as the engine's list path strips it.",
      });
    }
  }

  /* 3 · Own profile — the inferred envelope key most likely to be wrong. */
  const profRaw = await legacyFetch<unknown>({
    path: `/cowork/employee/${encodeURIComponent(employeeId)}`,
    token,
  });
  if (!profRaw.ok) {
    checks.push({
      id: "profile",
      label: `GET /cowork/employee/${employeeId}`,
      verdict: "fail",
      detail: `${profRaw.error.message} (HTTP ${profRaw.error.status})`,
    });
  } else {
    const body = profRaw.data as Record<string, unknown> | null;
    const inner =
      body && typeof body === "object" && "employee" in body
        ? (body.employee as Record<string, unknown>)
        : body;
    const mapped = inner ? readEmployee(inner as never) : null;
    const usedKey = Boolean(body && typeof body === "object" && "employee" in body);

    checks.push({
      id: "profile",
      label: "GET /cowork/employee/:id — envelope + mapping",
      verdict: mapped ? "pass" : "fail",
      legacy: show(body),
      adapter: show(mapped),
      detail: mapped
        ? usedKey
          ? 'Envelope key "employee" is correct. Profile mapped.'
          : 'The engine returned the employee BARE, not under "employee". The adapter\'s fallback coped, but the declared key should be removed.'
        : 'Nothing mapped. The declared envelope key "employee" is probably wrong — this is the silent-empty failure.',
    });

    if (mapped) {
      checks.push({
        id: "profile-department",
        label: "Department on own profile",
        verdict: mapped.department ? "pass" : "warn",
        legacy: show(inner?.department),
        adapter: mapped.department ?? "null",
        detail: mapped.department
          ? `Department reads "${mapped.department}".`
          : "No department on this record. Confirm against the old app before treating it as a mapping fault — it may genuinely be unset.",
      });
    }
  }

  /* 4 · Hierarchy, including the missing-HR-record signal. */
  const hierRaw = await legacyFetch<Record<string, unknown>>({
    path: `/cowork/employee/my-managers/${encodeURIComponent(employeeId)}`,
    token,
  });
  if (!hierRaw.ok) {
    checks.push({
      id: "hierarchy",
      label: "GET /cowork/employee/my-managers/:id",
      verdict: "fail",
      detail: `${hierRaw.error.message} (HTTP ${hierRaw.error.status})`,
    });
  } else {
    const mapped = readHierarchy(employeeId, hierRaw.data as never);
    const message = String(hierRaw.data.message ?? "");
    checks.push({
      id: "hierarchy",
      label: "Reporting line",
      verdict: "pass",
      legacy: show(hierRaw.data),
      adapter: show(mapped),
      detail: mapped.inHrSystem
        ? `In the HR system. Reports to ${mapped.primaryManager?.name ?? "nobody"}${mapped.secondaryManager ? `, also ${mapped.secondaryManager.name}` : ""}.`
        : "No HR record — no reporting line, department of record, attendance or SOP ledger. This is a real state, not an error.",
    });

    if (message && !/not found in hr/i.test(message)) {
      checks.push({
        id: "hr-marker",
        label: "Missing-HR-record marker",
        verdict: "warn",
        legacy: message,
        detail:
          'The engine sent a message the adapter does not recognise. The ONLY signal for "absent from HR" is the wording /not found in hr/i — if it has changed, a missing record silently reads as "no manager".',
      });
    }
  }

  /* 5 · Score. Unvalidated until now, and the figure this product is built
     around — so the checks are about SHAPE, never about whether a number looks
     plausible. `pmpService` owns the arithmetic and this must never second-guess
     it; the only question is whether the adapter can read what it sends. */
  checks.push(...(await validateScore({ token, employeeId })));

  /* 6 · Tasks. The envelope key was inferred, and a wrong one renders an empty
     list rather than an error — "you have no work" when the truth is "we looked
     in the wrong place". */
  checks.push(...(await validateTasks({ token })));

  /* 7-10 · Discovery. These four are unmapped, so the checks REPORT rather than
     assert: they print what the engine actually sends so a mapping can be
     written against evidence instead of against a guess. */
  checks.push(...(await discoverNotifications(token)));
  checks.push(...(await discoverMeetings(token)));
  checks.push(...(await discoverWorkload(token)));
  checks.push(...(await discoverGoalActivities(token)));

  /* 11-13 · The score breakdown endpoints. Unmapped, and the ONLY ones whose
     output reaches an appraisal — so they are probed before anything is
     written against them. */
  checks.push(...(await discoverScoreBreakdowns({ token, employeeId })));

  return checks;
}

/* ── Discovery ────────────────────────────────────────────────────────────── */

/**
 * What an unmapped endpoint actually returns.
 *
 * Deliberately assumption-free. It reports the envelope, the field names on the
 * first record and the count — enough to write a mapping from, and nothing that
 * presumes one. Verdicts mean:
 *
 * · `pass` — usable: it answered with records and their fields are readable.
 * · `warn` — partially usable: it answered, but empty or without recognisable
 *   records, so the shape cannot be confirmed from this account's data.
 * · `fail` — unavailable: refused, missing, or not reachable with this token.
 */
async function probeEndpoint(input: {
  id: string;
  label: string;
  path: string;
  token: string;
  /** Envelope keys to try, in order, before falling back to a bare array. */
  keys: string[];
  /** Fields a mapping would need. Reported as present/absent, never required. */
  wanted: string[];
}): Promise<Check[]> {
  const raw = await legacyFetch<unknown>({ path: input.path, token: input.token });

  if (!raw.ok) {
    return [
      {
        id: input.id,
        label: `${input.label} — GET ${input.path}`,
        verdict: "fail",
        detail:
          raw.error.status === 404
            ? "No such endpoint on this backend. The feature has no legacy source."
            : `${raw.error.message} (HTTP ${raw.error.status})`,
      },
    ];
  }

  const body = raw.data;
  const isRecord =
    typeof body === "object" && body !== null && !Array.isArray(body);
  const envelopeKeys = isRecord ? Object.keys(body as object) : [];

  let records: unknown[] | null = null;
  let usedKey = "(bare array)";
  if (Array.isArray(body)) {
    records = body;
  } else if (isRecord) {
    for (const key of input.keys) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        records = value;
        usedKey = key;
        break;
      }
    }
  }

  const checks: Check[] = [
    {
      id: `${input.id}-envelope`,
      label: `${input.label} — envelope`,
      verdict: records ? "pass" : isRecord ? "warn" : "fail",
      legacy: envelopeKeys.length
        ? `keys: ${envelopeKeys.join(", ")}`
        : show(body),
      adapter: records ? `${records.length} record(s) under "${usedKey}"` : "no array found",
      detail: records
        ? `Records arrive under "${usedKey}".`
        : isRecord
          ? `Answered with an object but no array under any of: ${input.keys.join(", ")}. It may be a single record or a differently-named collection — read the keys above.`
          : "Neither an object nor an array.",
    },
  ];

  if (!records || records.length === 0) {
    checks.push({
      id: `${input.id}-empty`,
      label: `${input.label} — no records`,
      verdict: "warn",
      detail:
        "The endpoint answered but returned nothing, so the record shape cannot be confirmed from this account. Try an account that has data before concluding the feature is unusable.",
    });
    return checks;
  }

  const first = records[0] as Record<string, unknown>;
  const fields = Object.keys(first ?? {});
  const present = input.wanted.filter((f) => first?.[f] !== undefined);
  const absent = input.wanted.filter((f) => first?.[f] === undefined);

  checks.push({
    id: `${input.id}-fields`,
    label: `${input.label} — fields on a real record`,
    verdict: present.length === 0 ? "warn" : absent.length ? "warn" : "pass",
    legacy: `all fields: ${fields.join(", ")}`,
    adapter: `wanted present: ${present.join(", ") || "none"} | absent: ${absent.join(", ") || "none"}`,
    detail: `${records.length} record(s). ${present.length} of ${input.wanted.length} expected fields present. The full field list above is what a mapping should be written against.`,
  });

  checks.push({
    id: `${input.id}-sample`,
    label: `${input.label} — first record`,
    verdict: "pass",
    legacy: show(first),
    detail: "Verbatim, for writing the mapping against real values.",
  });

  return checks;
}

function discoverNotifications(token: string): Promise<Check[]> {
  return probeEndpoint({
    id: "notifications",
    label: "Notifications",
    path: "/cowork/notifications",
    token,
    keys: ["notifications", "data", "items", "results"],
    wanted: ["id", "_id", "type", "title", "body", "message", "read", "isRead", "readAt", "createdAt", "recipientId", "employeeId"],
  });
}

function discoverMeetings(token: string): Promise<Check[]> {
  return probeEndpoint({
    id: "meetings",
    label: "Meetings",
    path: "/cowork/schedule-meet/list",
    token,
    keys: ["meets", "meetings", "data", "items"],
    wanted: ["id", "_id", "title", "participants", "participantIds", "startsAt", "startTime", "endsAt", "endTime", "organiserId", "createdBy", "status", "isRecurring", "repeatConfig"],
  });
}

async function discoverWorkload(token: string): Promise<Check[]> {
  /* Gated to CEO or TL, so a refusal here may be correct rather than a fault. */
  const checks = await probeEndpoint({
    id: "workload",
    label: "Workload",
    path: "/cowork/workload/summary",
    token,
    keys: ["summary", "data", "items", "employees", "workload"],
    wanted: ["employeeId", "name", "openTasks", "overdue", "hours", "load", "period", "week"],
  });
  if (checks[0]?.verdict === "fail") {
    checks.push({
      id: "workload-gate",
      label: "Workload — permission note",
      verdict: "warn",
      detail:
        "This endpoint is gated to CEO or TL. A refusal from an employee account is the engine behaving correctly, not a missing feature — re-run as a manager before concluding.",
    });
  }
  return checks;
}

/**
 * Goal activities, which need a goal task to ask about.
 *
 * So this first finds one from the task list rather than guessing an id. If the
 * account has no goal task, the endpoint cannot be probed at all — reported as
 * such rather than as a failure of the endpoint.
 */
async function discoverGoalActivities(token: string): Promise<Check[]> {
  const tasks = await legacyFetch<unknown>({
    path: "/cowork/task/list-hierarchy",
    envelopeKey: "tasks",
    token,
  });

  const list = tasks.ok && Array.isArray(tasks.data) ? tasks.data : [];
  const goal = (list as Record<string, unknown>[]).find((t) => t?.isGoal === true);

  if (!goal?.id) {
    return [
      {
        id: "goal-activities",
        label: "Goal activities — no goal task to probe",
        verdict: "warn",
        detail:
          "This account has no goal task, so /cowork/task/:id/goal-activities cannot be exercised. Not a verdict on the endpoint — re-run with an account that owns a goal. Deliberately NOT implemented in the repository until a real response has been seen: goal activities carry points that feed C2, and a mapping written from the route file rather than from data is exactly how a score comes out wrong.",
      },
    ];
  }

  return probeEndpoint({
    id: "goal-activities",
    label: "Goal activities",
    path: `/cowork/task/${encodeURIComponent(String(goal.id))}/goal-activities`,
    token,
    keys: ["activities", "goalActivities", "data", "items"],
    wanted: ["id", "_id", "heading", "title", "description", "points", "dueAt", "assigneeIds", "status", "report", "linkedTaskId"],
  });
}

/**
 * The three score-breakdown endpoints.
 *
 * `getScoreOverview` is validated and connected; these three are not, and they
 * feed `listScoreUnits`, `listScoreHistory` and the C1 configuration. Nothing
 * should be mapped from them until their real shape is on screen: `pmpService`
 * owns every formula and cites `CW-DEV-PMP-01 v1.0`, a specification in neither
 * repository, so a mapping written from a route file could disagree with the
 * number somebody is appraised on and nobody would see the difference.
 *
 * The config route is `/cowork/c1/config` — **not** under `/pmp/:id/`. It is
 * organisation-wide (the deduction constants), not per-employee.
 */
async function discoverScoreBreakdowns(input: {
  token: string;
  employeeId: string;
}): Promise<Check[]> {
  const id = encodeURIComponent(input.employeeId);
  const endpoints = [
    {
      id: "pmp-c1",
      label: "Score C1 breakdown",
      path: `/cowork/pmp/${id}/c1`,
      wanted: ["employeeId", "quarter", "year", "earned", "max", "tasks", "units", "deductions", "breakdown", "items"],
    },
    {
      id: "pmp-c2",
      label: "Score C2 breakdown",
      path: `/cowork/pmp/${id}/c2`,
      wanted: ["employeeId", "quarter", "year", "earned", "max", "goals", "activities", "units", "breakdown"],
    },
    {
      id: "c1-config",
      label: "C1 configuration (organisation-wide)",
      path: "/cowork/c1/config",
      wanted: ["maxPoints", "baseScore", "deadline", "extension", "rework", "reject", "bands", "globalSettings"],
    },
  ];

  const out: Check[] = [];
  for (const ep of endpoints) {
    const raw = await legacyFetch<unknown>({ path: ep.path, token: input.token });

    if (!raw.ok) {
      out.push({
        id: ep.id,
        label: `${ep.label} — GET ${ep.path}`,
        verdict: "fail",
        detail:
          raw.error.status === 404
            ? "No such endpoint. Nothing to map."
            : raw.error.status === 403
              ? `Refused (403): ${raw.error.message}. This endpoint is scoped — a TL may only read their own department. Confirm the role before treating it as missing.`
              : `${raw.error.message} (HTTP ${raw.error.status})`,
      });
      continue;
    }

    const body = raw.data;
    const isRecord =
      typeof body === "object" && body !== null && !Array.isArray(body);
    const keys = isRecord ? Object.keys(body as object) : [];
    const record = (isRecord ? body : {}) as Record<string, unknown>;
    const present = ep.wanted.filter((f) => record[f] !== undefined);

    out.push({
      id: `${ep.id}-shape`,
      label: `${ep.label} — response keys`,
      verdict: keys.length === 0 ? "warn" : "pass",
      legacy: keys.length
        ? `keys: ${keys.join(", ")}`
        : Array.isArray(body)
          ? `bare array, ${body.length} item(s)`
          : show(body),
      adapter: `expected fields present: ${present.join(", ") || "none of the guesses"}`,
      detail: keys.length
        ? `HTTP 200. ${keys.length} top-level keys. Write the mapping against THIS list — the "expected" names above were guesses and carry no weight.`
        : "Answered, but with no readable object keys. Read the raw value below before mapping.",
    });

    out.push({
      id: `${ep.id}-sample`,
      label: `${ep.label} — sanitised payload`,
      verdict: "pass",
      legacy: show(body),
      detail:
        "Truncated to 220 characters. Verbatim otherwise — this is what a mapping must be written against.",
    });
  }

  return out;
}

/* ── Score ────────────────────────────────────────────────────────────────── */

const SCORE_FIELDS = [
  "totalEarned",
  "rawQuarterScore",
  "c1",
  "c2",
  "c3",
  "c4Net",
  "quarter",
  "year",
  "rating",
] as const;

export async function validateScore(input: {
  token: string;
  employeeId: string;
}): Promise<Check[]> {
  const path = `/cowork/pmp/${encodeURIComponent(input.employeeId)}/dashboard`;
  const raw = await legacyFetch<Record<string, unknown>>({
    path,
    token: input.token,
  });

  if (!raw.ok) {
    return [
      {
        id: "score",
        label: `GET ${path}`,
        verdict: "fail",
        detail:
          raw.error.status === 403
            ? `Refused (403): ${raw.error.message}. The engine scopes this endpoint — a TL may only read their own department. Confirm the employee id is right before treating it as a mapping fault.`
            : `${raw.error.message} (HTTP ${raw.error.status})`,
      },
    ];
  }

  const body = raw.data;
  const present = SCORE_FIELDS.filter((f) => body[f] !== undefined);
  const missing = SCORE_FIELDS.filter((f) => body[f] === undefined);
  const mapped = readDashboard(body);

  const out: Check[] = [
    {
      id: "score-envelope",
      label: "Score — response shape",
      /* A bare object is what the adapter expects. A `data` wrapper would mean
         the reader is looking one level too shallow. */
      verdict: "data" in body && "success" in body ? "fail" : "pass",
      legacy: `keys: ${Object.keys(body).slice(0, 12).join(", ")}`,
      adapter: show(mapped),
      detail:
        "data" in body && "success" in body
          ? "The engine wrapped this in { success, data }. `readDashboard` reads the body directly and must unwrap first."
          : "Returned bare, as the adapter expects.",
    },
    {
      id: "score-identity",
      label: "Score — employee id mapping",
      verdict:
        body.employeeId === undefined || body.employeeId === input.employeeId
          ? "pass"
          : "fail",
      legacy: show(body.employeeId),
      adapter: input.employeeId,
      detail:
        body.employeeId === undefined
          ? "The response does not echo the employee id; the request path is the only binding."
          : body.employeeId === input.employeeId
            ? "The engine echoed the same employee id that was requested."
            : "The engine answered for a DIFFERENT employee than was asked for. Do not render this.",
    },
    {
      id: "score-fields",
      label: "Score — fields available to Home",
      verdict: present.length === 0 ? "fail" : missing.length ? "warn" : "pass",
      legacy: `present: ${present.join(", ") || "none"}`,
      adapter: `absent: ${missing.join(", ") || "none"}`,
      detail:
        present.length === 0
          ? "None of the expected score fields is present. The adapter would render an empty dashboard."
          : `${present.length} of ${SCORE_FIELDS.length} expected fields present.`,
    },
    {
      id: "score-values",
      label: "Score — component shapes",
      verdict: hasAnyScore(mapped) ? "pass" : "warn",
      legacy: `c1=${show(body.c1)} c2=${show(body.c2)} c3=${show(body.c3)} c4Net=${show(body.c4Net)}`,
      adapter: mapped.components
        .map((c) => `${c.key}=${c.earned ?? "—"}/${c.max ?? "—"}`)
        .join(" "),
      detail: hasAnyScore(mapped)
        ? "Component values read. Note whether each arrived as a bare number or as { earned, max } — the adapter accepts both."
        : "No component value could be read. Either this employee has no scored activity this quarter, or the field shapes differ from what the adapter handles. Check the raw line above before assuming the first.",
    },
  ];

  return out;
}

function hasAnyScore(d: ReturnType<typeof readDashboard>): boolean {
  return d.totalEarned !== null || d.components.some((c) => c.earned !== null);
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

export async function validateTasks(input: {
  token: string;
}): Promise<Check[]> {
  const path = "/cowork/task/list-hierarchy";
  const raw = await legacyFetch<unknown>({ path, token: input.token });

  if (!raw.ok) {
    return [
      {
        id: "tasks",
        label: `GET ${path}`,
        verdict: "fail",
        detail: `${raw.error.message} (HTTP ${raw.error.status})`,
      },
    ];
  }

  const body = raw.data;
  const isRecord =
    typeof body === "object" && body !== null && !Array.isArray(body);
  const arr = isRecord
    ? (body as Record<string, unknown>).tasks
    : body;
  const list = Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
  const mapped = readTasks(list as never[]);

  const out: Check[] = [
    envelopeCheck({
      id: "tasks-envelope",
      label: `GET ${path} — envelope`,
      raw: body,
      key: "tasks",
      adapterCount: mapped.length,
    }),
  ];

  if (list.length === 0) {
    out.push({
      id: "tasks-empty",
      label: "Tasks — no rows returned",
      verdict: "warn",
      detail:
        "The engine returned no tasks. That may be true for this account, or the envelope key may be wrong — the two are indistinguishable from the UI, which is exactly why this check exists. Compare against the old Cowork app before concluding.",
    });
    return out;
  }

  const first = list[0];
  const sample = mapped[0];

  out.push({
    id: "tasks-schema",
    label: "Tasks — document shape",
    verdict: sample ? "pass" : "fail",
    legacy: `keys: ${Object.keys(first).slice(0, 14).join(", ")}`,
    adapter: show(sample),
    detail: sample
      ? `First task "${sample.title}" — status ${sample.status ?? "—"}, completionStatus ${sample.completionStatus ?? "—"}, kind ${sample.kind}.`
      : "Rows arrived but none mapped; every row is missing an id.",
  });

  /* The deadline lives on one of three fields depending on which path created
     the task. Reading only one renders "no deadline" for the rest. */
  const deadlineField =
    first.fixedDeadline !== undefined
      ? "fixedDeadline"
      : first.deadline !== undefined
        ? "deadline"
        : first.dueDate !== undefined
          ? "dueDate"
          : null;
  out.push({
    id: "tasks-deadline",
    label: "Tasks — deadline field and timestamp format",
    verdict: deadlineField ? "pass" : "warn",
    legacy: deadlineField
      ? `${deadlineField} = ${show(first[deadlineField])}`
      : "none of fixedDeadline / deadline / dueDate present",
    adapter: sample?.dueAtMs ? new Date(sample.dueAtMs).toISOString() : "null",
    detail: deadlineField
      ? `Carried on "${deadlineField}". The adapter reads ISO strings, epoch numbers and Firestore Timestamps.`
      : "No deadline field on the first task. It may be undated; check another row before treating this as a mapping fault.",
  });

  /* Legacy nests through parentTaskId rather than returning a tree. */
  const withParent = list.filter((t) => t.parentTaskId).length;
  out.push({
    id: "tasks-hierarchy",
    label: "Tasks — hierarchy structure",
    verdict: "pass",
    legacy: `${withParent} of ${list.length} carry parentTaskId`,
    adapter: `${mapped.length} mapped`,
    detail:
      withParent > 0
        ? "Hierarchy is expressed by parentTaskId on a flat list, not as a nested tree. Any tree the UI needs is assembled client-side."
        : "No parent references in this sample — a flat list of root tasks.",
  });

  /* Legacy allows what the new rules forbid; report it, never enforce it. */
  const multi = mapped.filter(
    (t) => t.kind === "standard" && t.assigneeIds.length > 1,
  ).length;
  out.push({
    id: "tasks-assignees",
    label: "Tasks — assignee counts against the new rule",
    verdict: multi > 0 ? "warn" : "pass",
    legacy: `${multi} standard task(s) with more than one assignee`,
    detail:
      multi > 0
        ? `Legacy holds ${multi} standard task(s) with several assignees. The approved rule permits one. Reported, never enforced — the engine's data is correct by definition.`
        : "Every standard task in this sample has a single assignee, consistent with the approved rule.",
  });

  return out;
}

export function summarise(checks: readonly Check[]): {
  pass: number;
  fail: number;
  warn: number;
  overall: Verdict;
} {
  const pass = checks.filter((c) => c.verdict === "pass").length;
  const fail = checks.filter((c) => c.verdict === "fail").length;
  const warn = checks.filter((c) => c.verdict === "warn").length;
  return { pass, fail, warn, overall: fail ? "fail" : warn ? "warn" : "pass" };
}
