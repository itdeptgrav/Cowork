import { NextResponse } from "next/server";
import { currentSession } from "@/lib/server/session";
import { identityStore } from "@/lib/server/store";

/**
 * Who exists in this organisation.
 *
 * **Why this route has to exist.** Employees live in the workspace store, which
 * is per-browser `localStorage`. Accounts live server-side and are shared. The
 * only thing that ever turned an account into a workspace employee was
 * `ensureSessionEmployee`, which provisions THE SIGNED-IN USER, in THEIR OWN
 * browser — so somebody created on one machine, or signed in on another, was
 * absent from every other browser's People list. Not filtered out: absent.
 * `listEmployees()` applies no filter at all, so there was nothing to relax;
 * the record simply was not there to return.
 *
 * This is the shared list the workspace reconciles against on session load.
 *
 * **Scope and disclosure.** Organisation-scoped, from the caller's own session
 * rather than from a parameter — a caller cannot ask about an organisation
 * they are not in, so this cannot enumerate the instance. It returns only what
 * is needed to construct an employee record and nothing that is a credential:
 * no password hash, no phone, no session or token material.
 *
 * **It is not an authorisation decision.** Being listed here makes a person
 * exist in the workspace; it does not make them visible on team surfaces or
 * assignable. Those stay with `#closure()` and `assignableIds()`, which are
 * unchanged — a directory that granted reach would be a permission change
 * wearing a data fix's clothes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }

  const accounts = await identityStore.listAccountsByOrganisation(
    session.organisationId,
  );
  const org = await identityStore.findOrganisationById(session.organisationId);

  return NextResponse.json(
    {
      ok: true,
      organisationName: org?.name ?? "",
      members: accounts
        /* A suspended account keeps its employee record — the person still
           owns past work and has to stay renderable in history. Only accounts
           that were never usable are withheld. */
        .filter((a) => a.status !== "invited")
        .map((a) => ({
          employeeId: a.employeeId,
          displayName: a.displayName,
          email: a.email,
          archetype: a.archetype,
          status: a.status,
          /* Provenance, not hierarchy. It lets the workspace tell an intentional
             organisation root apart from somebody nobody has placed yet — the
             two are indistinguishable in the reporting tree, which is exactly
             how an unattached employee stays invisible to every manager. */
          isFounder: a.id === org?.founderUserId,
        })),
    },
    { headers: NO_STORE },
  );
}
