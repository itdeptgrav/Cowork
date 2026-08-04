"use client";

import { joinUrl } from "@/lib/legacy/config";

/**
 * "Improve with AI" for plain task-form fields (title, description,
 * acceptance criteria) — a plain-text sibling to `requestAssist` in
 * `client.ts`, which drives the Docs/Sheets tool-calling assistant. Same
 * convention as every other write to `grav-cms-backend`: called directly at
 * `NEXT_PUBLIC_LEGACY_API_URL` with a Firebase ID token as a Bearer header,
 * `idToken` imported dynamically to keep the Firebase client SDK out of
 * bundles that never call it.
 *
 * Uses `joinUrl` rather than plain template concatenation — a base URL with a
 * trailing slash (as this repo's local `.env.local` has) otherwise produces
 * `//cowork/...`, which Express 404s on.
 */

export type TextAssistMode =
  | "grammar"
  | "rephrase"
  | "shorten"
  | "lengthen"
  | "custom";

/**
 * What the text actually is, so the backend's instructions match its real
 * shape — an email body needs a greeting/paragraphs/sign-off, a task title
 * must stay one line, and so on. Omit for fields with no better fit.
 */
export type TextAssistSurface =
  | "mail-subject"
  | "mail-body"
  | "task-title"
  | "task-description"
  | "task-criterion";

export type TextAssistOutcome =
  | { ok: true; text: string }
  | { ok: false; message: string };

/**
 * A stable key for "have these exact field values already been
 * grammar-checked?" — shared by every mandatory-check gate (mail compose,
 * task form, …) so editing any checked field after the fact reliably
 * re-engages its gate.
 */
export function textSignature(...values: string[]): string {
  return JSON.stringify(values);
}

export async function improveText(params: {
  text: string;
  mode: TextAssistMode;
  /** Required when `mode` is `"custom"` — the user's own instruction. */
  instruction?: string;
  surface?: TextAssistSurface;
}): Promise<TextAssistOutcome> {
  const base = process.env.NEXT_PUBLIC_LEGACY_API_URL;
  if (!base) {
    return { ok: false, message: "The assistant is not configured." };
  }

  const { idToken } = await import("../../legacy/firebase.ts");
  const token = await idToken();
  if (!token) {
    return { ok: false, message: "Sign in to use the assistant." };
  }

  try {
    const res = await fetch(joinUrl(base, "cowork/ai/improve-text"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        text: params.text,
        mode: params.mode,
        instruction: params.instruction,
        surface: params.surface,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      return {
        ok: false,
        message: typeof body.error === "string" ? body.error : "The assistant could not be reached.",
      };
    }

    if (typeof body.text === "string" && body.text.trim()) {
      return { ok: true, text: body.text };
    }

    return { ok: false, message: "The assistant returned an unexpected response." };
  } catch {
    return { ok: false, message: "The assistant could not be reached." };
  }
}
