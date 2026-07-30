import "server-only";
import { CONFIDENCE_ANSWER, searchHelp } from "./search";
import { askGemini, isGeminiConfigured, FALLBACK_MESSAGE } from "./gemini";
import { HELP_ARTICLES } from "./knowledge";
import type { Capability } from "@/lib/domain";
import type { HelpArticle, HelpCategory, HelpGuide } from "./types";

/**
 * The assistant flow: keyword search first, Gemini only when it cannot answer.
 *
 * The ordering is the design. The knowledge base is written from the code and
 * reviewed against it, so a keyword hit is a *stated* fact about Cowork. A
 * generated answer is an explanation of those facts — useful when somebody
 * phrases a question in a way the corpus did not anticipate, and strictly worse
 * when the corpus already had the answer. So Gemini never runs on a confident
 * hit, which also means the common path costs nothing and stays instant.
 *
 * Every answer carries its `source`, and the two values mean different things
 * to a reader: `knowledge` is Cowork stating a rule; `generated` is a model
 * explaining rules it was given. A surface that renders them identically has
 * thrown away the distinction the whole design rests on.
 */

export type AnswerSource =
  | "knowledge"
  /** A weak match. Offered as a related topic, never asserted as the answer. */
  | "related"
  | "generated"
  | "none";

export interface AssistantAnswer {
  found: boolean;
  source: AnswerSource;
  answer: string;
  /** 0–100 for a knowledge hit; null when generated — a model has no score. */
  confidence: number | null;
  /** The article, when the answer came from one. */
  articleId: string | null;
  articleTitle: string | null;
  /** Ids worth reading next. Present on both paths. */
  related: string[];
  /** True only for the Gemini path. Surfaces must disclose it. */
  generated: boolean;
  /**
   * The walkthrough, when this article has one AND the viewer can perform it.
   *
   * Withheld rather than disabled when the capability is missing: showing
   * somebody the steps for approving work they will be refused at teaches a
   * workflow and then contradicts it. The explanation still answers them.
   */
  guide: HelpGuide | null;
  /** Set when a guide exists but the viewer's role cannot perform it. */
  guideWithheldReason: string | null;
}

/**
 * How much of the corpus to send when falling back.
 *
 * The whole thing is small enough to send, and sending all of it means the
 * model can answer a question that spans two areas — "does rework affect who
 * approves my next task" touches scoring and approvals. Narrowing to the top
 * few matches would reintroduce exactly the retrieval problem the fallback
 * exists to work around.
 */
function groundingFor(category?: HelpCategory): HelpArticle[] {
  return category
    ? HELP_ARTICLES.filter((a) => a.category === category)
    : HELP_ARTICLES;
}

export interface AskOptions {
  /** An explicit category from the caller. Narrows the search outright. */
  category?: HelpCategory;
  /**
   * The category implied by the page the reader is on.
   *
   * Tried only AFTER an unscoped search has failed. A page is where somebody
   * happens to be standing, not what they are asking about — narrowing to it
   * first would answer a scoring question from the tasks corpus and sound
   * certain doing it.
   */
  pageCategory?: HelpCategory;
  /** Set false to test the keyword path in isolation. */
  allowFallback?: boolean;
  /** Resolves a capability for the current viewer. Supplied by the caller. */
  can?: (capability: Capability) => boolean;
}

export async function ask(
  question: string,
  options: AskOptions = {},
): Promise<AssistantAnswer> {
  const { category, allowFallback = true } = options;

  /* The page context deliberately does NOT narrow the search.
     Scoping to a subset can only remove candidates, never rescore them, so a
     page-scoped pass can never beat the unscoped one — and if it could, it
     would answer a scoring question from the tasks corpus purely because the
     reader happened to be standing on Tasks. The page earns its keep in the
     opening suggestions, which is where knowing the screen genuinely helps. */
  const hit = searchHelp(question, category ? { category } : {});

  /* A confident hit is answered from the knowledge base, full stop. Gemini is
     not consulted, not warmed up, and not billed. */
  if (hit.found && hit.confidence >= CONFIDENCE_ANSWER && hit.article) {
    return {
      found: true,
      source: "knowledge",
      answer: hit.article.answer,
      confidence: hit.confidence,
      articleId: hit.article.id,
      articleTitle: hit.article.title,
      related: hit.article.related,
      generated: false,
      ...guideFor(hit.article, options.can),
    };
  }

  if (allowFallback && isGeminiConfigured()) {
    const outcome = await askGemini(question, groundingFor(category));
    if (outcome.ok) {
      return {
        found: true,
        source: "generated",
        answer: outcome.result.answer,
        confidence: null,
        /* A generated answer is not attributed to an article, even when the
           weak search hit suggested one. Attributing generated prose to a
           reviewed article would launder it as a stated rule. */
        articleId: null,
        articleTitle: null,
        related: hit.article ? [hit.article.id] : [],
        generated: true,
        /* A generated answer never carries a walkthrough. Steps are authored
           against real UI; a model has no way to know what is on screen. */
        guide: null,
        guideWithheldReason: null,
      };
    }
  }

  /* Nothing confident, and no generated answer available. A weak hit is still
     worth offering — but as a RELATED topic, not as the answer. `source` says
     so, because a surface rendering it as a confident answer would state
     something the search itself is unsure of. */
  if (hit.found && hit.article) {
    return {
      found: true,
      source: "related",
      answer: hit.article.answer,
      confidence: hit.confidence,
      articleId: hit.article.id,
      articleTitle: hit.article.title,
      related: hit.article.related,
      generated: false,
      ...guideFor(hit.article, options.can),
    };
  }

  return {
    found: false,
    source: "none",
    answer: FALLBACK_MESSAGE,
    confidence: hit.confidence,
    articleId: null,
    articleTitle: null,
    related: [],
    generated: false,
    guide: null,
    guideWithheldReason: null,
  };
}

/**
 * Offer the walkthrough only to somebody who could actually do it.
 *
 * `can` is supplied by the caller rather than resolved here, because deciding
 * a permission needs the viewer's real roles and reporting line — and this
 * module has neither. The help layer asks the permission layer; it never
 * reimplements it.
 */
function guideFor(
  article: HelpArticle,
  can?: (capability: Capability) => boolean,
): { guide: HelpGuide | null; guideWithheldReason: string | null } {
  const guide = article.guide;
  if (!guide) return { guide: null, guideWithheldReason: null };
  if (!guide.requires || !can || can(guide.requires)) {
    return { guide, guideWithheldReason: null };
  }
  return {
    guide: null,
    guideWithheldReason:
      "This is not something your role can do, so there is nothing to walk you through — but here is how it works.",
  };
}
