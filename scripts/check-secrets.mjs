#!/usr/bin/env node
/**
 * Fails the build if a server-only secret reached the browser bundle.
 *
 * The Focus Music integration is built on one rule: the YouTube API key is read
 * in exactly one place, on the server, and never enters client code. A rule
 * that is only written down is a rule that eventually breaks — one careless
 * import of `lib/music/youtube.ts` from a "use client" module is all it takes,
 * and nothing in TypeScript or ESLint would object.
 *
 * So it is checked mechanically, against the actual build output.
 *
 * The key VALUE is read here only to search for it. It is never printed: on
 * failure this reports the file and the offending NAME, never the secret.
 *
 * Usage: node scripts/check-secrets.mjs [buildDir]
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const BUILD_DIR = process.argv[2] ?? ".next/static";

/** Env vars that must never appear in client output, by name or by value. */
const SECRETS = ["YOUTUBE_API_KEY", "GEMINI_API_KEY", "LIVEKIT_API_SECRET"];

function loadEnvFiles() {
  const out = {};
  for (const file of [".env", ".env.local", ".env.production"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...out, ...process.env };
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|css|map|json)$/.test(path)) yield path;
  }
}

if (!existsSync(BUILD_DIR)) {
  console.error(`check-secrets: no build output at ${BUILD_DIR}. Run the build first.`);
  process.exit(2);
}

const env = loadEnvFiles();
const failures = [];

for (const path of files(BUILD_DIR)) {
  const text = readFileSync(path, "utf8");
  for (const name of SECRETS) {
    if (text.includes(name)) failures.push(`${path}: contains the name ${name}`);
    const value = env[name];
    // Short values would produce meaningless matches; a real key is long.
    if (value && value.length >= 16 && text.includes(value)) {
      failures.push(`${path}: contains the VALUE of ${name}`);
    }
  }
}

if (failures.length) {
  console.error("check-secrets: server-only secrets found in client output:\n");
  for (const f of failures) console.error(`  ${f}`);
  console.error("\nA client module is importing server-only code. Fix the import.");
  process.exit(1);
}

console.log(`check-secrets: clean — no server-only secret in ${BUILD_DIR}.`);
