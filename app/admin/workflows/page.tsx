import { redirect } from "next/navigation";

/**
 * `/admin/workflows` → `/admin/settings/workflow-routing`.
 *
 * The stage-based `WorkflowEditor` this route rendered is **mock-only**:
 * `listWorkflows`, `createWorkflow`, `setWorkflowStages`, `previewWorkflow` and
 * `deleteWorkflow` are all absent from `LegacyRepository`, so against the real
 * engine the page rendered, invited edits, and threw `NotConnectedError` on save.
 *
 * Redirected rather than deleted because the URL is in `landingFor`'s history and
 * in people's bookmarks, and redirected rather than left because a panel that
 * cannot save is worse than no panel. The routing that the engine DOES enforce —
 * who decides an extension, and what happens when nobody is named — is the
 * section this points at.
 */
export default function Page() {
  redirect("/admin/settings/workflow-routing");
}
