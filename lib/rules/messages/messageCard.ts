/**
 * The ONE structured payload a message may carry, and the rules around it.
 *
 * ## Why this exists before any of the features that use it
 *
 * Polls, shared locations and shared contacts are three different things a
 * message can be, and each was designed independently as "a new kind of message
 * bubble". Left alone that produces three carriers on the document, three
 * fallback-text conventions, three predicates deciding whether the bubble's text
 * line is drawn, and three places for search to go wrong. Every one of them
 * edits the same `{m.text && (` conditional in two components.
 *
 * So there is one carrier — `card` — one fallback rule, one suppression rule,
 * and one rule for what search may match.
 *
 * ## The compatibility contract, stated once
 *
 * The `messages` subcollection is co-written by the OLDER Cowork application,
 * which this repository does not control and cannot migrate. That app renders a
 * message's `text` and knows nothing about `card`. So every card also writes a
 * plain-language `text` — `cardFallbackText` — and leaves `messageType` at
 * `"text"`. An older reader sees a sentence; a current one sees the card and
 * hides the sentence.
 *
 * **`messageType` is frozen at write time.** `messaging.ts` already records the
 * fallout of getting it wrong once: every video sent before `video` was
 * whitelisted is stored as `file` forever. A card must therefore never invent a
 * new `messageType` value — an unrecognised one makes the old app render a
 * placeholder for a message that has perfectly good text.
 *
 * ## What search may match, and why it is not `text`
 *
 * `cardFallbackText` is a string nobody typed. If search matched it, "location"
 * would return every location message ever sent and "poll" every poll. So
 * search reads `searchableText`, which returns what a PERSON wrote — the
 * caption, the poll question and its options, a contact's name, a location's
 * label — and never the synthetic prefix or the maps URL.
 *
 * ## A tombstone carries no card
 *
 * Soft delete already clears `text` and `attachments`. `card` must go with them
 * or a deleted contact card renders live and linked under "This message was
 * deleted." `readCard` returns null for a deleted message so a document written
 * before that rule still reads correctly.
 */

/** The minimum a message must expose for these rules. Both the Messages
    `Message` and the task `TaskChatMessage` satisfy it structurally — the same
    approach `GalleryMessage` takes in `lib/rules/media/conversationGallery.ts`. */
export interface CardMessage {
  text: string;
  card?: MessageCard | null;
  isDeleted?: boolean;
}

/* ── The payloads ────────────────────────────────────────────────────────── */

export interface PollCard {
  kind: "poll";
  question: string;
  /** Option ids are stable and independent of order, so a vote survives an
      option being renamed and cannot be moved onto a different answer. */
  options: { id: string; text: string }[];
  /** Whether one person may choose more than one option. */
  multiple: boolean;
  /** Closed polls still render, with their result and no way to vote. */
  closedAt?: string | null;
}

export interface LocationCard {
  kind: "location";
  lat: number;
  lng: number;
  /** Metres, as the browser reported it. Shown so a reader can tell a rooftop
      fix from a cell-tower one rather than trusting a pin. */
  accuracyMetres?: number | null;
  /** What the sender called the place. Free text, never geocoded — this app
      asks no third party who lives at those coordinates. */
  label?: string | null;
}

export interface ContactCard {
  kind: "contact";
  employeeId: string;
  /** A name snapshot, used ONLY when the id no longer resolves in the
      directory. Everything shown on a live card is read from the directory, so
      a colleague who changes department does not leave stale cards behind. */
  nameSnapshot: string;
}

export type MessageCard = PollCard | LocationCard | ContactCard;

/* ── The compatibility text ──────────────────────────────────────────────── */

/**
 * The sentence written into `text` so an older reader sees something useful.
 *
 * Deliberately plain: no emoji-only bodies, because this string is also the
 * conversation-list preview and a push notification body.
 */
export function cardFallbackText(card: MessageCard): string {
  switch (card.kind) {
    case "poll":
      return `Poll: ${card.question}`;
    case "location":
      return card.label
        ? `Location: ${card.label}`
        : "Shared a location";
    case "contact":
      return `Contact: ${card.nameSnapshot}`;
  }
}

/**
 * Whether the bubble should hide its text line because the card says it all.
 *
 * **Not string equality.** An earlier design suppressed the line only when
 * `text` exactly matched the fallback — which breaks the moment anybody EDITS
 * the message, because `editMessage` rewrites `text` and the card then renders
 * with the raw synthetic sentence above it, permanently.
 *
 * The rule is instead: a message with a card hides its text line when that text
 * is still the generated one OR is empty. Anything a person actually typed is
 * shown above the card, which is what a caption is.
 */
export function suppressesText(m: CardMessage): boolean {
  const card = readCard(m);
  if (!card) return false;
  const text = (m.text ?? "").trim();
  return text === "" || text === cardFallbackText(card);
}

/**
 * What a person actually wrote on this message — the corpus search may match.
 *
 * Returns the caption where there is one, plus the human parts of the card. The
 * synthetic prefix ("Poll:", "Shared a location") and the maps URL are never
 * included, so searching for "location" finds messages ABOUT a location rather
 * than every location ever shared.
 */
export function searchableText(m: CardMessage): string {
  if (m.isDeleted) return "";
  const card = readCard(m);
  const caption = suppressesText(m) ? "" : (m.text ?? "");
  if (!card) return m.text ?? "";

  switch (card.kind) {
    case "poll":
      return [caption, card.question, ...card.options.map((o) => o.text)]
        .filter(Boolean)
        .join(" ");
    case "location":
      return [caption, card.label ?? ""].filter(Boolean).join(" ");
    case "contact":
      return [caption, card.nameSnapshot].filter(Boolean).join(" ");
  }
}

/* ── Reading one back ────────────────────────────────────────────────────── */

/**
 * The card on a message, or null.
 *
 * Defensive in the same way `readMessageDoc` is defensive about every other
 * field: a document written by the older app, by a future version, or by a
 * half-finished write must read as "no card" rather than crash a thread.
 *
 * A soft-deleted message never has one — see the note at the top of this file.
 */
export function readCard(m: CardMessage): MessageCard | null {
  if (m.isDeleted) return null;
  const raw = m.card;
  if (!raw || typeof raw !== "object") return null;

  switch ((raw as { kind?: unknown }).kind) {
    case "poll": {
      const c = raw as PollCard;
      if (typeof c.question !== "string" || !Array.isArray(c.options)) return null;
      const options = c.options
        .filter(
          (o): o is { id: string; text: string } =>
            !!o && typeof o.id === "string" && typeof o.text === "string",
        )
        .map((o) => ({ id: o.id, text: o.text }));
      /* A poll with nothing to choose between is not a poll. Rendering one
         would put an empty card where an older reader sees a real sentence. */
      if (options.length < 2) return null;
      return {
        kind: "poll",
        question: c.question,
        options,
        multiple: c.multiple === true,
        closedAt: typeof c.closedAt === "string" ? c.closedAt : null,
      };
    }
    case "location": {
      const c = raw as LocationCard;
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return null;
      /* Out-of-range coordinates would put a pin somewhere impossible; treat
         them as no card rather than draw a map of nowhere. */
      if (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) return null;
      return {
        kind: "location",
        lat: c.lat,
        lng: c.lng,
        accuracyMetres: Number.isFinite(c.accuracyMetres as number)
          ? (c.accuracyMetres as number)
          : null,
        label: typeof c.label === "string" && c.label.trim() ? c.label : null,
      };
    }
    case "contact": {
      const c = raw as ContactCard;
      if (typeof c.employeeId !== "string" || !c.employeeId) return null;
      return {
        kind: "contact",
        employeeId: c.employeeId,
        nameSnapshot:
          typeof c.nameSnapshot === "string" && c.nameSnapshot
            ? c.nameSnapshot
            : c.employeeId,
      };
    }
    default:
      return null;
  }
}

/**
 * Where a location card links to.
 *
 * A plain `https://www.google.com/maps` query link, opened only when a reader
 * deliberately clicks it. **No map image is embedded**: a static tile would
 * tell a third party which employee's coordinates are being looked at, on every
 * render, for as long as the thread exists — and it would need an API key and
 * billing that do not exist here.
 */
export function mapsLinkFor(card: LocationCard): string {
  return `https://www.google.com/maps?q=${card.lat},${card.lng}`;
}

/**
 * Coordinates as shown on the card.
 *
 * Five decimal places — roughly a metre, which is what makes a shared location
 * useful for "I am at this door" rather than "I am in this city".
 */
export function formatCoordinates(card: LocationCard): string {
  return `${card.lat.toFixed(5)}, ${card.lng.toFixed(5)}`;
}
