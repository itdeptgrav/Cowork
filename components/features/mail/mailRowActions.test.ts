import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { inFolder } from "@/lib/repositories/legacy/mail";
import type { MailMessage } from "@/lib/domain";

/**
 * Archive and Delete, on the row, without opening the message.
 *
 * Hovering a row swaps the date on its right for two buttons:
 *
 *   · **Archive** — out of the Inbox. Not deleted, not spam; dealt with.
 *   · **Delete** — into Trash, the same place the thread view's own control
 *     sends it.
 *
 * ## Gmail is not touched, and cannot be
 *
 * The connection holds `gmail.send` and `gmail.readonly`. A read-only scope
 * cannot remove an INBOX label or trash a message, so both actions are
 * Cowork's own view of the mailbox and the copy in Gmail stays exactly where
 * it is. The decision was the owner's, and it is the honest reading of
 * "removes it from Inbox, but keeps the email in Gmail". Anything else would
 * need `gmail.modify` — a Google restricted scope, so every connected person
 * would have to reconnect and the app would need a security review.
 *
 * ## Archived mail has somewhere to live
 *
 * `archivedBy` sat on the message since the mailbox was built and nothing ever
 * read it. Reading it is only half the feature: search is scoped to the folder
 * being viewed and Cowork has no "All mail", so an archived message with no
 * folder of its own would be gone from every view in the product with no way
 * back. That is a one-way door, so Archived is a real folder.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const AREA = code("components/features/mail/MailArea.tsx");
const PURE = code("lib/repositories/legacy/mail.ts");
const MOCK = code("lib/repositories/mock/index.ts");
const FLAGS = code("lib/rules/mail/flags.ts");
const DOMAIN = code("lib/domain/mail.ts");

/* ── the flag ────────────────────────────────────────────────────────────── */

test("archived is a flag like the others, mapped to the field that already existed", () => {
  assert.match(FLAGS, /\| "archived"/);
  assert.match(FLAGS, /\| "archivedBy"/);
  assert.match(FLAGS, /archived: "archivedBy",/);
  /* One table, imported by both backends, so the flag cannot map to two
     different fields between the mock and the real store. */
  assert.match(FLAGS, /satisfies Record<MailFlag, MailFlagField>/);
});

test("both backends accept it, and the array writer knows the field", () => {
  for (const [name, src] of [
    ["types", code("lib/repositories/types.ts")],
    ["legacy", code("lib/repositories/legacy/index.ts")],
    ["mock", MOCK],
  ] as const) {
    assert.match(
      src,
      /flag: "starred" \| "trashed" \| "spam" \| "important" \| "archived",/,
      `${name} does not accept the archived flag`,
    );
  }
  assert.match(
    code("lib/repositories/legacy/index.ts"),
    /\| "archivedBy",/,
    "the per-person array writer refuses the field",
  );
});

/* ── the folder ──────────────────────────────────────────────────────────── */

test("Archived is a real folder, so archiving is not a one-way door", () => {
  assert.match(DOMAIN, /\| "archived"/);
  assert.match(AREA, /\{ id: "archived", label: "Archived", icon: "archive" \}/);
});

test("both inFolder implementations bucket Archived identically", () => {
  /* The two backends drifting on where a message lives is the fault this
     shared shape exists to prevent — the same rule Spam and Trash follow. */
  for (const src of [PURE, MOCK]) {
    assert.match(src, /const archived = m\.archivedBy\.includes\(me\)/);
    assert.match(
      src,
      /if \(folder === "archived"\) return archived && m\.from\.employeeId !== me/,
    );
    assert.match(src, /if \(archived\) return false/);
  }
});

test("archiving takes it out of the Inbox and nothing else", () => {
  /**
   * Ordering, and it is the whole rule. The archived check sits BELOW Sent and
   * Drafts, so a message you archived still appears in Sent if you sent it —
   * archive means "I have dealt with this", not "hide it everywhere". Trash
   * and Spam return above it and outrank it: a message archived and then
   * deleted is in Trash, because that is what deleting means.
   */
  for (const src of [PURE, MOCK]) {
    const sent = src.indexOf('if (folder === "sent")');
    const archived = src.indexOf("const archived = m.archivedBy.includes(me)");
    const trash = src.indexOf('if (folder === "trash")');
    const spam = src.indexOf('if (folder === "spam")');
    assert.ok(trash < archived, "Trash no longer outranks Archived");
    assert.ok(spam < archived, "Spam no longer outranks Archived");
    assert.ok(sent < archived, "archiving now hides a message from Sent too");
  }
});

/* ── the behaviour itself, not the source text ──────────────────────────── */

/**
 * `inFolder` run for real, because the assertions above only prove the code
 * READS a certain way. These prove it ANSWERS correctly — which is the claim
 * the feature actually rests on.
 */
const ME = "E1";
function message(over: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "m1",
    threadId: "t1",
    transport: "internal",
    from: { kind: "employee", address: "other@grav.in", displayName: "Other", employeeId: "E2" },
    to: [{ kind: "employee", address: "me@grav.in", displayName: "Me", employeeId: ME }],
    cc: [],
    bcc: [],
    subject: "Hello",
    body: "",
    attachmentIds: [],
    readBy: [],
    starredBy: [],
    trashedBy: [],
    archivedBy: [],
    spamBy: [],
    importantBy: [],
    labels: [],
    sentAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    gmailMessageId: null,
    deliveryError: null,
    ...over,
  } as MailMessage;
}

test("an ordinary received message is in the Inbox and nowhere else", () => {
  const m = message();
  assert.equal(inFolder(m, ME, "inbox"), true);
  assert.equal(inFolder(m, ME, "archived"), false);
  assert.equal(inFolder(m, ME, "trash"), false);
});

test("archiving it leaves the Inbox and lands in Archived", () => {
  const m = message({ archivedBy: [ME] });
  assert.equal(inFolder(m, ME, "inbox"), false, "archiving did not clear the Inbox");
  assert.equal(inFolder(m, ME, "archived"), true, "it is not recoverable");
});

test("it is archived for ME alone", () => {
  /* Per-person, like every other mail flag: a colleague on the same thread
     still has it in their Inbox. */
  const m = message({ archivedBy: [ME] });
  assert.equal(inFolder(m, "E9", "inbox"), true);
  assert.equal(inFolder(m, "E9", "archived"), false);
});

test("deleting outranks archiving", () => {
  /* Archive then delete: it is in Trash, because that is what deleting means.
     It must not sit in both, or a person clearing Archived would find things
     they had already thrown away. */
  const m = message({ archivedBy: [ME], trashedBy: [ME] });
  assert.equal(inFolder(m, ME, "trash"), true);
  assert.equal(inFolder(m, ME, "archived"), false);
  assert.equal(inFolder(m, ME, "inbox"), false);
});

test("archiving something you SENT does not remove it from Sent", () => {
  /* The ordering rule, exercised: archive means "dealt with", not "hide it
     from me everywhere". */
  const mine = message({
    from: { kind: "employee", address: "me@grav.in", displayName: "Me", employeeId: ME },
    to: [{ kind: "employee", address: "other@grav.in", displayName: "Other", employeeId: "E2" }],
    archivedBy: [ME],
  });
  assert.equal(inFolder(mine, ME, "sent"), true, "archiving emptied Sent");
  assert.equal(inFolder(mine, ME, "archived"), false, "a sent message showed up in Archived");
});

test("a draft is untouched by archiving", () => {
  const draft = message({
    from: { kind: "employee", address: "me@grav.in", displayName: "Me", employeeId: ME },
    sentAt: null,
    archivedBy: [ME],
  });
  assert.equal(inFolder(draft, ME, "drafts"), true);
});

test("spam that was archived is still spam", () => {
  const m = message({ spamBy: [ME], archivedBy: [ME] });
  assert.equal(inFolder(m, ME, "spam"), true);
  assert.equal(inFolder(m, ME, "archived"), false);
});

/* ── the row ─────────────────────────────────────────────────────────────── */

test("the date makes way for the two actions on hover", () => {
  assert.match(AREA, /group-hover:opacity-0/, "the date does not step aside");
  assert.match(AREA, /group-hover:opacity-100/);
  assert.match(AREA, /<li className=\{hasActions \? "group relative" : undefined\}>/);
});

test("the actions are reachable by keyboard, and do not swallow clicks", () => {
  /**
   * `opacity-0`, never `hidden`: a `display: none` element cannot be focused,
   * so Tab would skip the only route to these for anybody not using a mouse.
   * `focus-within` reveals them the moment Tab arrives. `pointer-events-none`
   * stops the invisible cluster intercepting a click meant to open the row.
   */
  assert.match(AREA, /focus-within:opacity-100/);
  assert.match(AREA, /pointer-events-none/);
  assert.match(AREA, /focus-within:pointer-events-auto/);
  assert.match(AREA, /group-hover:pointer-events-auto/);
  assert.doesNotMatch(
    AREA,
    /hidden group-hover:flex/,
    "a display:none cluster cannot be tabbed to",
  );
});

test("pressing one files the message rather than opening it", () => {
  /* The classic way this control goes wrong: the click bubbles to the row and
     opens the very conversation it was meant to file away. */
  const action = AREA.slice(AREA.indexOf("function RowAction("));
  assert.match(action.slice(0, 1400), /e\.stopPropagation\(\);\s*onClick\(\);/);
});

test("the buttons are named for a screen reader, not just drawn", () => {
  /* The name carries the SUBJECT, so "Archive" heard on its own out of a list
     of twenty rows still says which message it would file. */
  assert.match(AREA, /label=\{`Archive: \$\{thread\.subject \|\| "\(no subject\)"\}`\}/);
  assert.match(AREA, /label=\{`Delete: \$\{thread\.subject \|\| "\(no subject\)"\}`\}/);
  assert.match(AREA, /aria-label=\{label\}/, "the name never reaches the button");
  /* And the tooltip says what each actually does, because "Archive" alone
     does not tell somebody whether their Gmail is about to change. */
  assert.match(AREA, /title="Archive — out of the Inbox, still in Gmail"/);
  assert.match(AREA, /title="Delete — moves it to Trash"/);
});

test("a row being worked on cannot be double-fired", () => {
  /* An id rather than a boolean, so one row's request does not freeze the
     whole list. */
  assert.match(AREA, /const \[busyRow, setBusyRow\] = useState<string \| null>\(null\)/);
  assert.match(AREA, /if \(busyRow\) return;/);
  assert.match(AREA, /busy=\{busyRow === t\.id\}/);
  assert.match(AREA, /disabled=\{busy\}/);
});

/* ── where each action is offered ───────────────────────────────────────── */

test("Archive is offered only where there is an Inbox to leave", () => {
  assert.match(
    AREA,
    /folder === "inbox"\s*\? \(\) => void flagThread\(t, "archived"\)\s*: undefined/,
  );
});

test("Delete is offered everywhere except Trash", () => {
  /* In Trash the only remaining step would be deleting for ever, which this
     mailbox does not do — so the control would be a lie. */
  assert.match(
    AREA,
    /folder === "trash"\s*\? undefined\s*: \(\) => void flagThread\(t, "trashed"\)/,
  );
});

/* ── the action itself ──────────────────────────────────────────────────── */

test("a row action moves the whole conversation, like the thread view's does", () => {
  const fn = AREA.slice(AREA.indexOf("async function flagThread("));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /const msgs = await repo\.listMailMessages\(t\.id\)/);
  assert.match(body, /for \(const m of msgs\) await repo\.setMailFlag\(m\.id, flag, true\)/);
  /* The same per-message loop `MailThreadView` runs, so the two routes to the
     same action cannot drift. */
  assert.match(
    code("components/features/mail/MailThreadView.tsx"),
    /for \(const m of list\) await repo\.setMailFlag\(m\.id, "trashed", on\)/,
  );
});

test("the list and the unread count both refresh afterwards", () => {
  /* The row leaves the Inbox whether or not it had been read. */
  const fn = AREA.slice(AREA.indexOf("async function flagThread("));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /threads\.refetch\(\);\s*unread\.refetch\(\);/);
});

/* ── Gmail is untouched ─────────────────────────────────────────────────── */

test("neither action asks Gmail to change anything", () => {
  /* It could not comply: the scopes are send and readonly. Pinned so adding a
     write here has to face the scope question first. */
  const scopes = code("lib/integrations/mail/gmail/gmailAuth.ts");
  assert.match(scopes, /"https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly"/);
  assert.doesNotMatch(
    scopes,
    /gmail\.modify|mail\.google\.com/,
    "a write scope was added — Archive and Delete can now change Gmail, so say so in the UI and the help",
  );
});

/* ── the help corpus, per CLAUDE.md ─────────────────────────────────────── */

test("help: the two row actions are described, and what they do not do", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /Archive\*\* takes it out of the Inbox/);
  assert.match(help, /Nothing changes in Gmail itself/);
  assert.match(help, /"archive an email"/);
  /* The recovery route, because an archive nobody can undo is a trap. */
  assert.match(help, /Archived mail goes to the Archived folder/);
});
