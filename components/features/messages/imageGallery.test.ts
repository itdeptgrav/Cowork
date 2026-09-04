import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The chat image viewer became a gallery: click a thumbnail and the whole
 * message's images open at that one, with Previous/Next, the ← / → keys, a
 * filmstrip and a counter. Both Messages chat and Task Chat render the same
 * `MessageAttachments`, so wiring it there covers both (asserted below).
 *
 * Source-shape checks; the index arithmetic is proven behaviourally in
 * lib/rules/media/galleryNav.test.ts.
 */

const GALLERY = "components/ui/GalleryLightbox.tsx";
const ATTACH = "components/features/messages/MessageAttachments.tsx";
const MESSAGES = "components/features/messages/MessagesArea.tsx";
const CHATPANEL = "components/features/tasks/ChatPanel.tsx";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── The viewer ───────────────────────────────────────────────────────────── */

test("the gallery takes a list and a start index", () => {
  const src = code(GALLERY);
  assert.match(src, /export function GalleryLightbox\(/);
  assert.match(src, /images: GalleryImage\[\]/);
  assert.match(src, /startIndex\??: number/);
});

test("the arrow keys navigate, and Escape still closes", () => {
  const src = code(GALLERY);
  assert.match(src, /e\.key === "Escape"/);
  assert.match(src, /e\.key === "ArrowLeft"/);
  assert.match(src, /e\.key === "ArrowRight"/);
  assert.match(src, /addEventListener\("keydown"/);
});

test("Previous/Next buttons exist and disable at the ends", () => {
  const src = code(GALLERY);
  assert.match(src, /aria-label="Previous image"/);
  assert.match(src, /aria-label="Next image"/);
  assert.match(src, /disabled=\{!canStep\(index, -1, images\.length\)\}/);
  assert.match(src, /disabled=\{!canStep\(index, 1, images\.length\)\}/);
});

test("the current image is indicated — a counter and a ringed filmstrip", () => {
  const src = code(GALLERY);
  assert.match(src, /\{index \+ 1\} \/ \{images\.length\}/);
  assert.match(src, /aria-current=\{i === index\}/);
  assert.match(src, /ring-2 ring-white/);
});

test("the gallery chrome is hidden for a single image", () => {
  /* `many` gates the arrows, filmstrip and counter, so one image is the plain
     old zoom — the existing behaviour, unchanged. */
  const src = code(GALLERY);
  assert.match(src, /const many = images\.length > 1;/);
});

test("download reuses the shared downloadFile, not a new path", () => {
  const src = code(GALLERY);
  assert.match(src, /import \{ downloadFile \} from "\.\/ImageLightbox"/);
});

/* ── Wired into the shared attachment grid (both chats) ────────────────────── */

test("a thumbnail delegates to the conversation gallery when the chat wants it", () => {
  const src = code(ATTACH);
  /* `onOpenImage` present (the chat surfaces pass it) → open the whole-thread
     viewer; absent → the component's own single-message fallback still works. */
  assert.match(src, /onOpenImage\?: \(imageIndex: number\) => void/);
  assert.match(src, /onZoom=\{\(\) => \(onOpenImage \? onOpenImage\(i\) : setZoomIndex\(i\)\)\}/);
  /* The fallback gallery is still here for standalone use. */
  assert.match(src, /const \[zoomIndex, setZoomIndex\] = useState<number \| null>\(null\)/);
  assert.match(src, /<GalleryLightbox/);
});

/* ── The whole-conversation filmstrip (WhatsApp-style) ─────────────────────── */

const CONTAINERS = [
  { name: "Messages chat", path: MESSAGES, array: "messages" },
  { name: "Task Chat", path: CHATPANEL, array: "shown" },
];

for (const c of CONTAINERS) {
  test(`${c.name} aggregates every image in the thread into one gallery`, () => {
    const src = code(c.path);
    /* The list is built from the whole message array, not one message. */
    assert.match(src, new RegExp(`collectConversationImages\\(${c.array}\\)`));
    /* And handed to a single viewer, opened at the clicked image's GLOBAL index. */
    assert.match(src, /<GalleryLightbox/);
    assert.match(src, /images=\{galleryImages\}/);
    assert.match(src, /startIndex=\{galleryIndex\}/);
    assert.match(src, /onOpenImage=\{\(li\) => openImage\(m\.id, li\)\}/);
    assert.match(src, /galleryIndexOf\(galleryItems, messageId, imageIndex\)/);
  });
}

test("the gallery header carries the sender and time, like the reference", () => {
  const g = code(GALLERY);
  assert.match(g, /title\?: string/);
  assert.match(g, /subtitle\?: string/);
  /* Both containers feed the sender name and a formatted timestamp. */
  for (const c of CONTAINERS) {
    const src = code(c.path);
    assert.match(src, /title: it\.senderName/);
    assert.match(src, /subtitle: formatDateTime\(it\.createdAt\)/);
  }
});

/* ── The viewer's action toolbar (reply / react / star / forward) ──────────── */

test("the viewer takes per-image actions, each button gated on its handler", () => {
  const g = code(GALLERY);
  assert.match(g, /export interface GalleryImageActions/);
  assert.match(g, /actions\?: GalleryImageActions\[\]/);
  /* A button appears only where the chat wired that action. */
  assert.match(g, /act\?\.onReply &&/);
  assert.match(g, /act\?\.reactions &&/);
  assert.match(g, /act\?\.onStar &&/);
  assert.match(g, /act\?\.onForward &&/);
  assert.match(g, /aria-label="Reply"/);
  assert.match(g, /aria-label="React"/);
  assert.match(g, /aria-label="Forward"/);
});

test("react opens an emoji bar wired to the message's reaction toggle", () => {
  const g = code(GALLERY);
  assert.match(g, /act\.reactions\.emojis\.map/);
  assert.match(g, /act\.reactions!\.onPick\(emoji\)/);
  /* Star and the react button fill when active. */
  assert.match(g, /act\.starred \? "fill-current"/);
});

test("reply and forward arrows are real icons", () => {
  const icons = code("components/ui/Icons.tsx");
  assert.match(icons, /reply: \(p: P\) =>/);
  assert.match(icons, /forward: \(p: P\) =>/);
});

test("Messages chat wires the full set including forward; reply closes the viewer", () => {
  const src = code(MESSAGES);
  assert.match(src, /const galleryActions = galleryItems\.map\(/);
  assert.match(src, /onForward: \(\) => \{/);
  assert.match(src, /onStar: \(\) => onStar\(m\)/);
  assert.match(src, /onReact\(m, emoji\)/);
  assert.match(src, /actions=\{galleryActions\}/);
  /* Reply/forward close the viewer so the composer / picker is seen. */
  assert.match(src, /onReply\(m\);\s*setGalleryIndex\(null\)/);
  /* MessageList is handed a star toggle for the viewer. */
  assert.match(src, /onStar=\{\(m\) => void toggleStar\(m\)\}/);
});

test("Task Chat wires reply/react/star AND forward (to a conversation)", () => {
  const src = code(CHATPANEL);
  assert.match(src, /const galleryActions = galleryItems\.map\(/);
  assert.match(src, /onStar: \(\) => void toggleStar\(m\)/);
  assert.match(src, /react\(m, emoji\)/);
  assert.match(src, /actions=\{galleryActions\}/);
  /* Forward now exists here too — the same ForwardDialog Messages opens, sent
     as a fresh message to a conversation. Reworded 2026-09-04 when task chat
     gained forwarding; it used to assert `doesNotMatch(/onForward/)`. */
  assert.match(src, /onForward: \(\) => \{/);
  /* Forward closes the viewer so the conversation picker is seen. */
  assert.match(src, /setForwarding\(m\);\s*setGalleryIndex\(null\)/);
});
