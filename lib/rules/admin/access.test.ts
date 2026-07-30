import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ADMIN_REFUSAL,
  AUDIT_REFUSAL,
  SETTINGS_REFUSAL,
  canAccessAdminConsole,
  canModifySettings,
  canViewAuditLogs,
} from "./access.ts";
import { SETTINGS_SECTIONS } from "../settings/sections.ts";

/**
 * One definition of "administrator", and it is `system_admin`.
 *
 * There were two. `mayOpenAdmin` said `system_admin || people_ops`, and the
 * settings repository separately inferred an administrator from
 * `legacyRole === "ceo"`. Which one applied depended on whether a request
 * arrived through a page or through a repository call — so the same account
 * could be an administrator in one path and not in the other.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const EVERY_ARCHETYPE = [
  "employee",
  "manager",
  "skip_level",
  "people_ops",
  "system_admin",
] as const;

/* ── 1–4 · Who gets in ────────────────────────────────────────────────────── */

test("only system_admin passes any of the three gates", () => {
  for (const archetype of EVERY_ARCHETYPE) {
    const allowed = archetype === "system_admin";
    const user = { archetype };
    assert.equal(canAccessAdminConsole(user), allowed, `${archetype}: console`);
    assert.equal(canViewAuditLogs(user), allowed, `${archetype}: audit`);
    assert.equal(canModifySettings(user), allowed, `${archetype}: settings`);
  }
});

test("people_ops is refused, which is the change", () => {
  /* Stated on its own because it is the behaviour that MOVED. Administering
     the people directory and administering the system are different jobs, and
     the console now holds a log that records role changes. */
  const user = { archetype: "people_ops" as const };
  assert.equal(canAccessAdminConsole(user), false);
  assert.equal(canViewAuditLogs(user), false);
  assert.equal(canModifySettings(user), false);
});

test("absent, null and unknown are all refused", () => {
  for (const user of [null, undefined, {}, { archetype: null }]) {
    assert.equal(canAccessAdminConsole(user as never), false);
    assert.equal(canViewAuditLogs(user as never), false);
    assert.equal(canModifySettings(user as never), false);
  }
});

/* ── No second definition ─────────────────────────────────────────────────── */

test("the session gate delegates rather than deciding", () => {
  const src = code("lib/server/session.ts");
  assert.match(src, /return canAccessAdminConsole\(\{ archetype \}\);/);
  assert.equal(
    /archetype === "system_admin" \|\| archetype === "people_ops"/.test(src),
    false,
    "the second definition is back in session.ts",
  );
});

test("nothing infers an administrator from a legacy role", () => {
  /* `legacyRole` is an HR fact. Using it as an authorisation decision was an
     undocumented second door — and a round trip at that: `legacyRole` is
     DERIVED from the archetype by a lossy mapping, so inferring the archetype
     back out of it could only lose information. */
  for (const f of [
    "lib/repositories/legacy/index.ts",
    "lib/server/session.ts",
    "lib/rules/settings/access.ts",
  ]) {
    const src = code(f);
    assert.equal(
      /legacyRole[^\n]*===\s*"ceo"[^\n]*system_admin|system_admin[^\n]*legacyRole/.test(src),
      false,
      `${f} infers an administrator from a legacy role`,
    );
  }
  /* The archetype is carried on the context instead. */
  assert.match(
    code("lib/repositories/legacy/index.ts"),
    /archetype\?: RoleArchetype \| null;/,
  );
  assert.match(
    code("components/features/auth/SessionProvider.tsx"),
    /archetype: data\.archetype,/,
  );
});

test("the settings module re-exports rather than redefining", () => {
  const src = code("lib/rules/settings/access.ts");
  assert.match(src, /from "\.\.\/admin\/access\.ts"/);
  assert.equal(
    /return archetype === /.test(src),
    false,
    "the settings module defines its own answer again",
  );
});

/* ── 5/6/7 · Enforced below the UI ────────────────────────────────────────── */

test("the route gate is a server component and covers every admin page", () => {
  /* One layout wraps `/admin/*`, so settings and audit inherit it. A client
     guard would ship the page, run its queries, then render a refusal over
     data it had already fetched. */
  const src = code("app/admin/layout.tsx");
  assert.match(src, /export default async function AdminLayout/);
  assert.match(src, /if \(!mayOpenConsole\) redirect\("\/home\?denied=admin"\)/);
  assert.equal(src.includes('"use client"'), false);

  /* And every admin page sits under that layout rather than beside it. */
  const pages = readdirSync("app/admin", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.ok(pages.includes("settings"), "settings page missing");
  assert.ok(pages.includes("audit"), "audit page missing");
});

test("the gate resolves the archetype from BOTH sign-in systems", () => {
  /* The bug this pins: the layout asked `currentSession()` alone, which reads the
     `cowork_session` cookie. The Firebase sign-in path — the one every real
     employee uses — never issues that cookie, so the redirect fired for the chief
     executive exactly as it fires for a stranger and `/admin` was unreachable in
     production.

     A regression here does not look like a permission bug. It looks like the
     console being empty for everybody, which is why it needs a test rather than a
     comment. */
  const gate = code("lib/server/adminAuth.ts");
  assert.match(gate, /const session = await currentSession\(\)/);
  assert.match(gate, /jar\.get\(FIREBASE_COOKIE\)/);
  /* The signature, not just the claims. Reading claims alone was the auth bypass
     closed earlier — a forged unsigned token returned 200 on `/team`. */
  assert.match(gate, /await verifyIdToken\(\{ token, projectId \}\)/);
  assert.match(gate, /if \(!verified\.ok\) return null/);
  /* And the role comes from the engine, mapped by the one mapping. */
  assert.match(gate, /await fetchIdentity\(token\)/);
  assert.match(gate, /archetypeForLegacyRole\(identity\.data\.role\)/);

  /* No project id means no way to verify, and an unverifiable token is not a
     signed-in caller. Fails closed, as the middleware does. */
  assert.match(gate, /if \(!projectId\) return null/);

  /* The predicate is still the single definition, not a copy. */
  assert.match(gate, /canAccessAdminConsole\(identity\)/);
  assert.match(gate, /canModifySettings\(identity\)/);
  assert.match(gate, /canViewAuditLogs\(identity\)/);
});

test("the settings subtree has its own gate, on the narrower question", () => {
  /* `canAccessAdminConsole` and `canModifySettings` are provably equal today. The
     seam exists so that a read-only auditor — the obvious next archetype — is one
     predicate change rather than a hunt for every editor. */
  const src = code("app/admin/settings/layout.tsx");
  assert.match(src, /export default async function SettingsLayout/);
  assert.match(src, /if \(!mayModifySettings\) redirect/);
  assert.equal(src.includes('"use client"'), false);
});

test("every settings section has a page, and every page has a section", () => {
  /* A section listed and not built is a dead link in the navigation; a page built
     and not listed is reachable only by URL. The sub-navigation is derived from
     the registry, so this checks the registry against the filesystem. */
  const dirs = readdirSync("app/admin/settings", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const declared = SETTINGS_SECTIONS.map((s) => s.id).sort();
  assert.deepEqual(dirs, declared);

  for (const section of SETTINGS_SECTIONS) {
    assert.equal(
      section.href,
      `/admin/settings/${section.id}`,
      `${section.id} declares an href that does not match its route`,
    );
  }
});

test("non-admin navigation does not offer the console", () => {
  /* Hiding the link is courtesy, not the gate — the server layout is the gate.
     But an entry that leads to a redirect teaches people the product is broken,
     and the default is least privilege so a still-loading session shows nothing. */
  const nav = code("lib/utils/nav.ts");
  /* Sliced to the array literal rather than matched with `[\s\S]*?`, which runs
     straight past the closing bracket and finds `ADMIN_NAV_ITEM` below it — the
     test then fails on the very thing it is supposed to permit. */
  const at = nav.indexOf("navItems: NavItem[] = [");
  assert.ok(at > 0, "navItems not found");
  const everyoneSees = nav.slice(at, nav.indexOf("];", at));
  assert.equal(
    everyoneSees.includes("/admin"),
    false,
    "the admin entry is in the list everybody sees",
  );
  assert.match(nav, /isAdmin = false/);
  assert.match(nav, /return isAdmin \? \[\.\.\.items, ADMIN_NAV_ITEM\] : items/);

  /* And the bar asks the same predicate the route guard asks. */
  const bar = code("components/layout/shell/TopBar.tsx");
  assert.match(bar, /canAccessAdminConsole\(useSession\(\)\)/);
});

test("admin API routes check the session, not a header or a body", () => {
  const dir = "app/api/auth/admin";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = code(join(dir, entry.name, "route.ts"));
    assert.match(
      src,
      /await currentSession\(\)/,
      `${entry.name} does not resolve the session`,
    );
    assert.match(
      src,
      /mayOpenAdmin\(session\.archetype\)/,
      `${entry.name} does not check the archetype`,
    );
  }
});

test("the repository refuses on its own, below any route", () => {
  /* A page is not the only way to call a repository. */
  const src = code("lib/repositories/legacy/index.ts");
  assert.match(src, /if \(!maySettings\(\{ archetype: this\.#ctx\.archetype \?\? null \}\)\)/);
  assert.match(
    src,
    /if \(!mayReadAuditLog\(\{ archetype: this\.#ctx\.archetype \?\? null \}\)\) \{/,
  );
});

test("people_ops no longer lands inside the console", () => {
  /* Sending somebody to a page they will be redirected out of is a loop. */
  const src = code("lib/server/session.ts");
  const at = src.indexOf('case "people_ops":');
  assert.ok(at > 0);
  assert.equal(
    /"\/admin/.test(src.slice(at, at + 200)),
    false,
    "people_ops still lands in the admin console",
  );
});

test("the refusals say which permission is missing", () => {
  for (const m of [ADMIN_REFUSAL, SETTINGS_REFUSAL, AUDIT_REFUSAL]) {
    assert.match(m, /system administrator/);
  }
  /* Three distinct messages: "you cannot open this" and "you cannot change
     this" send a reader to different places. */
  assert.equal(new Set([ADMIN_REFUSAL, SETTINGS_REFUSAL, AUDIT_REFUSAL]).size, 3);
});
