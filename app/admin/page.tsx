import { AdminOverview } from "@/components/features/admin/AdminOverview";

/**
 * `/admin`.
 *
 * This route had no page. The layout's guard ran and then rendered nothing, so
 * the console's own root was a dead URL — which is also why `landingFor` sent
 * administrators to `/admin/organisation` rather than here.
 *
 * Protected by `app/admin/layout.tsx` and nothing in this file: that layout is a
 * server component which resolves the archetype across both sign-in systems and
 * refuses the route before a byte reaches the browser. A check here would be a
 * third copy of a decision already made twice, and the weakest of the three.
 */
export const metadata = { title: "Administration — Cowork" };

export default function Page() {
  return <AdminOverview />;
}
