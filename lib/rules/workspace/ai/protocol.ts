/**
 * The wire contract with the backend AI service — nothing about Docs or
 * Sheets specifically, just the envelope both surfaces share.
 *
 * ## Why this is duplicated from the backend rather than imported
 *
 * It cannot be imported: this is a separate repository (`grav-cms-backend`),
 * reached over HTTP, not a module in this tree. The bounds here
 * (`MAX_INSTRUCTION_LENGTH`, `MAX_CONTEXT_LENGTH`) are deliberately the same
 * numbers the route enforces, so a request the client thinks is valid is
 * never one the server then refuses — but they are two independent
 * enforcements, not one shared source. A route that only trusted the
 * client's own claim about size would not be validating anything.
 *
 * ## What "controlled tool call" means at this layer
 *
 * The backend returns either a `tool_call` (a tool name and the arguments
 * Gemini's function-calling produced) or a `message` (plain text — a
 * question, a refusal, an explanation). This module only shapes that
 * envelope; it does not know what a valid `replace_selection` argument looks
 * like — that is `lib/rules/documents/aiTools.ts` and
 * `lib/rules/sheets/aiTools.ts`, one per surface, because the tool sets and
 * their safety rules genuinely differ.
 */

export type AiSurface = "docs" | "sheets";

export const MAX_INSTRUCTION_LENGTH = 1500;
export const MAX_CONTEXT_LENGTH = 12_000;
export const MAX_HISTORY_TURNS = 6;

export interface AiChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiAssistRequest {
  surface: AiSurface;
  instruction: string;
  context: { summary: string };
  history: AiChatTurn[];
}

/** What the backend can send back, before either surface's own tool validation runs. */
export type AiAssistFailureReason =
  | "not_configured"
  | "invalid_tool"
  | "empty"
  | "failed"
  | "quota"
  | "rejected";

export type AiAssistOutcome =
  | { ok: true; kind: "tool_call"; tool: string; args: Record<string, unknown>; model: string }
  | { ok: true; kind: "message"; text: string; model: string }
  | { ok: false; reason: AiAssistFailureReason; message: string };

/**
 * Would the backend refuse this before even calling Gemini?
 *
 * Checked client-side so a too-long instruction is caught the moment
 * somebody finishes typing it, not after a round trip that was always going
 * to fail.
 */
export function assistRequestRefusal(request: {
  instruction: string;
  contextSummary: string;
}): string | null {
  const instruction = request.instruction.trim();
  if (!instruction) return "Type an instruction first.";
  if (instruction.length > MAX_INSTRUCTION_LENGTH)
    return `Keep the instruction under ${MAX_INSTRUCTION_LENGTH} characters.`;
  if (request.contextSummary.length > MAX_CONTEXT_LENGTH)
    return "That is too much context for the assistant. Select a smaller range and try again.";
  return null;
}
