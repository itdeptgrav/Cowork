import "server-only";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { HELP_ARTICLES } from "./knowledge";
import type { HelpArticle } from "./types";

/**
 * Gemini, as a fallback explainer — never as an authority.
 *
 * **THE KEY NEVER LEAVES THIS MODULE.** It is read in exactly one function,
 * passed straight into the client constructor, and never returned, logged,
 * echoed into an error, or measured. `server-only` at the top makes importing
 * this from a `"use client"` module a build error rather than a runtime
 * surprise, and `scripts/check-secrets.mjs` fails the build if the name or the
 * value reaches the browser bundle. Three independent guards, because a rule
 * that is only written down is a rule that eventually breaks.
 *
 * **What this is allowed to be.** Gemini answers only when the keyword search
 * cannot, and only from the knowledge base it is given. It explains; it does
 * not decide. It is never consulted about whether a specific person may do a
 * specific thing — those answers come from `can()`, against real roles and real
 * reporting lines, and a language model's opinion about a permission is a
 * guess dressed as a ruling. The system prompt says so, the grounding contains
 * only general rules rather than any individual's data, and the caller marks
 * every Gemini answer as generated so a reader always knows which kind of
 * answer they are holding.
 */

/** Public flag. Safe anywhere: it is an on/off switch, not a secret. */
export function isGeminiConfigured(): boolean {
  return (
    typeof process.env.GEMINI_API_KEY === "string" &&
    process.env.GEMINI_API_KEY.length > 0
  );
}

/**
 * The model.
 *
 * `gemini-2.5-flash` was the requested model and this codepath was written for
 * it, but the API refuses it: "This model is no longer available to new users."
 * It appears in `models.list` and 404s on `generateContent`, which is a trap
 * worth recording — the listing is not a grant.
 *
 * `gemini-flash-latest` is the alias Google maintains for the current Flash
 * generation, so it tracks forward rather than pinning to a version that will
 * age the same way. Override with `GEMINI_MODEL` when a specific version is
 * wanted; the fallback here is what a key with no special access can reach.
 */
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

/**
 * The rules Gemini answers under.
 *
 * The negative instructions are the load-bearing ones. A model asked to be
 * helpful about an enterprise permissions system will, absent instruction,
 * invent a plausible hierarchy — and a confident invented answer about who
 * approves someone's work is exactly the failure the confidence banding in
 * `search.ts` exists to avoid. Better to decline.
 */
const SYSTEM_INSTRUCTION = `You are the help assistant for Cowork, an enterprise workspace and performance product.

Answer ONLY from the reference material provided in the user message. That material is the complete and authoritative description of how Cowork behaves.

Hard rules:
- If the reference material does not cover the question, say plainly that Cowork's help does not cover it and suggest the closest topic that IS covered. Never fill a gap with general knowledge about how workspace or task-management products usually work.
- Never state or imply whether a specific person is permitted to do a specific thing. Permissions in Cowork are decided by the product from real roles and reporting lines, not by you. Explain the general rule and say that the product itself decides the individual case.
- Never invent role names, status names, field names, menu paths, figures, thresholds or deductions. Use only the vocabulary in the reference material.
- If a rule is described as undecided or provisional, say it is undecided. Do not resolve it with a plausible value.
- Do not describe Cowork as an AI product. It is not one, and this assistant is a help feature rather than a product capability.

Style: answer in plain prose, two or three sentences, no markdown, no headings, no bullet lists. Address the reader as "you".`;

/**
 * The grounding corpus.
 *
 * Built from the same articles the keyword search uses, so the two paths can
 * never disagree about what Cowork does. `source` is deliberately excluded —
 * it is a maintenance aid pointing at file names, and a model given file paths
 * tends to start quoting them at end users.
 */
function groundingText(articles: HelpArticle[]): string {
  return articles
    .map(
      (a) =>
        `### ${a.title} (${a.category})\n${a.answer}\nRelated topics: ${a.related.join(", ") || "none"}`,
    )
    .join("\n\n");
}

export interface GeminiAnswer {
  answer: string;
  /** Always true for this path. The caller renders it as generated, not stated. */
  generated: true;
  model: string;
}

export type GeminiOutcome =
  | { ok: true; result: GeminiAnswer }
  | { ok: false; reason: "not_configured" | "failed"; message: string };

/**
 * Ask Gemini, grounded in the knowledge base.
 *
 * Returns a typed outcome rather than throwing: a help assistant that errors
 * when its optional fallback is unavailable is worse than one that quietly
 * falls back to "we do not cover that", which is a true statement either way.
 *
 * The error branch deliberately returns a fixed message. Provider errors can
 * echo request details, and this one is not going to be the thing that puts a
 * key fragment into a log.
 */
export async function askGemini(
  question: string,
  articles: HelpArticle[] = HELP_ARTICLES,
): Promise<GeminiOutcome> {
  if (!isGeminiConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "The assistant is not configured for generated answers.",
    };
  }

  try {
    /* The single read of the secret in this codepath. It goes straight into the
       constructor and is never held, returned or logged. */
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const prompt = `Reference material — the complete description of how Cowork behaves:

${groundingText(articles)}

---

A Cowork user asks: "${question}"

Answer from the reference material above. If it does not cover this, say so.`;

    const res = await model.generateContent(prompt);
    const text = res.response.text().trim();

    if (!text) {
      return { ok: false, reason: "failed", message: FALLBACK_MESSAGE };
    }

    return {
      ok: true,
      result: { answer: text, generated: true, model: MODEL },
    };
  } catch {
    /* Nothing from the provider error reaches the caller. It may contain the
       request, and the request is not worth the risk of it containing anything
       else. */
    return { ok: false, reason: "failed", message: FALLBACK_MESSAGE };
  }
}

export const FALLBACK_MESSAGE =
  "Cowork's help does not cover that. Try asking about tasks, approvals, roles and permissions, employee status, scoring or settings.";
