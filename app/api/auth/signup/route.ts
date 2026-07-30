import { NextResponse } from "next/server";
import {
  emailProblem,
  identityStore,
  normaliseEmail,
  normalisePhone,
  phoneProblem,
  UniqueViolation,
} from "@/lib/server/store";
import { hashPassword, passwordProblem } from "@/lib/server/password";
import { issueSession, landingFor } from "@/lib/server/session";

/**
 * Create the first administrator, and the organisation with them.
 *
 * Every field is validated HERE. The form validates too, for the feedback, but
 * a form is a convenience and this is the boundary — anything that only the
 * client checks is not checked.
 *
 * Field-level errors come back keyed by field so the form can put the message
 * against the input that caused it, rather than a banner that makes somebody
 * hunt for which of six fields was wrong.
 */

export const runtime = "nodejs";

interface Body {
  fullName?: string;
  organisationName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  phone?: string;
}

function bad(field: string, message: string) {
  return NextResponse.json({ ok: false, field, message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, message: "That request could not be read." },
      { status: 400 },
    );
  }

  const fullName = (body.fullName ?? "").trim();
  const organisationName = (body.organisationName ?? "").trim();
  const email = body.email ?? "";
  const phone = body.phone ?? "";
  const password = body.password ?? "";
  const confirmPassword = body.confirmPassword ?? "";

  if (fullName.length < 2) return bad("fullName", "Enter your full name.");
  if (fullName.length > 120) return bad("fullName", "That name is too long.");
  if (organisationName.length < 2)
    return bad("organisationName", "Enter your organisation's name.");
  if (organisationName.length > 120)
    return bad("organisationName", "That organisation name is too long.");

  const emailIssue = emailProblem(email);
  if (emailIssue) return bad("email", emailIssue);

  const phoneIssue = phoneProblem(phone);
  if (phoneIssue) return bad("phone", phoneIssue);

  const passwordIssue = passwordProblem(password);
  if (passwordIssue) return bad("password", passwordIssue);

  if (password !== confirmPassword)
    return bad("confirmPassword", "The two passwords do not match.");

  /* Checked here for a good message, and again inside the store's write lock
     for the actual guarantee — see `createOrganisationWithFounder`. */
  if (await identityStore.findAccountByEmail(email))
    return bad(
      "email",
      "An account already exists for that email address. Sign in instead.",
    );
  if (await identityStore.findAccountByPhone(phone))
    return bad("phone", "That phone number is already registered.");

  try {
    const passwordHash = await hashPassword(password);
    const { account, organisation } =
      await identityStore.createOrganisationWithFounder({
        organisationName,
        displayName: fullName,
        email: normaliseEmail(email),
        phone: normalisePhone(phone),
        passwordHash,
      });

    /* Signed in immediately. Making somebody who just proved they own the
       password type it again is friction with no security value — the account
       was created by this very request. */
    await issueSession(account, request.headers.get("user-agent"));

    return NextResponse.json({
      ok: true,
      landing: landingFor(account.archetype),
      account: {
        displayName: account.displayName,
        email: account.email,
        archetype: account.archetype,
        organisationName: organisation.name,
      },
    });
  } catch (err) {
    if (err instanceof UniqueViolation)
      return bad(
        err.field,
        err.field === "email"
          ? "An account already exists for that email address. Sign in instead."
          : "That phone number is already registered.",
      );
    console.error("[auth] signup failed", err);
    return NextResponse.json(
      { ok: false, message: "The account could not be created. Try again." },
      { status: 500 },
    );
  }
}
