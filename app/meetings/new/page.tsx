import { NewMeetingForm, type MeetingMode } from "@/components/features/messages/CollabAreas";

export const metadata = { title: "New meeting — Cowork" };

const MODES = new Set<MeetingMode>(["instant", "scheduled", "link"]);

/* `?mode=` is set by the "New" menu on the dashboard (instant / scheduled /
   link). Read on the server and passed as a prop, so the form needs no
   `useSearchParams` and no Suspense boundary. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const resolved: MeetingMode =
    mode && MODES.has(mode as MeetingMode) ? (mode as MeetingMode) : "scheduled";
  return <NewMeetingForm mode={resolved} />;
}
