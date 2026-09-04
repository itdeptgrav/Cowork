import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Live mailbox: a mail A sends reaches B's inbox without a poll, and a new
 * arrival raises a toast. The legacy watcher is an `onSnapshot` on the SAME
 * `participantIds` array-contains query the reads use — no `orderBy`, so no
 * composite index to deploy. Source assertions, in the wiring-test style here.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const TYPES = strip("lib/repositories/types.ts");
const LEGACY = strip("lib/repositories/legacy/index.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const AREA = strip("components/features/mail/MailArea.tsx");
const TARGET = strip("lib/rules/notifications/target.ts");

test("the repository exposes an optional live watcher", () => {
  assert.match(TYPES, /watchMail\?\(onChange: \(\) => void\): \(\) => void;/);
});

test("legacy watches over the auto-indexed query — no orderBy, no new index", () => {
  const fn = LEGACY.slice(
    LEGACY.indexOf("watchMail("),
    LEGACY.indexOf("watchMail(") + 700,
  );
  assert.match(fn, /onSnapshot\(/);
  assert.match(fn, /where\(\s*"participantIds",\s*"array-contains",\s*me\s*\)/);
  assert.doesNotMatch(fn, /orderBy/, "an orderBy would force a composite index");
});

test("the mock is an honest noop — one process has no live source", () => {
  assert.match(MOCK, /watchMail\(\): \(\) => void \{\s*return \(\) => \{\};/);
});

test("the mailbox subscribes once and refetches live", () => {
  assert.match(AREA, /repo\.watchMail\(\(\) => refetchRef\.current\(\)\)/);
});

test("a rising unread count raises the app's new-mail notification", () => {
  assert.match(AREA, /u > prev/);
  assert.match(AREA, /new CustomEvent\("cowork:notification"/);
  assert.match(AREA, /title: "New mail"/);
});

test("a mail push/bell routes to the mailbox (parity with the service worker)", () => {
  assert.match(TARGET, /mail_received: "mail"/);
  assert.match(TARGET, /case "mail":\s*return "\/mail"/);
});
