import { SETTINGS_SECTIONS } from "@/lib/rules/settings/sections";

/**
 * The administration console's navigation, in two levels.
 *
 * **Three top-level areas, not ten.** It was a flat strip of eight peers —
 * Organisation, Workflows, People, Roles, Scoring rules, Provisional rules,
 * Settings, Audit log — which put "the whole approval model" and "one editor for
 * one document" at the same weight, and gave the console no shape a person could
 * hold in their head. Configuration is now one area with its own sub-navigation,
 * and the top level answers a coarser question: what is the state of things
 * (Overview), how does the system behave (Settings), and what has been changed
 * (Audit log).
 *
 * **Visibility is not what protects these routes.** `app/admin/layout.tsx`
 * refuses the route server-side from the archetype resolved across both sign-in
 * systems, before any of this renders, and `AdminCapabilityGuard` refuses again
 * from the capability. This list only decides what an administrator who is
 * already through both sees.
 */
export const ADMIN_TABS = [
  {
    id: "overview",
    label: "Overview",
    href: "/admin",
    icon: "overview" as const,
  },
  {
    id: "settings",
    label: "Settings",
    href: "/admin/settings",
    icon: "settings" as const,
  },
  {
    id: "audit",
    label: "Audit log",
    href: "/admin/audit",
    icon: "history" as const,
  },
];

/**
 * The Settings sub-navigation, derived from the section registry.
 *
 * Derived rather than restated. A second list is how a section ends up reachable
 * by URL and invisible in the navigation — or worse, listed and not built.
 */
export const SETTINGS_TABS = SETTINGS_SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
  href: section.href,
}));

/**
 * The people and roles surfaces, which are NOT settings.
 *
 * Kept out of the Settings strip on purpose: neither configures how the system
 * behaves. People is a directory of records Cowork reads from HR, and Roles
 * explains an authorisation model this product cannot edit — legacy stores a role
 * as one of three words on an employee, not a record with permissions, so real
 * role editing needs a new store rather than wiring.
 *
 * They are linked from Overview instead, where "what exists" belongs.
 */
export const ADMIN_REFERENCE_PAGES = [
  {
    id: "people",
    label: "People",
    href: "/admin/people",
    summary: "Everybody in the workspace, their department and who they report to.",
  },
  {
    id: "roles",
    label: "Roles and permissions",
    href: "/admin/roles",
    summary:
      "Which capabilities each role holds, and at what scope. Read-only — the engine stores no role record to edit.",
  },
];
