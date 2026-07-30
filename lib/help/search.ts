import { HELP_ARTICLES } from "./knowledge.ts";
import type { HelpArticle, HelpMatch, HelpSearchResult } from "./types.ts";

/**
 * Finding the article that answers a question.
 *
 * Four signals, weighted, combined into a confidence out of 100. The weighting
 * is not arbitrary: it puts the most WEIGHT on the signals least likely to fire
 * by accident.
 *
 *   example question overlap   45   someone phrased it the way we anticipated
 *   keyword phrase hit         30   an exact multi-word phrase, not two loose words
 *   title overlap              15   the article is literally about this
 *   loose token overlap        10   weakest signal, and capped so it cannot carry a match alone
 *
 * The bands matter more than the number:
 *
 *   ≥ 60   answer it
 *   35–59  found, but offer it as "did you mean" rather than an assertion
 *   < 35   not found — say so
 *
 * A help system that always answers is a help system that sometimes lies. The
 * floor exists so the honest outcome is reachable, and `general-missing-answer`
 * exists so there is something true to say when it is.
 *
 * No dependencies: the fuzzy step is bounded edit distance, which is enough for
 * typos and plurals over a corpus this size and costs nothing to reason about.
 */

/** Words carrying no discriminating signal in questions about a product. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "get",
  "give",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "should",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenise(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

/**
 * Levenshtein distance, abandoned once it exceeds `max`.
 *
 * The bound is what keeps this cheap and, more importantly, what keeps it
 * honest: two words four edits apart are not a typo for each other, and
 * allowing that turns fuzzy matching into a way to match anything.
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Do these two tokens match, allowing a typo or a plural?
 *
 * The substitution allowance is deliberately mean. A single substitution on a
 * five-letter word is not a typo, it is a different word — "score" and "scope"
 * are one edit apart, and letting that match sent every scoring question to the
 * permissions article. Transposition is treated separately because it genuinely
 * is a typo at any length: "tsak" is nobody's word for anything.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Plurals and stems: "task"/"tasks", "creat"/"create".
  if (a.length > 4 && b.length > 4 && (a.startsWith(b) || b.startsWith(a)))
    return true;
  if (isTransposition(a, b)) return true;
  // Substitution only on words long enough for one edit to still be unambiguous.
  const min = Math.min(a.length, b.length);
  if (min < 6) return false;
  return editDistance(a, b, min >= 10 ? 2 : 1) <= (min >= 10 ? 2 : 1);
}

/** Two adjacent characters swapped — the commonest typing slip. */
function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 3) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  if (diff.length !== 2) return false;
  const [i, j] = diff;
  return j === i + 1 && a[i] === b[j] && a[j] === b[i];
}

/** Share of `needles` present in `haystack`, fuzzily. 0–1. Directional. */
function overlap(needles: string[], haystack: string[]): number {
  if (needles.length === 0) return 0;
  const hit = needles.filter((n) => haystack.some((h) => tokensMatch(n, h)));
  return hit.length / needles.length;
}

/**
 * Symmetric similarity between two token sets. 0–1.
 *
 * Containment is not similarity, and using it for example questions was a real
 * defect: "Where can I assign work?" is entirely contained in "what happens to
 * assigned work if someone leaves", so it scored a perfect 1.0 and asserted an
 * answer about task creation to a question about offboarding. Balancing what
 * the example covers against what the QUESTION covers costs a short example
 * nothing when the question is short too, and correctly penalises it when the
 * question is asking something much larger.
 */
function similarity(a: string[], b: string[]): number {
  const precision = overlap(a, b);
  const recall = overlap(b, a);
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Does the question contain this keyword phrase?
 *
 * Phrase-aware on purpose: "create task" should score on a question containing
 * those two words ADJACENTLY, not on one that happens to contain "create" in
 * one clause and "task" in another. Multi-word keywords are checked as a
 * sequence; single words fall back to a fuzzy token hit.
 */
function phraseHit(keyword: string, questionTokens: string[]): boolean {
  const parts = tokenise(keyword);
  if (parts.length === 0) return false;
  if (parts.length === 1)
    return questionTokens.some((q) => tokensMatch(q, parts[0]));

  for (let i = 0; i + parts.length <= questionTokens.length; i++) {
    if (parts.every((p, k) => tokensMatch(p, questionTokens[i + k])))
      return true;
  }
  return false;
}

export const CONFIDENCE_ANSWER = 60;
export const CONFIDENCE_SUGGEST = 35;

function scoreArticle(
  article: HelpArticle,
  questionTokens: string[],
): HelpMatch {
  const signals: string[] = [];

  /* 1 · Example questions. The strongest signal — a match here means somebody
     anticipated this exact question. Best single example wins rather than the
     average, or an article with many examples would be penalised for it. */
  const bestExample = Math.max(
    0,
    ...article.examples.map((ex) => similarity(tokenise(ex), questionTokens)),
  );
  if (bestExample > 0.5) signals.push("matches an example question");

  /* 2 · Keyword phrases. */
  const keywordHits = article.keywords.filter((k) =>
    phraseHit(k, questionTokens),
  );
  const keywordScore = Math.min(1, keywordHits.length / 2);
  if (keywordHits.length) signals.push(`keyword: ${keywordHits[0]}`);

  /* 3 · Title. */
  const titleScore = overlap(tokenise(article.title), questionTokens);
  if (titleScore > 0.5) signals.push("title overlap");

  /* 4 · Loose tokens across the whole article. Capped, because on its own it
     would match the longest article rather than the right one. */
  const body = tokenise(
    `${article.title} ${article.keywords.join(" ")} ${article.examples.join(" ")}`,
  );
  const looseScore = overlap(questionTokens, body);

  let confidence = Math.round(
    bestExample * 45 + keywordScore * 30 + titleScore * 15 + looseScore * 10,
  );

  /* Vocabulary alone cannot reach the answer band.
     Found by probing: "what happens to assigned work if someone leaves" scored
     66 against "Creating a task" — "assigned work" stems onto the keyword
     "assign work", and keyword plus loose overlap was enough to assert an
     answer about task creation to a question about offboarding.
     With no example-question overlap at all we know the words match, not that
     the QUESTION matches, so the result is capped into the suggest band. It is
     still offered; it is no longer asserted. */
  if (bestExample === 0) {
    confidence = Math.min(confidence, CONFIDENCE_ANSWER - 5);
    if (confidence > 0) signals.push("vocabulary only — capped");
  }

  return { article, confidence: Math.min(100, confidence), signals };
}

export interface SearchOptions {
  /** Restrict to one category, when the caller already knows the area. */
  category?: HelpArticle["category"];
  /** How many alternatives to return. */
  limit?: number;
}

/**
 * Answer a question from the knowledge base.
 *
 * `found` is false below the suggest floor — deliberately, and it is the whole
 * point of the confidence score. The caller is expected to say so rather than
 * render the best of a bad set as though it were an answer.
 */
export function searchHelp(
  question: string,
  options: SearchOptions = {},
): HelpSearchResult {
  const tokens = tokenise(question);

  if (tokens.length === 0) {
    return {
      found: false,
      confidence: 0,
      answer: null,
      article: null,
      alternatives: [],
    };
  }

  const pool = options.category
    ? HELP_ARTICLES.filter((a) => a.category === options.category)
    : HELP_ARTICLES;

  const ranked = pool
    .map((a) => scoreArticle(a, tokens))
    .filter((m) => m.confidence > 0)
    .sort(
      (a, b) =>
        b.confidence - a.confidence || a.article.id.localeCompare(b.article.id),
    );

  const top = ranked[0];
  const found = !!top && top.confidence >= CONFIDENCE_SUGGEST;

  return {
    found,
    confidence: top?.confidence ?? 0,
    answer: found ? top.article.answer : null,
    article: found ? top.article : null,
    alternatives: ranked.slice(1, 1 + (options.limit ?? 3)),
  };
}

/** Browse: every article in a category, for a future contents page. */
export function articlesInCategory(
  category: HelpArticle["category"],
): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category);
}

/** Resolve an article's `related` ids to articles, skipping anything missing. */
export function relatedArticles(article: HelpArticle): HelpArticle[] {
  return article.related
    .map((id) => HELP_ARTICLES.find((a) => a.id === id))
    .filter((a): a is HelpArticle => !!a);
}
