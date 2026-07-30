import type { Metadata } from "next";
import { MusicArea } from "@/components/features/music/MusicArea";
import { MUSIC_ENABLED } from "@/lib/music/config";

export const metadata: Metadata = { title: "YouTube — Cowork" };

/**
 * The video surface.
 *
 * Deliberately a separate route from `/music`: watching and listening are
 * different activities with different costs to a working day, and the product
 * decides between them by which page you are on rather than by a toggle. This
 * is also the surface where the YouTube player is presented the way YouTube's
 * policies expect — visible, unobscured, with its own controls and branding.
 */
export default function YouTubePage() {
  return <MusicArea enabled={MUSIC_ENABLED} mode="video" />;
}
