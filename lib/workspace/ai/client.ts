"use client";

import type {
  AiAssistFailureReason,
  AiAssistOutcome,
  AiChatTurn,
  AiSurface,
} from "@/lib/rules/workspace/ai/protocol";

/**
 * The one place this product calls the AI assistant's backend.
 *
 * Same convention as every other write to `grav-cms-backend`: the browser
 * calls it directly at `NEXT_PUBLIC_LEGACY_API_URL`, carrying a Firebase ID
 * token as a Bearer header (see `uploadMessageAttachment` in
 * `lib/repositories/legacy/index.ts` for the identical shape). There is no
 * Next.js route in between — `GEMINI_API_KEY` lives only in that backend's
 * `.env`, and this module never sees it, asks for it, or could leak it even
 * by mistake, because it is simply never present in anything this file can
 * reach.
 *
 * `idToken` is imported dynamically, matching the existing convention —
 * every other caller of the legacy backend does the same, to keep the
 * Firebase client SDK out of bundles that never call it.
 */

export async function requestAssist(params: {
  surface: AiSurface;
  instruction: string;
  contextSummary: string;
  history: AiChatTurn[];
}): Promise<AiAssistOutcome> {
  const base = process.env.NEXT_PUBLIC_LEGACY_API_URL;
  if (!base) {
    return { ok: false, reason: "not_configured", message: "The assistant is not configured." };
  }

  const { idToken } = await import("../../legacy/firebase.ts");
  const token = await idToken();
  if (!token) {
    return { ok: false, reason: "not_configured", message: "Sign in to use the assistant." };
  }

  try {
    const res = await fetch(`${base}/cowork/ai/assist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        surface: params.surface,
        instruction: params.instruction,
        context: { summary: params.contextSummary },
        history: params.history,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const KNOWN_REASONS: AiAssistFailureReason[] = [
        "not_configured",
        "invalid_tool",
        "empty",
        "failed",
        "quota",
      ];
      const reason = KNOWN_REASONS.includes(body.reason as AiAssistFailureReason)
        ? (body.reason as AiAssistFailureReason)
        : "failed";
      return {
        ok: false,
        reason,
        message: typeof body.error === "string" ? body.error : "The assistant could not be reached.",
      };
    }

    if (body.kind === "tool_call" && typeof body.tool === "string" && body.args && typeof body.args === "object") {
      return {
        ok: true,
        kind: "tool_call",
        tool: body.tool,
        args: body.args as Record<string, unknown>,
        model: typeof body.model === "string" ? body.model : "gemini-flash-lite-latest",
      };
    }
    if (body.kind === "message" && typeof body.text === "string") {
      return {
        ok: true,
        kind: "message",
        text: body.text,
        model: typeof body.model === "string" ? body.model : "gemini-flash-lite-latest",
      };
    }

    return { ok: false, reason: "failed", message: "The assistant returned an unexpected response." };
  } catch {
    return { ok: false, reason: "failed", message: "The assistant could not be reached." };
  }
}

export interface AssistStatus {
  configured: boolean;
  model: string;
}

/** Whether the backend has a Gemini key at all — drives the panel's quota/unconfigured state. */
export async function assistStatus(): Promise<AssistStatus | null> {
  const base = process.env.NEXT_PUBLIC_LEGACY_API_URL;
  if (!base) return null;
  try {
    const { idToken } = await import("../../legacy/firebase.ts");
    const token = await idToken();
    if (!token) return null;
    const res = await fetch(`${base}/cowork/ai/assist/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { configured?: unknown; model?: unknown };
    return {
      configured: body.configured === true,
      model: typeof body.model === "string" ? body.model : "gemini-flash-lite-latest",
    };
  } catch {
    return null;
  }
}
