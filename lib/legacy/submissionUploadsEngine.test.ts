import assert from "node:assert/strict";
import { test } from "node:test";
import { backendAvailable, backendSource } from "./backendSource.ts";

/**
 * The engine's half of "what is still uploading".
 *
 * **Reported 28 September 2026.** A submission is written the instant it is
 * made — the timer stops there and lateness is judged there — while its files
 * are still going up. Nothing outside the uploading browser could see that, so
 * the attempt read "Submitted files (0)" at a reviewer who was free to approve
 * it. The record now carries the list, which means the ENGINE has to accept it
 * on submit and let the uploading browser correct it afterwards.
 *
 * Pinned here because a missing route on that side looks, from the page, like
 * a page that forgot to write — the reviewer is simply never released.
 */

const skip = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

const service = () => backendSource("services/taskForward.service.js");
const routes = () => backendSource("routes/task_routes/taskForward.js");

test("the submission stores what was still coming when it was made", { skip }, () => {
  const src = service();
  assert.match(src, /pendingUploads: _readPendingUploads\(pendingUploads\)/);
  assert.match(routes(), /pendingUploads: pendingUploads \|\| \[\]/);
});

test("the list is sanitised on arrival, not trusted", { skip }, () => {
  /**
   * It comes from a browser and it now gates somebody ELSE's screen, so a
   * malformed entry must not reach a reviewer. The direction of the guesses
   * matters: an unknown state reads as "uploading", never as "failed" —
   * guessing "failed" would release a reviewer onto work still in flight.
   */
  const src = service();
  assert.match(src, /function _readPendingUploads\(raw\)/);
  assert.match(src, /if \(!Array\.isArray\(raw\)\) return \[\];/);
  assert.match(src, /typeof u\.name === "string" && u\.name\.trim\(\)/);
  assert.match(src, /state: u\.state === "failed" \? "failed" : "uploading"/);
  /* Bounded, because it is a list a client chooses the length of. */
  assert.match(src, /\.slice\(0, 50\)/);
});

test("only the submitter may say what is still coming", { skip }, () => {
  /* Nobody else has an upload of their own to report on, and this field
     decides whether their reviewer may act. */
  const src = service();
  assert.match(src, /async function setSubmissionUploads\(\{ taskId, employeeId, uploads \}\)/);
  assert.match(
    src,
    /if \(sub\.submittedBy !== employeeId\) throw new Error\("Only the person who submitted can report on its uploads\."\)/,
  );
});

test("it writes one field and cannot touch the submission itself", { skip }, () => {
  /**
   * The safety of the whole feature rests here. A route that could rewrite a
   * submission from the browser would be a far worse defect than the one this
   * closes — so it updates a single nested field by path, never the record.
   */
  const src = service();
  const fn = src.slice(
    src.indexOf("async function setSubmissionUploads"),
    src.indexOf("module.exports"),
  );
  assert.match(fn, /"completionSubmission\.pendingUploads": _readPendingUploads\(uploads\)/);
  assert.doesNotMatch(fn, /completionStatus/, "it can move the task's status");
  assert.doesNotMatch(fn, /completionSubmission:/, "it can replace the submission");
});

test("the route exists, behind the same two checks as the submission", { skip }, () => {
  assert.match(
    routes(),
    /router\.post\("\/task\/:taskId\/submission-uploads", verifyCoworkToken, verifyEmployeeToken/,
  );
  /* A body that is not a list is an empty list, not a crash. */
  assert.match(routes(), /Array\.isArray\(req\.body\?\.uploads\) \? req\.body\.uploads : \[\]/);
});
