import assert from "node:assert/strict";
import test from "node:test";

import { isProjectContainer } from "./completion.ts";

/**
 * When a task becomes a container.
 *
 * The rule decides whether a task shows its own timer and deadline, so getting
 * it wrong is not cosmetic in either direction: false when it should be true
 * offers the parent's owner a Start button for work that lives on its children,
 * and true when it should be false takes the timer away from an ordinary task.
 */

test("an ordinary task is not a container", () => {
  assert.equal(
    isProjectContainer({ isProject: false, loadedSubtasks: 0 }),
    false,
  );
});

test("a task with children read by the repository is a container", () => {
  assert.equal(
    isProjectContainer({ isProject: true, loadedSubtasks: 0 }),
    true,
  );
});

test("children on screen make it a container even where the derived flag says no", () => {
  /* The read that returned the parent but not its children. Rendering a timer
     here is what put a Start button on a project. */
  assert.equal(
    isProjectContainer({ isProject: false, loadedSubtasks: 3 }),
    true,
  );
});

test("both signals agreeing is still one container", () => {
  assert.equal(isProjectContainer({ isProject: true, loadedSubtasks: 2 }), true);
});
