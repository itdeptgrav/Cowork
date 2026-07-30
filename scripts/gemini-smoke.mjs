#!/usr/bin/env node
/**
 * TEMPORARY — manual smoke check for the Gemini integration.
 *
 * Not part of `npm run verify`, not imported by anything, and safe to delete.
 * It exists to answer one question by hand: does the configured key reach the
 * model and get a grounded answer back?
 *
 * It deliberately checks TWO things, because they are different:
 *
 *   1. The assistant flow (`POST /api/help`). "What is Cowork?" is a question
 *      the knowledge base answers confidently, so this path SHOULD return a
 *      knowledge answer and never call Gemini. Seeing `generated: false` here
 *      is the integration working, not failing.
 *
 *   2. The Gemini call itself, forced. This is the only way to verify the API
 *      responds for a question the corpus already covers.
 *
 * THE KEY IS NEVER PRINTED. It is read to build a request and nothing else —
 * not its value, not a prefix, not its length.
 *
 * Usage:  node scripts/gemini-smoke.mjs            (dev server must be running)
 *         node scripts/gemini-smoke.mjs --api-only (skip the route check)
 */

import { readFileSync, existsSync } from "node:fs";

const QUESTION = "What is Cowork?";
const ROUTE = "http://localhost:3000/api/help";

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (!existsSync(".env.local")) return null;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*GEMINI_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

/** The same rules the real service sends. Kept in sync by hand; this is a smoke test. */
const SYSTEM = `You are the help assistant for Cowork, an enterprise workspace and performance product.
Answer ONLY from the reference material provided. Never invent role names, status names, figures or menu paths.
Never state whether a specific person is permitted to do something.
Do not describe Cowork as an AI product.
Answer in plain prose, two or three sentences, no markdown.`;

const GROUNDING = `### What Cowork is (general)
Cowork is an enterprise workspace that brings tasks, projects, meetings, communication, documents and team workflows together — and measures performance from the same actions. Execution and measurement are one system rather than two: the act of working is the act of being measured. It is not an AI product.`;

async function checkRoute() {
  console.log("1 · Assistant flow — POST /api/help");
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: QUESTION }),
    });
    if (!res.ok) {
      console.log(`    route returned ${res.status}`);
      return;
    }
    const d = await res.json();
    console.log(`    source     ${d.source}`);
    console.log(`    confidence ${d.confidence}`);
    console.log(`    generated  ${d.generated}`);
    console.log(`    article    ${d.articleId ?? "—"}`);
    console.log(`    answer     ${d.answer.slice(0, 120)}…`);
    console.log(
      d.generated
        ? "    ⚠ expected a knowledge answer here — the corpus covers this question"
        : "    ✓ answered from the knowledge base, as designed (Gemini not called)",
    );
  } catch {
    console.log("    could not reach the dev server — start it with `npm run dev`");
  }
}

async function checkGemini() {
  console.log("\n2 · Gemini API — forced call");
  const key = loadKey();
  if (!key) {
    console.log("    GEMINI_API_KEY is not set. Nothing to check.");
    process.exitCode = 1;
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const started = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          parts: [
            {
              text: `Reference material:\n\n${GROUNDING}\n\n---\n\nA Cowork user asks: "${QUESTION}"\n\nAnswer from the reference material above.`,
            },
          ],
        },
      ],
    }),
  });

  const ms = Date.now() - started;
  const body = await res.json();

  if (!res.ok) {
    /* The provider message is printed because it is diagnostic and contains no
       credential — but only the first clause, since request echoes can be long
       and this is not the place to find out what else they carry. */
    const msg = String(body?.error?.message ?? "unknown")
      .split(".")[0]
      .slice(0, 140);
    console.log(`    ✗ HTTP ${res.status} in ${ms}ms — ${msg}`);
    process.exitCode = 1;
    return;
  }

  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  console.log(`    ✓ HTTP 200 in ${ms}ms · model ${MODEL}`);
  console.log(`\n    Q: ${QUESTION}`);
  console.log(`    A: ${text}\n`);

  const grounded =
    /workspace|tasks|performance|measure/i.test(text) &&
    !/\bAI product\b/i.test(text.replace(/not an AI product/gi, ""));
  console.log(
    grounded
      ? "    ✓ answer is grounded in the supplied material"
      : "    ⚠ answer drifted from the supplied material — check the grounding",
  );
}

console.log(`Gemini smoke check · "${QUESTION}"\n`);
if (!process.argv.includes("--api-only")) await checkRoute();
await checkGemini();
