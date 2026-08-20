import assert from "node:assert/strict";
import { test } from "node:test";

import { detectPhoneNumbers } from "./phoneNumbers.ts";

/**
 * The detector's whole value is what it REFUSES. A phone number rendered as
 * text is copyable; a task figure rendered as a call button teaches people the
 * blue text means nothing. So the negatives here outnumber the positives, and
 * each one names the non-phone shape it protects.
 */

const hrefs = (text: string) => detectPhoneNumbers(text).map((m) => m.href);
const texts = (text: string) => detectPhoneNumbers(text).map((m) => m.text);

/* ── What must link ───────────────────────────────────────────────────────── */

test("a plain ten-digit mobile links", () => {
  assert.deepEqual(hrefs("call me on 9876543210"), ["tel:9876543210"]);
});

test("+country-code forms link, keeping the plus", () => {
  assert.deepEqual(hrefs("reach me at +91 9876543210 today"), [
    "tel:+919876543210",
  ]);
  assert.deepEqual(hrefs("+91-98765-43210"), ["tel:+919876543210"]);
});

test("grouped and bracketed forms link", () => {
  assert.deepEqual(hrefs("98765 43210"), ["tel:9876543210"]);
  assert.deepEqual(hrefs("(408) 555-0100"), ["tel:4085550100"]);
});

test("a leading trunk zero links", () => {
  assert.deepEqual(hrefs("09876543210"), ["tel:09876543210"]);
});

test("the display text is the run exactly as typed", () => {
  assert.deepEqual(texts("+91 98765 43210"), ["+91 98765 43210"]);
});

test("sentence punctuation after the number does not break it", () => {
  assert.deepEqual(hrefs("it is 9876543210."), ["tel:9876543210"]);
  assert.deepEqual(hrefs("(see 9876543210)"), ["tel:9876543210"]);
});

/* ── What must NOT link ───────────────────────────────────────────────────── */

test("dates never link, even glued to a time", () => {
  assert.deepEqual(hrefs("due 2026-08-20"), []);
  assert.deepEqual(hrefs("on 20-08-2026 17 30 sharp"), []);
  assert.deepEqual(hrefs("on 20-08-2026 17:30"), []);
});

test("short figures, years and pin codes never link", () => {
  assert.deepEqual(hrefs("call in 20 minutes"), []);
  assert.deepEqual(hrefs("by 2026 we should"), []);
  assert.deepEqual(hrefs("pincode 560001"), []);
});

test("identifiers never link", () => {
  assert.deepEqual(hrefs("see TASK-1234567890"), []);
  assert.deepEqual(hrefs("ref #1234567890"), []);
  assert.deepEqual(hrefs("order id1234567890"), []);
});

test("decimals, IPs and versions never link", () => {
  assert.deepEqual(hrefs("total 1234567890.55"), []);
  assert.deepEqual(hrefs("host 192.168.1.100"), []);
  assert.deepEqual(hrefs("v1.2.3"), []);
});

test("the wrong digit count never links", () => {
  /* Eleven digits without a leading zero is an identifier, not a mobile. */
  assert.deepEqual(hrefs("id 12345678901"), []);
  assert.deepEqual(hrefs("card 4111111111111111"), []);
  assert.deepEqual(hrefs("+1 234"), []);
});

test("numbers on separate lines are judged apart, not glued", () => {
  /* A newline is not a phone separator. Two valid numbers split by one must
     both link rather than merging into a 20-digit reject. */
  assert.deepEqual(hrefs("9876543210\n9123456780"), [
    "tel:9876543210",
    "tel:9123456780",
  ]);
});

test("several numbers in one message each link", () => {
  assert.deepEqual(hrefs("office 08012345678, mobile +91 9876543210"), [
    "tel:08012345678",
    "tel:+919876543210",
  ]);
});
