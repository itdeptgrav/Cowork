import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * A status pill that sat on the room's OWN dark header, rendered as a solid
 * blob with no readable text — the "Live" state next to REC, Pause and Stop.
 *
 * `Chip`'s tones are `--state-positive-ink` and friends, tuned for contrast
 * against the ordinary near-white page. The room's own header is near-black —
 * `text-slab-ink`, `border-white/10` — so `<Chip tone="positive">` there put a
 * page-tuned ink on a surface the tokens were never checked against. `SlabChip`
 * is the component this repo already carries for exactly that surface (see its
 * own header comment); the two places below had simply not been switched to it.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PRIMITIVES = code("components/ui/Primitives.tsx");
const ROOM = code("components/features/meetings/MeetingRoom.tsx");
const LOBBY = code("components/features/meetings/MeetingLobby.tsx");

test("SlabChip has its own tones, not the page's", () => {
  assert.match(PRIMITIVES, /export function SlabChip\(/);
  assert.match(
    PRIMITIVES,
    /positive:\s*"bg-emerald-400\/20 text-emerald-300"/,
    "SlabChip's positive tone no longer names a literal colour for this surface",
  );
});

test("the room header's status pill is a SlabChip", () => {
  /* The reported fault: a solid pill beside REC/Pause/Stop with no visible
     text, in the room's own header. */
  assert.match(ROOM, /<SlabChip tone=\{meeting\.status === "live"/);
  assert.doesNotMatch(
    ROOM,
    /<Chip tone=\{meeting\.status/,
    "the room header is minting a page-tuned Chip on its dark surface again",
  );
});

test("the lobby's Scheduled pill is a SlabChip", () => {
  /* Same surface, same bug, one screen earlier — the pre-join lobby is the
     same dark slab as the room it leads into. */
  assert.match(LOBBY, /<SlabChip tone="positive">/);
  assert.doesNotMatch(
    LOBBY,
    /<Chip tone="positive">/,
    "the lobby is minting a page-tuned Chip on its dark surface again",
  );
});

test("the room's status pill still reads the way it does outside the room", () => {
  /* Matches MeetingMasthead's own dot-plus-capitalised-label shape, so "Live"
     looks like "Live" whether you are looking at the page or the room. */
  assert.match(
    ROOM,
    /rounded-full bg-current align-middle/,
    "the room's status dot is gone",
  );
  assert.match(ROOM, /"Waiting room"/);
  assert.match(
    ROOM,
    /meeting\.status\.charAt\(0\)\.toUpperCase\(\) \+/,
    "the status is no longer capitalised for display",
  );
});

test("SlabChip's existing callers are untouched", () => {
  /* ProjectSlab's three plain chips never asked for a tone, and the default
     staying "neutral" — the exact single style SlabChip always rendered — is
     what keeps them rendering exactly as before this fix. */
  const projectSlab = code("components/features/projects/ProjectSlab.tsx");
  assert.match(projectSlab, /<SlabChip>\{p\.status\.replace/);
  assert.match(projectSlab, /<SlabChip>\{pr\.health\.replace/);

  const def = PRIMITIVES.slice(PRIMITIVES.indexOf("export function SlabChip("));
  assert.match(
    def,
    /tone = "neutral"/,
    "SlabChip no longer defaults to its original tone",
  );
  assert.match(
    def.slice(0, def.indexOf("return")),
    /neutral:\s*"bg-white\/10 text-slab-ink"/,
    "SlabChip's neutral tone no longer matches its original single style",
  );
});
