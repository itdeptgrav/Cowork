import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstUrl,
  hasPreviewContent,
  linkPreviewForWrite,
  readLinkPreview,
} from "./linkPreview.ts";

test("firstUrl finds the first link and trims trailing sentence punctuation", () => {
  assert.equal(firstUrl("check this out: https://example.com/page."), "https://example.com/page");
  assert.equal(firstUrl("(see https://example.com/a)"), "https://example.com/a");
  assert.equal(
    firstUrl("two links https://a.example.com and https://b.example.com"),
    "https://a.example.com",
    "only the first link is returned",
  );
  assert.equal(firstUrl("no link here at all"), null);
  assert.equal(firstUrl(""), null);
  assert.equal(firstUrl("mixed text before https://example.com/x?y=1&z=2 after"), "https://example.com/x?y=1&z=2");
});

test("readLinkPreview requires a url and a domain, and defaults every other field to null", () => {
  assert.deepEqual(readLinkPreview({ url: "https://example.com", domain: "example.com" }), {
    url: "https://example.com",
    finalUrl: null,
    domain: "example.com",
    title: null,
    description: null,
    image: null,
    favicon: null,
    siteName: null,
  });
  assert.equal(readLinkPreview({ domain: "example.com" }), undefined, "no url");
  assert.equal(readLinkPreview({ url: "https://example.com" }), undefined, "no domain");
  assert.equal(readLinkPreview(null), undefined);
  assert.equal(readLinkPreview("not an object"), undefined);
  assert.equal(readLinkPreview({ url: "  ", domain: "example.com" }), undefined, "a blank url is not a url");
});

test("readLinkPreview drops fields of the wrong type rather than throwing", () => {
  const preview = readLinkPreview({
    url: "https://example.com",
    domain: "example.com",
    title: 42,
    image: { not: "a string" },
  });
  assert.equal(preview?.title, null);
  assert.equal(preview?.image, null);
});

test("linkPreviewForWrite fills every optional field with an explicit null for Firestore", () => {
  const written = linkPreviewForWrite({
    url: "https://example.com",
    domain: "example.com",
    title: "A title",
  });
  assert.deepEqual(written, {
    url: "https://example.com",
    finalUrl: null,
    domain: "example.com",
    title: "A title",
    description: null,
    image: null,
    favicon: null,
    siteName: null,
  });
  assert.ok(Object.values(written).every((v) => v !== undefined), "Firestore rejects undefined");
});

test("a preview round-trips through write and read unchanged", () => {
  const original = {
    url: "https://example.com/a",
    finalUrl: "https://example.com/a/",
    domain: "example.com",
    title: "Title",
    description: "Description",
    image: "https://example.com/img.png",
    favicon: "https://example.com/favicon.ico",
    siteName: "Example",
  };
  assert.deepEqual(readLinkPreview(linkPreviewForWrite(original)), original);
});

test("hasPreviewContent is true with a title, a description or an image alone, and false with none", () => {
  assert.equal(hasPreviewContent({ title: "T", description: null, image: null }), true);
  assert.equal(hasPreviewContent({ title: null, description: "D", image: null }), true);
  assert.equal(hasPreviewContent({ title: null, description: null, image: "https://x/y.png" }), true);
  assert.equal(hasPreviewContent({ title: null, description: null, image: null }), false, "domain alone is not enough");
});
