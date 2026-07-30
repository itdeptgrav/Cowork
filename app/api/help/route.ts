import { NextResponse } from "next/server";
import { ask } from "@/lib/help/assistant";
import { contextForPath } from "@/lib/help/context";
import { getRepository } from "@/lib/repositories";
import { can } from "@/lib/auth/can";
import { PROFILE_SWITCHER_ENABLED } from "@/lib/config/profileSwitcher";
import type { HelpCategory } from "@/lib/help/types";

/**
 * The assistant endpoint.
 *
 * A server route because that is the only place the Gemini key exists. The
 * browser sends a question and receives an answer; it never holds a credential,
 * never talks to the provider, and cannot reach the model except through this
 * flow — which means the grounding, the system rules and the keyword-first
 * ordering cannot be bypassed by a client that decides to call Gemini itself.
 *
 * `POST` rather than `GET` deliberately: a question is user content, and user
 * content in a URL ends up in access logs, browser history and referrer
 * headers.
 */

const CATEGORIES: HelpCategory[] = [
  "tasks",
  "approvals",
  "roles",
  "status",
  "scoring",
  "settings",
  "general",
];

const MAX_QUESTION_LENGTH = 500;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const question =
    typeof body === "object" && body !== null && "question" in body
      ? String((body as { question?: unknown }).question ?? "")
      : "";

  if (!question.trim()) {
    return NextResponse.json(
      { error: "A question is required." },
      { status: 400 },
    );
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    /* Bounded because the question is interpolated into a prompt. A long
       question is not a useful one, and an unbounded one is a cost and a
       prompt-injection surface at the same time. */
    return NextResponse.json(
      { error: `Keep questions under ${MAX_QUESTION_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const raw =
    typeof body === "object" && body !== null && "category" in body
      ? String((body as { category?: unknown }).category ?? "")
      : "";
  const explicit = CATEGORIES.includes(raw as HelpCategory)
    ? (raw as HelpCategory)
    : undefined;

  /* The page is a HINT, not a filter. Somebody standing on the Tasks screen may
     genuinely be asking about scoring, and narrowing the corpus to the page
     they happen to be on would answer the wrong question confidently. So the
     page context is only consulted when the unscoped search cannot answer. */
  const page =
    typeof body === "object" && body !== null && "page" in body
      ? String((body as { page?: unknown }).page ?? "")
      : "";

  /* The walkthrough gate asks the permission layer rather than guessing, so the
     assistant offers a tour only to somebody who could complete it.

     Who "somebody" is has to be told to us. The profile switcher lives in the
     browser and changes the client's repository singleton; this process never
     sees that, so it previously answered every permission question about the
     seeded default — switch to an employee with no admin rights and the
     assistant still offered administrator walkthroughs.

     The client-supplied id is accepted ONLY when the development profile
     switcher is compiled in, which requires both its env flag and a non-
     production build. In production the field is ignored entirely, so this
     cannot become a way to assert an identity over the wire. It is also read-
     only either way: this route answers questions and gates an offer to be
     guided. Every action the walkthrough leads to is re-checked by the
     repository against the real acting viewer. */
  const requestedViewer =
    PROFILE_SWITCHER_ENABLED &&
    typeof body === "object" &&
    body !== null &&
    "actingEmployeeId" in body &&
    typeof (body as { actingEmployeeId?: unknown }).actingEmployeeId ===
      "string"
      ? (body as { actingEmployeeId: string }).actingEmployeeId
      : undefined;

  const repo = getRepository();
  const [viewer, roles, people] = await Promise.all([
    repo.getViewer(requestedViewer),
    repo.listRoles(),
    repo.listEmployees(),
  ]);
  const ctx = {
    viewer,
    roles,
    directReportIds: viewer.directReportIds,
    hierarchyIds: viewer.hierarchyIds,
    levelOf: (id: string) => {
      const e = people.find((p) => p.id === id);
      if (!e) return 0;
      const levels = roles
        .filter((r) => e.roleIds.includes(r.id))
        .map((r) => r.administrativeLevel);
      return levels.length ? Math.max(...levels) : 0;
    },
  };

  const answer = await ask(question, {
    category: explicit,
    pageCategory: explicit
      ? undefined
      : (contextForPath(page).category ?? undefined),
    can: (capability) => can(ctx, capability).allowed,
  });
  return NextResponse.json(answer);
}

/**
 * The opening state: what to offer before anything is asked.
 *
 * A GET because it is a pure read derived from the path, and the panel needs it
 * the moment it opens. No question is sent, so nothing here is user content.
 */
export function GET(request: Request) {
  const page = new URL(request.url).searchParams.get("page") ?? "";
  const { prompt, suggestions } = contextForPath(page);
  return NextResponse.json({ prompt, suggestions });
}
