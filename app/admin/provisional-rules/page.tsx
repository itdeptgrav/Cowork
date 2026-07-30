import { redirect } from "next/navigation";

/**
 * `/admin/provisional-rules` → `/admin/settings/provisional-rules`.
 *
 * A straight move into the Settings subtree. The old page mixed two different
 * things under one heading: office policy, which both applications read, and the
 * unresolved placeholder rules, which only this one does. They are now separate
 * sections, because a single Save button over both meant a change to the working
 * week and a change to a placeholder carried the same weight.
 */
export default function Page() {
  redirect("/admin/settings/provisional-rules");
}
