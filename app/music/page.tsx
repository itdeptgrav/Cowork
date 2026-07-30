import type { Metadata } from "next";
import { MusicArea } from "@/components/features/music/MusicArea";
import { MUSIC_ENABLED } from "@/lib/music/config";

export const metadata: Metadata = { title: "Focus Music — Cowork" };

/**
 * The music surface.
 *
 * The flag is read on the SERVER and passed down as a boolean, so a disabled
 * deployment renders a stated empty state without the client ever attempting a
 * request. The video itself is not here — it lives in the shell's fixed player
 * region so it survives navigation and never follows the reader around.
 */
export default function MusicPage() {
  return <MusicArea enabled={MUSIC_ENABLED} />;
}
