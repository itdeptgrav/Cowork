import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { auditEntry } from "./audit.ts";
import { maySettings, mayReadAuditLog } from "./access.ts";

/**
 * Office settings, audited — and refused to everybody else.
 *
 * `setOfficePolicy` wrote Firestore directly. A change that moves the expected
 * completion of every live task in the company left no record of who made it,
 * from what, or when.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const REPO = "lib/repositories/legacy/index.ts";

const fn = (name: string, file = REPO) => {
  const src = code(file);
  const at = src.indexOf(name);
  assert.ok(at > 0, `${name} not found in ${file}`);
  const nextAt = src.indexOf("\n  async ", at + 10);
  const closeAt = src.indexOf("\n  #", at + 10);
  const end = Math.min(
    nextAt > at ? nextAt : Infinity,
    closeAt > at ? closeAt : Infinity,
  );
  return src.slice(at, Number.isFinite(end) ? end : at + 4000);
};

/* ── 1/2 · The write is audited ───────────────────────────────────────────── */

test("setOfficePolicy goes through the settings service", () => {
  /* The service call moved into `#writeSettingsSection`, which every settings
     setter now delegates to. So the assertion splits: the setter supplies this
     section's identity and validation, and the shared writer supplies the audit.
     Asserting the old inline shape would now be asserting a duplication we
     deliberately removed. */
  const body = fn("async setOfficePolicy(");
  assert.match(body, /this\.#writeSettingsSection<OfficePolicy>\(\{/);
  assert.match(body, /type: OFFICE_POLICY_CHANGED/);
  assert.match(body, /refusal: validateOfficePolicy\(policy\)/);
  /* The OLD value is read before the write, or there is nothing to diff. */
  assert.match(body, /before: await this\.getOfficePolicy\(\)\.catch\(/);

  const writer = fn("async #writeSettingsSection<T>(");
  assert.match(writer, /applySettingsChange<T>\(\{/);
  assert.match(writer, /before: \(input\.before \?\? \{\}\) as T/);
  /* And the entry lands in its own collection. */
  assert.match(writer, /"cowork_settings_audit"/);
});

test("every settings setter goes through the one write path", () => {
  /* The rule the old single-`setDoc` assertion was reaching for, stated
     directly. A new section that wrote its own document would skip the
     permission check, the before-read and the audit in one step — which is
     exactly how `setOfficeHours` came to exist beside `setOfficePolicy`. */
  const setters = [
    "async setOfficePolicy(",
    "async setTaskRules(",
    "async setWorkflowRouting(",
    "async setScoringSettings(",
    "async setRuleOverrides(",
  ];
  for (const setter of setters) {
    assert.match(
      fn(setter),
      /this\.#writeSettingsSection</,
      `${setter} does not delegate to #writeSettingsSection`,
    );
  }
});

test("the entry captures both values for every changed field", () => {
  const e = auditEntry({
    id: "a1",
    section: "office",
    type: "OFFICE_POLICY_CHANGED",
    changedById: "RAKESH",
    changedAt: "2026-07-30T08:10:00.000Z",
    before: { schedule: { monday: { inTime: "09:30", outTime: "18:30" } } },
    after: { schedule: { monday: { inTime: "10:00", outTime: "19:00" } } },
  })!;
  assert.equal(e.type, "OFFICE_POLICY_CHANGED");
  assert.equal(e.changedById, "RAKESH");
  assert.deepEqual(
    e.fields.map((f) => [f.path, f.oldValue, f.newValue]),
    [
      ["schedule.monday.inTime", "09:30", "10:00"],
      ["schedule.monday.outTime", "18:30", "19:00"],
    ],
  );
});

/* ── 3 · A no-op writes nothing ───────────────────────────────────────────── */

test("saving an unchanged policy creates no entry", () => {
  const same = { schedule: { monday: { inTime: "09:30" } } };
  assert.equal(
    auditEntry({
      id: "a1",
      section: "office",
      changedById: "RAKESH",
      changedAt: "2026-07-30T08:10:00.000Z",
      before: same,
      after: { ...same },
    }),
    null,
  );
});

/* ── 4/5 · Permission ─────────────────────────────────────────────────────── */

test("only a system administrator may change settings or read the log", () => {
  for (const who of ["employee", "manager", "people_ops", "skip_level"] as const) {
    assert.equal(maySettings({ archetype: who }), false, `${who} may change settings`);
    assert.equal(
      mayReadAuditLog({ archetype: who }),
      false,
      `${who} may read the audit log`,
    );
  }
  assert.equal(maySettings({ archetype: "system_admin" }), true);
  assert.equal(mayReadAuditLog({ archetype: "system_admin" }), true);
  /* Absent is not permitted. */
  assert.equal(maySettings(null), false);
  assert.equal(mayReadAuditLog(undefined), false);
  assert.equal(maySettings({ archetype: null }), false);
});

test("the repository refuses, not only the route", () => {
  /* A guard decides who may open a page. A page is not the only way to call a
     repository. The check lives in the shared writer, which is what makes it
     impossible for a new section to be added without it. */
  const write = fn("async #writeSettingsSection<T>(");
  assert.match(
    write,
    /if \(!maySettings\(\{ archetype: this\.#ctx\.archetype \?\? null \}\)\) \{/,
  );
  assert.match(write, /code: "permission_denied", message: SETTINGS_REFUSAL/);

  const read = fn("async listSettingsAudit(");
  assert.match(
    read,
    /if \(!mayReadAuditLog\(\{ archetype: this\.#ctx\.archetype \?\? null \}\)\) \{/,
  );
  /* The fixture applies the same gate — one that let everybody read would hide
     the bug the gate exists to prevent. */
  assert.match(
    fn("async listSettingsAudit(", "lib/repositories/mock/index.ts"),
    /if \(!isAdmin\) throw new Error\(AUDIT_REFUSAL\)/,
  );
});

test("a refusal is not rendered as an empty log", () => {
  /* "Nothing has changed" and "you may not see what changed" are different
     facts and must not look the same. */
  const src = code("components/features/admin/AuditLog.tsx");
  assert.match(src, /if \(log\.error\)/);
  assert.match(src, /Audit log unavailable/);
});

/* ── 6 · Deadline impact ──────────────────────────────────────────────────── */

test("deadline-moving changes are flagged on the record", () => {
  const flagged = (before: unknown, after: unknown) =>
    auditEntry({
      id: "a1",
      section: "office",
      changedById: "R",
      changedAt: "2026-07-30T08:10:00.000Z",
      before,
      after,
    })?.affectsDeadlines;

  assert.equal(flagged({ schedule: { monday: { inTime: "09:30" } } }, { schedule: { monday: { inTime: "10:00" } } }), true);
  assert.equal(flagged({ holidays: [] }, { holidays: ["2026-08-15"] }), true);
  assert.equal(flagged({ breaks: [] }, { breaks: [{ name: "Lunch" }] }), true);
  /* Stored, not derived at read time: the paths that feed the chain can change,
     and a row must keep saying what it meant when it was written. */
  assert.equal(flagged({ companyName: "a" }, { companyName: "b" }), false);
});

test("the flag reaches the row a reader scans", () => {
  const src = code("components/features/admin/AuditLog.tsx");
  assert.match(src, /entry\.affectsDeadlines &&/);
  assert.match(src, /Active deadlines recalculated/);
  /* And the detail says what was and was not recalculated. The committed date
     does not move; the operational one does. Warning without that distinction
     makes an administrator afraid of a correct edit. */
  assert.match(src, /Committed dates were not/);
});

test("the log renders who, what, when, before, after and impact", () => {
  /* The six things the record has to answer. Asserted on the rendered labels
     rather than on the entry shape, because an entry that holds a before-value
     nothing displays is a log that cannot answer "what did it used to be". */
  const src = code("components/features/admin/AuditLog.tsx");
  for (const label of ["Who", "When", "What changed", "Impact"]) {
    assert.match(
      src,
      new RegExp(`>\\s*${label}\\s*<`),
      `the audit detail does not render a ${label} row`,
    );
  }
  assert.match(src, /show\(field\.oldValue\)/);
  assert.match(src, /show\(field\.newValue\)/);
  /* The actor's NAME, resolved from the id the record stores. Names change and
     ids do not, which is why the row shows both. */
  assert.match(src, /actorName \?\? \(entry\.changedById \|\| "Somebody"\)/);
});

/* ── 7 · The engine still reads the policy ────────────────────────────────── */

test("the deadline chain still reads the office policy it always did", () => {
  /* Wiring the write through the audit service must not change the READ path —
     the chain, the preview and the operational date all call `getOfficePolicy`
     and would otherwise plan against a stale calendar. */
  const chain = fn("async #chainQueue(");
  assert.match(chain, /this\.getOfficePolicy\(\)/);
  assert.match(chain, /policy\.schedule, blocked, policy\.breaks/);

  const preview = fn("async previewDeadlineFeasibility(");
  assert.match(preview, /this\.getOfficePolicy\(\)/);
});

test("nothing writes a settings document outside the service", () => {
  /* READS are unrestricted and there are several — the chain, the preview and
     the review route all need the calendar. What must be unique is the WRITE: a
     second `setDoc`/`updateDoc` on a settings document would be a path that
     skips the audit entirely.

     Now that the collection and id are parameters, the check is on the
     COLLECTION NAMES rather than on one literal document path. Both are settings
     stores the engine reads, and neither may be written from anywhere but the
     shared writer. */
  const src = code(REPO);
  for (const collection of ["cowork_settings", "cowork_sop_settings"]) {
    const writes = (
      src.match(
        new RegExp(`(setDoc|updateDoc)\\(\\s*doc\\([\\s\\S]{0,60}?"${collection}"`, "g"),
      ) ?? []
    ).length;
    assert.equal(
      writes,
      0,
      `${collection} is written from ${writes} place(s) with a literal path — every settings write must go through #writeSettingsSection`,
    );
  }

  const writer = fn("async #writeSettingsSection<T>(");
  /* Exactly one `setDoc` in the shared writer, and it takes its path from the
     caller rather than naming one. */
  assert.equal((writer.match(/setDoc\(/g) ?? []).length, 1);
  assert.match(writer, /const \[collectionName, documentId\] = input\.path/);
  assert.match(writer, /doc\(legacyDb\(\), collectionName, documentId\)/);

  assert.match(writer, /write: async \(value\) => \{/);
  /* And that one write is inside the service's callback, not beside it. */
  const at = writer.indexOf("applySettingsChange");
  assert.ok(
    writer.indexOf("setDoc(") > at,
    "the settings document is written before the service is entered",
  );
});

test("the OfficeHours bypass is gone, not repointed", () => {
  /* `OfficeSettings.tsx` was the unaudited second writer of the office document.
     It is deleted rather than pointed at `setOfficePolicy`, because the domain's
     `OfficeHours` models ONE start and end for the week while the engine's
     schedule is per-day — mapping through it would silently discard the Saturday
     hours that deadlines are computed from.

     Asserted as an absence so nobody restores it from git history without
     reading why it went. */
  assert.throws(
    () => readFileSync("components/features/admin/OfficeSettings.tsx", "utf8"),
    /ENOENT/,
    "OfficeSettings.tsx is back — it bypasses the audited write path",
  );
  const shell = code("components/features/admin/sections/OfficePolicySection.tsx");
  assert.match(shell, /r\.setOfficePolicy\(next, reason \|\| undefined\)/);
  assert.doesNotMatch(shell, /setOfficeHours/);
});
