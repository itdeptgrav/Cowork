import { MonitoringArea } from "@/components/features/monitoring/MonitoringArea";

export const metadata = { title: "Monitoring — Cowork" };

/**
 * The manager's monitoring surface.
 *
 * This route used to be the raw LiveKit test page — a Connect button and an
 * unstyled `<video>`. The realtime plumbing underneath is unchanged: the same
 * token route, the same room, the same `useTracks` on the screen-share source.
 * What replaced the test page is everything around it.
 */
export default function ManagerPage() {
  return <MonitoringArea />;
}
