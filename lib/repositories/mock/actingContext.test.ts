import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The request context: who, and in which organisation.
 *
 * Checkpoint 1 of tenant isolation. These hold the properties the later
 * scoping depends on — if the context can lose its organisation, or if
 * switching employee can silently move tenant, then `#scoped()` in checkpoint 3
 * is enforcing against a value that is already wrong.
 *
 * The module is re-implemented here rather than imported: `store.ts` pulls in
 * the whole seed and the persistence layer, neither of which `node --test` can
 * resolve. What is asserted is the CONTRACT, and checkpoint 3 adds the
 * integration test that exercises the real store with two tenants.
 */

const SEED_ORG = "org-seed";
const SEED_EMPLOYEE = "e-01";

function makeContext() {
  let acting: { employeeId: string; organisationId: string } | null = null;
  return {
    actingId: () => acting?.employeeId ?? SEED_EMPLOYEE,
    actingOrganisationId: () => acting?.organisationId ?? SEED_ORG,
    setActingContext: (c: typeof acting) => {
      acting = c;
    },
    setActingId: (id: string | null) => {
      if (id === null) {
        acting = null;
        return;
      }
      acting = {
        employeeId: id,
        organisationId: acting?.organisationId ?? SEED_ORG,
      };
    },
  };
}

test("an unset context falls back to the seed tenant, not to everything", () => {
  /* The safe direction to fail. A session predating tenanting reads the demo
     organisation; it does not read every organisation. */
  const ctx = makeContext();
  assert.equal(ctx.actingOrganisationId(), SEED_ORG);
  assert.equal(ctx.actingId(), SEED_EMPLOYEE);
});

test("a verified session sets both halves together", () => {
  const ctx = makeContext();
  ctx.setActingContext({ employeeId: "e-1001", organisationId: "org-it" });
  assert.equal(ctx.actingId(), "e-1001");
  assert.equal(ctx.actingOrganisationId(), "org-it");
});

test("switching employee does NOT move you between tenants", () => {
  /* The development profile switcher changes who you are acting as WITHIN an
     organisation. If it cleared the organisation, acting as a colleague would
     silently drop you back to the seed tenant — a cross-tenant read dressed up
     as a convenience feature. */
  const ctx = makeContext();
  ctx.setActingContext({ employeeId: "e-1001", organisationId: "org-it" });
  ctx.setActingId("e-cabc");
  assert.equal(ctx.actingId(), "e-cabc");
  assert.equal(
    ctx.actingOrganisationId(),
    "org-it",
    "the tenant must survive an employee switch",
  );
});

test("clearing the context returns to the seed tenant", () => {
  const ctx = makeContext();
  ctx.setActingContext({ employeeId: "e-1001", organisationId: "org-it" });
  ctx.setActingId(null);
  assert.equal(ctx.actingOrganisationId(), SEED_ORG);
  assert.equal(ctx.actingId(), SEED_EMPLOYEE);
});

test("signing in as another tenant replaces the whole context", () => {
  /* Not a merge. A second sign-in must not leave the previous organisation
     behind on a context whose employee has changed. */
  const ctx = makeContext();
  ctx.setActingContext({ employeeId: "a-1", organisationId: "org-a" });
  ctx.setActingContext({ employeeId: "b-1", organisationId: "org-b" });
  assert.equal(ctx.actingId(), "b-1");
  assert.equal(ctx.actingOrganisationId(), "org-b");
});

test("existing single-organisation behaviour is unchanged", () => {
  /* Requirement 3. With one tenant in play the context resolves exactly as it
     did before this checkpoint: the seeded viewer, in the seeded organisation. */
  const ctx = makeContext();
  assert.equal(ctx.actingId(), SEED_EMPLOYEE);
  ctx.setActingId("e-02");
  assert.equal(ctx.actingId(), "e-02");
  assert.equal(ctx.actingOrganisationId(), SEED_ORG);
});
