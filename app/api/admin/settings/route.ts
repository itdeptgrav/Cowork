import { NextResponse } from "next/server";
import { adminConsoleAccess } from "@/lib/server/adminAuth";
import { auditEntry } from "@/lib/rules/settings/audit";
import {
  ADMIN_REFUSAL,
  SETTINGS_REFUSAL,
} from "@/lib/rules/admin/access";
import { AUDIT_SECTION, type SettingsSectionId } from "@/lib/rules/settings/sections";

/**
 * The server-side authorisation layer for the settings console.
 *
 * ## What this route enforces, stated exactly
 *
 * It resolves the archetype **on the server**, from whichever of the two
 * sign-in systems the request used, and refuses anything that is not
 * `system_admin`. That is a real gate: the browser cannot talk its way past it,
 * because the answer is computed from a verified token and the engine's own role
 * record rather than from anything the client sends.
 *
 * ## What it does NOT enforce, and why saying so matters
 *
 * **It is not in the path of the Firestore write.** Settings documents are
 * written browser-to-Firestore with the user's own Firebase credentials —
 * `cowork_settings/office` and `cowork_sop_settings/task_events` are the
 * documented exception class where the Express engine offers no route, and legacy
 * writes them the same way. There is no service-account credential in this
 * deployment, so this server cannot perform those writes on the caller's behalf.
 *
 * So a determined person with a valid employee token could call Firestore
 * directly and bypass both this route and the repository check. The layer that
 * would actually stop that is a Firestore security rule on those two documents,
 * which is **not deployed** — the collections are shared with the live legacy app
 * and a rule that refused its writes would break it. See HANDOFF.
 *
 * Written down rather than implied, because a guard whose limits are undocumented
 * gets mistaken for one that has none.
 *
 * ## What it is genuinely for
 *
 * Two things the client should not decide for itself:
 *
 *  1. **The console's own routing** — `GET` returns the server's verdict, so
 *     navigation reflects a decision made where the archetype is trustworthy
 *     rather than one inferred from a client-side session object.
 *  2. **The audit entry** — `POST` computes the diff and the
 *     `affectsDeadlines` flag server-side and returns them. A non-admin gets a
 *     403 and no entry, so they cannot produce a well-formed audit row at all;
 *     and the flag that decides whether the user is warned about deadline impact
 *     is not something the page computes about itself.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The caller's administrative standing, decided on the server. */
export async function GET() {
  const { identity, mayOpenConsole, mayModifySettings, mayViewAuditLogs } =
    await adminConsoleAccess();

  /* 401 and 403 are different facts and the console words them differently:
     nobody verifiable behind the request versus a verified person without the
     archetype. Collapsing them would tell an ordinary employee to sign in
     again, which they cannot fix by doing. */
  if (!identity) {
    return NextResponse.json(
      { ok: false, message: "Not signed in." },
      { status: 401, headers: NO_STORE },
    );
  }
  if (!mayOpenConsole) {
    return NextResponse.json(
      { ok: false, message: ADMIN_REFUSAL },
      { status: 403, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      employeeId: identity.employeeId,
      archetype: identity.archetype,
      mayModifySettings,
      mayViewAuditLogs,
    },
    { headers: NO_STORE },
  );
}

interface PreflightBody {
  section?: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Preflight a settings change: refuse it, or return the entry that records it.
 *
 * The response carries no store write. It answers "may this person change this,
 * and what would the record say" — and the repository still authorises the write
 * itself, because a preflight is advice and a gate that only advises is not a
 * gate.
 */
export async function POST(request: Request) {
  const { identity, mayModifySettings } = await adminConsoleAccess();

  if (!identity) {
    return NextResponse.json(
      { ok: false, message: "Not signed in." },
      { status: 401, headers: NO_STORE },
    );
  }
  if (!mayModifySettings) {
    return NextResponse.json(
      { ok: false, message: SETTINGS_REFUSAL },
      { status: 403, headers: NO_STORE },
    );
  }

  let body: PreflightBody;
  try {
    body = (await request.json()) as PreflightBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Expected a JSON body." },
      { status: 400, headers: NO_STORE },
    );
  }

  /* The section must be one this product knows about. An unrecognised string
     would produce an audit row filed under a section nothing ever reads, and the
     log is append-only — there is no correcting it afterwards. */
  const section = body.section as SettingsSectionId | undefined;
  if (!section || !(section in AUDIT_SECTION)) {
    return NextResponse.json(
      {
        ok: false,
        message: `Unknown settings section. Expected one of: ${Object.keys(AUDIT_SECTION).join(", ")}.`,
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const entry = auditEntry({
    id: "",
    section: AUDIT_SECTION[section],
    changedById: identity.employeeId,
    changedAt: new Date().toISOString(),
    before: body.before ?? {},
    after: body.after ?? {},
    reason: body.reason ?? null,
  });


  
  /* Null means nothing actually changed. Reported as a successful no-op rather
     than an error: pressing Save without editing is ordinary, and `auditEntry`
     returns null precisely so a log does not fill with "changed nothing" rows. */
  return NextResponse.json(
    {
      ok: true,
      changed: entry !== null,
      entry,
      affectsDeadlines: entry?.affectsDeadlines ?? false,
    },
    { headers: NO_STORE },
  );
}
