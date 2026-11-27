// A material request is not sent while a photo is still uploading
// (27 Nov 2026: a request sent mid-upload reached the Store with no photo —
// the uploader only hands its photos to the form once they are in).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const form = readFileSync(path.join(here, "NewMrfForm.tsx"), "utf8");
const uploader = readFileSync(path.join(here, "MrfPhotoUploader.tsx"), "utf8");

test("the uploader says when an upload starts and ends", () => {
  assert.match(uploader, /onBusyChange\?\.\(true\)/);
  assert.match(uploader, /onBusyChange\?\.\(false\)/);
});

test("every line's uploader reports to the form, which holds Send until the photos are in", () => {
  assert.match(form, /onBusyChange=\{onUploading\}/);
  assert.match(form, /disabled=\{state\.isPending \|\| uploading > 0\}/);
  assert.match(form, /if \(uploading > 0\) return;/);
  assert.match(form, /Wait for the photos to finish uploading, then send\./);
});
