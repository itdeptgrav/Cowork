import { LegacyValidate } from "@/components/features/legacy/LegacyValidate";

export const metadata = { title: "Adapter validation — Cowork" };

/**
 * Migration tooling. Not a product surface.
 *
 * No provider of its own. `ShellFrame` already mounts the application's
 * `SessionProvider` for this route, and a second provider here resolved the
 * same Firebase state independently — two sessions for one person, which is the
 * duplicate auth system this migration exists to remove. It also read as
 * "not signed in" whenever its own resolution had not yet settled, regardless
 * of the app's.
 */
export default function Page() {
  return <LegacyValidate />;
}
