import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSafeHref,
  linkLabel,
  normaliseHref,
  LINK_WINDOW_FEATURES,
} from "./linkTools.ts";

test("a bare domain becomes an https address", () => {
  /* Nobody types the scheme. A link that silently does nothing because it was
     stored as "example.com" is the commonest way a link box disappoints. */
  assert.equal(normaliseHref("example.com"), "https://example.com/");
  assert.equal(normaliseHref("  example.com/docs  "), "https://example.com/docs");
});

test("an address that names its scheme keeps it", () => {
  assert.equal(normaliseHref("http://intranet.local/x"), "http://intranet.local/x");
  assert.equal(normaliseHref("https://a.example/b?c=d"), "https://a.example/b?c=d");
  assert.equal(normaliseHref("mailto:sam@example.com"), "mailto:sam@example.com");
  assert.equal(normaliseHref("tel:+919876543210"), "tel:+919876543210");
});

test("an email address on its own becomes a mailto", () => {
  assert.equal(normaliseHref("sam@example.com"), "mailto:sam@example.com");
});

test("javascript: is refused, in every disguise", () => {
  /**
   * The reason this file exists. A document is shared, so a link in it came
   * from somebody else — and it is exactly the place a colleague clicks
   * without thinking. `javascript:` in an href runs in their session.
   */
  assert.equal(normaliseHref("javascript:alert(1)"), null);
  assert.equal(normaliseHref("JavaScript:alert(1)"), null);
  assert.equal(normaliseHref("  javascript:alert(1)"), null);
  assert.equal(normaliseHref("data:text/html,<script>x</script>"), null);
  assert.equal(normaliseHref("vbscript:msgbox"), null);
  assert.equal(normaliseHref("file:///C:/Windows/System32"), null);
});

test("nothing is not a link", () => {
  assert.equal(normaliseHref(""), null);
  assert.equal(normaliseHref("   "), null);
  assert.equal(normaliseHref("https://"), null);
});

test("safety is asked again at the moment of opening", () => {
  /* An href in the document was not necessarily written by `normaliseHref` —
     HTML also arrives by paste and by import. */
  assert.equal(isSafeHref("https://example.com"), true);
  assert.equal(isSafeHref("mailto:a@b.co"), true);
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("data:text/html,x"), false);
  assert.equal(isSafeHref("not a url"), false);
  assert.equal(isSafeHref(null), false);
  assert.equal(isSafeHref(undefined), false);
});

test("the bubble shows where the click would go, not the whole query string", () => {
  /* The label is a confirmation of destination. A tracking URL confirms
     nothing, so the host is what is shown. */
  assert.equal(linkLabel("https://www.example.com/"), "example.com");
  assert.equal(linkLabel("https://example.com/docs/x"), "example.com/docs/x");
  assert.equal(
    linkLabel("https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c"),
    "example.com",
  );
});

test("mailto and tel show what they address", () => {
  /* For these the rest of the string IS the point, so it is not trimmed away. */
  assert.equal(linkLabel("mailto:sam@example.com"), "sam@example.com");
  assert.equal(linkLabel("tel:+919876543210"), "+919876543210");
});

test("a very long address is shortened rather than allowed to stretch the bubble", () => {
  const long = `https://example.com/${"a".repeat(200)}`;
  const label = linkLabel(long);
  assert.ok(label.length <= 48, `got ${label.length}`);
  assert.ok(label.endsWith("…"));
});

test("links open without handing the new page control of this one", () => {
  /**
   * Without `noopener` the opened page gets a handle on the tab it came from
   * and can navigate it — on a signed-in workspace that is a way to put a
   * convincing fake login in front of somebody who only clicked a link in a
   * colleague's document.
   */
  assert.match(LINK_WINDOW_FEATURES, /noopener/);
  assert.match(LINK_WINDOW_FEATURES, /noreferrer/);
});
