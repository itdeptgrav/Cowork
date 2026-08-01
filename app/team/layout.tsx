import type { ReactNode } from "react";
import { TeamGate } from "@/components/features/team/TeamGate";

/**
 * Every team surface, gated in one place.
 *
 * A layout rather than a check inside each page: `/team`, `/team/[employeeId]`
 * and its attendance, score and tasks tabs are all team views, and so is
 * whatever gets added next. Putting the rule here means a new view inherits it
 * by living in this folder instead of by somebody remembering to ask.
 */
export default function TeamLayout({ children }: { children: ReactNode }) {
  return <TeamGate>{children}</TeamGate>;
}
