import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { readOfficePolicy, writeOfficePolicy } from "../../legacy/officePolicy.ts";
import {
  declareOnline,
  getSnapshot,
  reportShare,
  resetStatus,
} from "../../status/employeeStatus.ts";

/**
 * **The switch that decides what Online MEANS — OWNER FEATURE.**
 *
 * On, which is the default and the product's own position: Online is a
 * consequence of a live whole-screen share, and nothing anybody types asserts
 * it. Off: presence is an ordinary declaration, nothing is captured and nobody
 * is watched.
 *
 * The second is not a weaker version of the first, and the danger in building it
 * is that half the product keeps promising the first. These pin the parts that
 * would produce that: the default, the lock on declaring online, and the four
 * surfaces that have to follow the same value.
 */

test("a workspace that has never opened the page still requires a screen", () => {
  /* Absent means TRUE. Defaulting the other way would quietly drop the
     requirement for every existing workspace on the first read — a monitoring
     feature switching itself off is not a thing a missing field may do. */
  assert.equal(readOfficePolicy(null).requireScreenShare, true);
  assert.equal(readOfficePolicy({}).requireScreenShare, true);
  assert.equal(
    readOfficePolicy({ requireScreenShare: false }).requireScreenShare,
    false,
  );
  /* Only an explicit false counts — a truthy string or a stray null is not a
     decision anybody made. */
  assert.equal(
    readOfficePolicy({ requireScreenShare: null }).requireScreenShare,
    true,
  );
});

test("the decision survives a save", () => {
  /* A field the editor can set and the writer drops is the worst shape: the
     toggle moves, the card says off, and every client keeps asking for
     screens. */
  const policy = { ...readOfficePolicy(null), requireScreenShare: false };
  const doc = writeOfficePolicy(policy, "admin");
  assert.equal(doc.requireScreenShare, false);
  assert.equal(readOfficePolicy(doc).requireScreenShare, false);
});

test("online cannot be declared while the workspace requires a screen", () => {
  /**
   * `goOnline` was deleted for a reason that still holds wherever the promise
   * is a watchable screen: while it existed, presence was self-declared and a
   * manager who opened somebody's screen found nothing there. `declareOnline`
   * is that function back, and the policy is the lock — a caller cannot reach
   * it without passing the value it checks.
   */
  resetStatus();
  assert.equal(declareOnline({ requireScreenShare: true }), false);
  assert.equal(getSnapshot().status, "offline");

  assert.equal(declareOnline({ requireScreenShare: false }), true);
  assert.equal(getSnapshot().status, "online");
});

test("a live share still outranks a declaration", () => {
  /* Switching the requirement off does not turn the share off. Somebody already
     sharing when the switch flips keeps sharing, and the pill keeps saying so. */
  resetStatus();
  declareOnline({ requireScreenShare: false });
  reportShare({
    sharing: true,
    connected: true,
    surface: "entire_screen",
    detail: "Sharing your entire screen.",
  });
  assert.equal(getSnapshot().status, "online");
  assert.equal(getSnapshot().share.sharing, true);
});

test("every surface reads the one switch", () => {
  /**
   * Four places have to agree about what Online means, and the failure mode of
   * getting it wrong is a person told they are online while their manager's
   * panel reports them as not sharing. One hook, one policy field.
   */
  const button = readFileSync(
    "components/features/status/StatusButton.tsx",
    "utf8",
  );
  /* The press does not ask for a screen, and does not warm a room it will never
     use. */
  assert.match(button, /if \(!screenRequired\) \{[\s\S]{0,400}declareOnline\(\{ requireScreenShare: false \}\)/);
  assert.match(button, /if \(!open \|\| !viewerId \|\| !screenRequired\) return;/);
  assert.match(button, /if \(!viewerId \|\| !screenRequired\) return;/);
  /* And nobody is warned about a share they were never asked for. */
  assert.match(button, /screenRequired &&\s*!shareLostDismissed/);

  const room = readFileSync(
    "components/features/monitoring/MonitorRoom.tsx",
    "utf8",
  );
  /* No seat is minted and no room is polled for a workspace that watches
     nothing — that would be a request per manager per page for a picture
     nobody is producing. */
  assert.match(room, /if \(!subjectId \|\| !screenRequired\) return;/);
  assert.match(room, /screenSharingOff: !screenRequired,/);

  const viewer = readFileSync(
    "components/features/monitoring/LiveScreenViewer.tsx",
    "utf8",
  );
  /* And the panel says it is switched off rather than reporting somebody as not
     sharing, which is a person to chase rather than a setting. */
  assert.match(viewer, /Screen sharing is switched off/);

  for (const path of [
    "components/features/status/StatusButton.tsx",
    "components/features/monitoring/MonitorRoom.tsx",
  ])
    assert.match(
      readFileSync(path, "utf8"),
      /useScreenShareRequired\(\)/,
      `${path} decides for itself what Online means`,
    );
});
