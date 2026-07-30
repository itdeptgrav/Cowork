import type { ReactNode } from "react";
import { LensProvider } from "./LensContext";
import { ThemeProvider } from "./ThemeContext";
import { DeviceModeProvider } from "./DeviceModeContext";
import { ShellFrame } from "./ShellFrame";
import { IridescentField } from "@/components/ui/IridescentField";
import { MusicProvider } from "@/components/features/music/MusicContext";
import { MUSIC_ENABLED } from "@/lib/music/config";

/**
 * The three materials of "Chrome Under Frost", stacked in their fixed order:
 * the chrome field at the back, the opaque deck holding navigation and content,
 * and whatever slabs the route puts on top.
 *
 * What lives at THIS level is what every route needs regardless of whether
 * anybody is signed in: the theme, the lens, the music context and the field.
 * The field in particular stays — the sign-in page is the first thing anyone
 * sees of Cowork and it should be the product's own material, not a white box.
 *
 * Everything that reads an identity — navigation, presence, the player, help —
 * moved down into `ShellFrame`, which knows whether the route has a session and
 * holds the workspace back until it does.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      {/* Outside the shell frame, because the mode has to be available to the
          background field and the top bar — both of which render before any
          session exists. */}
      <DeviceModeProvider>
      <LensProvider>
        <MusicProvider enabled={MUSIC_ENABLED}>
          <IridescentField />
          <ShellFrame>{children}</ShellFrame>
        </MusicProvider>
      </LensProvider>
      </DeviceModeProvider>
    </ThemeProvider>
  );
}
