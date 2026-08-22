import assert from "node:assert/strict";
import { test } from "node:test";

import { opensSupport, routeOwnsSave, type ShortcutKey } from "./shortcut.ts";

const key = (over: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key: "s",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

test("Ctrl+S opens support", () => {
  assert.equal(opensSupport(key(), "/"), true);
});

test("Cmd+S opens it too — the same muscle memory on a Mac", () => {
  assert.equal(opensSupport(key({ ctrlKey: false, metaKey: true }), "/"), true);
});

test("Caps Lock does not make it a different key", () => {
  assert.equal(opensSupport(key({ key: "S" }), "/"), true);
});

test("it works before sign-in, which is the case it exists for", () => {
  for (const path of ["/signin", "/signup", "/reset-password", "/sso"])
    assert.equal(opensSupport(key(), path), true, `${path} should offer support`);
});

test("a bare S, or S with only Alt or Shift, is not the shortcut", () => {
  assert.equal(opensSupport(key({ ctrlKey: false }), "/"), false);
  assert.equal(opensSupport(key({ altKey: true }), "/"), false);
  assert.equal(opensSupport(key({ shiftKey: true }), "/"), false);
});

test("another letter is not the shortcut", () => {
  assert.equal(opensSupport(key({ key: "k" }), "/"), false);
});

/* ── The part that protects somebody's work ───────────────────────────────── */

test("the workspace keeps its own Ctrl+S — that key saves a document there", () => {
  assert.equal(opensSupport(key(), "/workspace"), false);
  assert.equal(opensSupport(key(), "/workspace/documents/abc"), false);
  assert.equal(routeOwnsSave("/workspace"), true);
});

test("the stand-down is by prefix, so a new workspace surface inherits it", () => {
  assert.equal(routeOwnsSave("/workspace/whatever/comes/next"), true);
});

test("a route that merely starts with the same letters is NOT protected", () => {
  /* `/workspaces` is a different route from `/workspace`, and silently
     disabling support on it would be a stand-down nobody asked for. */
  assert.equal(routeOwnsSave("/workspaces"), false);
  assert.equal(opensSupport(key(), "/workspaces"), true);
});

test("everywhere else it opens", () => {
  for (const path of ["/", "/tasks", "/messages/abc", "/team", "/sheets"])
    assert.equal(opensSupport(key(), path), true, `${path} should offer support`);
});
