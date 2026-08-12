"use client";

import { useQuery } from "@/lib/hooks/useRepository";

/**
 * Does this workspace require a screen share to be Online?
 *
 * **One question, one place.** The switch changes what Online MEANS, and four
 * surfaces have to agree about it — the pill, the status menu, the manager's
 * panel and the help. If each read the policy itself and applied its own
 * default, the first mismatch would be a person told they are online while
 * their manager's panel says they are not sharing, which is precisely the
 * confusion this feature exists to remove.
 *
 * **`true` while it is unknown, and that is deliberate.** The requirement is the
 * product's own position and the stored default, so a page that has not heard
 * yet behaves as it always has rather than briefly offering an unmonitored
 * Online that the policy would then take away. It is a one-request read of the
 * same document the office-policy page saves, so "not heard yet" lasts a moment.
 */
export function useScreenShareRequired(): boolean {
  const policy = useQuery((r) => r.getOfficePolicy(), []);
  return policy.data?.requireScreenShare !== false;
}
