import { redirect } from "next/navigation";

/**
 * `/admin/scoring-rules` → `/admin/settings/priority-scoring`.
 *
 * The versioned rule editor here was **mock-only** — `listScoringRules`,
 * `updateScoringRule`, `listRuleVersions`, `publishRuleVersion` and the rest are
 * absent from `LegacyRepository` — so against the real engine it could not load,
 * let alone publish a version.
 *
 * The values that DO reach a published score live in
 * `cowork_sop_settings/task_events`, which the Express engine reads in seven
 * places. That is the section this points at. The unresolved owner decisions the
 * old page also listed are in Provisional rules, where they can now be published
 * durably.
 */
export default function Page() {
  redirect("/admin/settings/priority-scoring");
}
