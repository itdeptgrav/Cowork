import { Suspense } from "react";
import { WorkspaceArea } from "@/components/features/workspace/WorkspaceArea";
export const metadata = { title: "Workspace — Cowork" };
/**
 * `useSearchParams` (read in `WorkspaceArea`, for the `?doc=`/`?reportTaskId=`
 * deep link from a daily report's "Open in Docs" link) needs a Suspense
 * boundary or the route opts out of static rendering with a build-time
 * warning. Fallback is the bare frame, matching `app/signin/page.tsx` — this
 * page resolves in milliseconds and a spinner would just flash.
 */
export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <WorkspaceArea />
    </Suspense>
  );
}
