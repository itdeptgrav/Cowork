import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cardFallbackText,
  formatCoordinates,
  mapsLinkFor,
  readCard,
  searchableText,
  suppressesText,
  type LocationCard,
  type MessageCard,
} from "./messageCard.ts";

/**
 * One carrier, one fallback, one suppression rule, one search corpus.
 *
 * Written before polls, locations and contacts exist, because each of those was
 * designed independently as "a new kind of bubble" and the three together would
 * otherwise produce three carriers, three conventions and three predicates
 * fighting over the same `{m.text && (` conditional in two components.
 */

const POLL: MessageCard = {
  kind: "poll",
  question: "Where for the offsite?",
  options: [
    { id: "a", text: "Goa" },
    { id: "b", text: "Coorg" },
  ],
  multiple: false,
  closedAt: null,
};

const PLACE: LocationCard = {
  kind: "location",
  lat: 12.97159,
  lng: 77.59456,
  accuracyMetres: 12,
  label: "Office gate",
};

const CONTACT: MessageCard = {
  kind: "contact",
  employeeId: "GR0042",
  nameSnapshot: "Anita Sharma",
};

/* ── The compatibility contract ──────────────────────────────────────────── */

test("every card writes a plain sentence for the older application", () => {
  /**
   * The `messages` subcollection is co-written by an app this repo does not
   * control and cannot migrate. It renders `text` and knows nothing about
   * `card`, so a card with an empty text would be a blank bubble there —
   * permanently, because the document cannot be rewritten.
   */
  assert.equal(cardFallbackText(POLL), "Poll: Where for the offsite?");
  assert.equal(cardFallbackText(PLACE), "Location: Office gate");
  assert.equal(cardFallbackText(CONTACT), "Contact: Anita Sharma");
});

test("a location with no label still says something", () => {
  assert.equal(
    cardFallbackText({ ...PLACE, label: null }),
    "Shared a location",
  );
});

test("no fallback is emoji-only, because it is also a push body", () => {
  /* This string is the conversation-list preview and the notification body. A
     lock screen reading just an emoji tells nobody anything. */
  for (const card of [POLL, PLACE, CONTACT]) {
    const text = cardFallbackText(card);
    assert.match(text, /[a-z]{3}/i, `${card.kind} has no words`);
  }
});

/* ── Suppression, and the edit that used to break it ─────────────────────── */

test("the generated sentence is hidden, so the card is not drawn twice", () => {
  assert.equal(suppressesText({ text: cardFallbackText(POLL), card: POLL }), true);
  assert.equal(suppressesText({ text: "", card: POLL }), true);
});

test("a caption somebody typed is SHOWN above the card", () => {
  assert.equal(
    suppressesText({ text: "can everyone vote by Friday", card: POLL }),
    false,
  );
});

test("editing a card message does not expose the synthetic sentence forever", () => {
  /**
   * The bug this rule exists to avoid. An earlier design suppressed the line
   * only on EXACT equality with the fallback — and `editMessage` rewrites
   * `text`, so the first edit of a location message would render the card AND
   * the raw sentence above it, for good.
   *
   * The rule here treats anything a person typed as a caption, which is a
   * coherent thing to show rather than a leak.
   */
  const edited = { text: "Location: Office gate (side entrance)", card: PLACE };
  assert.equal(suppressesText(edited), false, "an edit must not vanish");
  assert.equal(
    searchableText(edited).includes("side entrance"),
    true,
    "and the edit must still be findable",
  );
});

test("a message with no card never suppresses its text", () => {
  assert.equal(suppressesText({ text: "hello" }), false);
  assert.equal(suppressesText({ text: "hello", card: null }), false);
});

/* ── What search may match ───────────────────────────────────────────────── */

test("search matches what a person wrote, never the generated prefix", () => {
  /**
   * The trap: four features write synthetic strings into `text`. If search read
   * `text`, then "location" would return every location message ever sent and
   * "poll" every poll — matches for a word nobody typed.
   */
  const msg = { text: cardFallbackText(PLACE), card: PLACE };
  const corpus = searchableText(msg).toLowerCase();
  assert.equal(corpus.includes("location"), false, "matched the prefix");
  assert.equal(corpus.includes("office gate"), true, "lost the real label");
});

test("a poll is findable by its question AND by any option", () => {
  const corpus = searchableText({ text: cardFallbackText(POLL), card: POLL });
  assert.match(corpus, /offsite/);
  assert.match(corpus, /Goa/);
  assert.match(corpus, /Coorg/);
  assert.doesNotMatch(corpus, /^Poll:/);
});

test("a contact is findable by name, without the word contact", () => {
  const corpus = searchableText({ text: cardFallbackText(CONTACT), card: CONTACT });
  assert.match(corpus, /Anita Sharma/);
  assert.doesNotMatch(corpus.toLowerCase(), /contact/);
});

test("an ordinary message searches exactly as it always did", () => {
  assert.equal(searchableText({ text: "the deploy is done" }), "the deploy is done");
});

test("a deleted message matches nothing", () => {
  assert.equal(searchableText({ text: "secret", card: CONTACT, isDeleted: true }), "");
});

/* ── Tombstones ──────────────────────────────────────────────────────────── */

test("a deleted message carries no card", () => {
  /* Soft delete clears text and attachments. A card left behind would render a
     live, linked contact under "This message was deleted." */
  assert.equal(readCard({ text: "", card: CONTACT, isDeleted: true }), null);
  assert.equal(readCard({ text: "", card: PLACE, isDeleted: true }), null);
});

/* ── Reading a document written by somebody else ─────────────────────────── */

test("anything unrecognisable reads as no card, rather than crashing a thread", () => {
  for (const card of [
    undefined,
    null,
    "poll",
    42,
    {},
    { kind: "unknown-future-kind" },
    { kind: "poll" },
  ] as unknown[]) {
    assert.equal(
      readCard({ text: "x", card: card as MessageCard }),
      null,
      `${JSON.stringify(card)} produced a card`,
    );
  }
});

test("a poll with fewer than two options is not a poll", () => {
  /* Rendering an empty card would replace a perfectly good sentence that the
     older app is still showing. */
  assert.equal(
    readCard({
      text: "x",
      card: { ...POLL, options: [{ id: "a", text: "Goa" }] } as MessageCard,
    }),
    null,
  );
});

test("junk options are dropped, and the rest of the poll survives", () => {
  const read = readCard({
    text: "x",
    card: {
      ...POLL,
      options: [
        { id: "a", text: "Goa" },
        null,
        { id: "b", text: "Coorg" },
        { text: "no id" },
      ],
    } as unknown as MessageCard,
  });
  assert.equal(read?.kind, "poll");
  assert.equal(read?.kind === "poll" && read.options.length, 2);
});

test("impossible coordinates are refused rather than drawn", () => {
  for (const bad of [
    { lat: 91, lng: 0 },
    { lat: 0, lng: 181 },
    { lat: Number.NaN, lng: 0 },
  ]) {
    assert.equal(
      readCard({ text: "x", card: { ...PLACE, ...bad } as MessageCard }),
      null,
      `${JSON.stringify(bad)} was accepted`,
    );
  }
});

test("a contact with no id is refused; a missing name falls back to the id", () => {
  assert.equal(
    readCard({ text: "x", card: { kind: "contact" } as MessageCard }),
    null,
  );
  const read = readCard({
    text: "x",
    card: { kind: "contact", employeeId: "GR0042" } as MessageCard,
  });
  assert.equal(read?.kind === "contact" && read.nameSnapshot, "GR0042");
});

test("multiple defaults to false rather than undefined", () => {
  /* A poll read as `multiple: undefined` would let the vote rule decide by
     accident. */
  const read = readCard({
    text: "x",
    card: { ...POLL, multiple: undefined } as unknown as MessageCard,
  });
  assert.equal(read?.kind === "poll" && read.multiple, false);
});

/* ── The map link, and what it deliberately is not ───────────────────────── */

test("a location links out rather than embedding a map image", () => {
  /**
   * An embedded static tile would tell a third party which employee's
   * coordinates are being looked at, on every render, for as long as the thread
   * exists — and it needs an API key and billing that do not exist here. A link
   * is only followed when a reader deliberately clicks it.
   */
  assert.equal(
    mapsLinkFor(PLACE),
    "https://www.google.com/maps?q=12.97159,77.59456",
  );
});

test("coordinates are shown to a metre", () => {
  assert.equal(formatCoordinates(PLACE), "12.97159, 77.59456");
});
