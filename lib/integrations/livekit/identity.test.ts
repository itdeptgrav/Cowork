import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MANAGER_IDENTITY,
  isPresenceIdentity,
  presenceIdentityFor,
} from "./identity.ts";

/**
 * The rule both halves of the monitoring room have to agree on.
 *
 * These tests exist because of a real failure, not as coverage: the publisher
 * joined under a fixed `"employee"` string while the viewer looked for
 * `presenceIdentityFor(employeeId)`, and a lookup table mapped exactly one
 * seeded employee onto that fixed string. The result was that a manager saw
 * nothing for anyone else, and saw whoever WAS publishing under that one
 * person's name.
 *
 * What is asserted here is the property that failure violated: distinct
 * employees get distinct identities, and the publishing seat is
 * distinguishable from the watching seat. Both halves import this module, so
 * they cannot drift apart again without one of these failing.
 */

test("each employee gets a distinct publishing identity", () => {
  const ids = ["e-01", "e-02", "e-09", "e-cabc331c3ba8"];
  const identities = ids.map(presenceIdentityFor);
  assert.equal(
    new Set(identities).size,
    ids.length,
    "two employees sharing one identity is how one person's screen ends up under another person's name",
  );
});

test("the identity is derived from the id, with no special cases", () => {
  /* The removed table gave `e-02` a different shape from everyone else. A
     derivation with an exception in it is two rules wearing one name. */
  assert.equal(presenceIdentityFor("e-01"), "employee-e-01");
  assert.equal(presenceIdentityFor("e-02"), "employee-e-02");
});

test("a publishing identity is recognised as one", () => {
  assert.ok(isPresenceIdentity(presenceIdentityFor("e-01")));
});

test("the manager seat is never mistaken for a publisher", () => {
  /* The token route decides `canPublish` from this. If the watching identity
     were classified as a publisher, a viewer could push a track into the room
     under a name of their choosing. */
  assert.equal(isPresenceIdentity(MANAGER_IDENTITY), false);
});

test("the bare prefix is not a publishing identity", () => {
  /* `employee-` with nothing after it would grant publish rights to a seat
     belonging to no employee, and would collide with itself across callers. */
  assert.equal(isPresenceIdentity("employee-"), false);
  assert.equal(isPresenceIdentity("employee"), false);
  assert.equal(isPresenceIdentity(""), false);
});
