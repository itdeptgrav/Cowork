import assert from "node:assert/strict";
import { test } from "node:test";
import { detectUrl, isUrl, linkAt, normalizeUrl, setLink } from "@/lib/spreadsheet/hyperlink";

test("normalizeUrl passes through explicit safe schemes", () => {
  assert.equal(normalizeUrl("https://example.com"), "https://example.com");
  assert.equal(normalizeUrl("http://example.com/a?b=c"), "http://example.com/a?b=c");
  assert.equal(normalizeUrl("mailto:a@b.com"), "mailto:a@b.com");
});

test("normalizeUrl promotes a bare domain to https and a bare email to mailto", () => {
  assert.equal(normalizeUrl("www.example.com"), "https://www.example.com");
  assert.equal(normalizeUrl("example.com/path"), "https://example.com/path");
  assert.equal(normalizeUrl("someone@example.com"), "mailto:someone@example.com");
});

test("normalizeUrl rejects unsafe schemes and non-URLs", () => {
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("data:text/html,x"), null);
  assert.equal(normalizeUrl("ftp://host/file"), null);
  assert.equal(normalizeUrl("just some words"), null);
  assert.equal(normalizeUrl(""), null);
});

test("isUrl and detectUrl agree with normalizeUrl", () => {
  assert.equal(isUrl("https://x.com"), true);
  assert.equal(isUrl("hello world"), false);
  assert.equal(detectUrl("openai.com"), "https://openai.com");
  assert.equal(detectUrl("a link to openai.com in a sentence"), null); // whole cell must be the URL
});

test("setLink adds, replaces, and clears a cell's link keeping the map sparse", () => {
  let links = setLink(undefined, "A1", "https://a.com");
  assert.equal(linkAt(links, "A1"), "https://a.com");
  // Replace.
  links = setLink(links, "A1", "https://b.com");
  assert.equal(linkAt(links, "A1"), "https://b.com");
  // Setting the same URL is a no-op (same reference).
  assert.equal(setLink(links, "A1", "https://b.com"), links);
  // Clearing the only link drops the map entirely.
  assert.equal(setLink(links, "A1", null), undefined);
});
