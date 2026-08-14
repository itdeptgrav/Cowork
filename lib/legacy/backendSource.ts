import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the engine's source is, on whichever machine this is running on.
 *
 * ## Why this exists
 *
 * A dozen test files each hardcoded `/Users/risheeray/Documents/cowork-old-backend`.
 * On any other checkout that path does not exist, and the two ways that
 * manifested were both bad:
 *
 *  · Files with an `available()` guard **skipped every test in them**, and a
 *    skip reports as success. Assertions about the engine's routing, its
 *    permission gates and its payload shapes were simply not being made, and
 *    nothing said so.
 *  · Files without a guard threw `ENOENT` and failed for a reason that looked
 *    like a broken test rather than a missing checkout.
 *
 * Both hid real information. The point of these tests is that this app and the
 * engine agree about shapes neither of them owns alone — a claim that is worth
 * nothing if it is only checked on one person's laptop.
 *
 * ## Resolution order
 *
 * `COWORK_BACKEND` first, so a machine with the checkout anywhere can say so
 * without editing source. Then the known locations. A machine with none of them
 * still reports unavailable, and callers still skip — which is honest, and is
 * now the only case where skipping happens.
 */

const CANDIDATES = [
  process.env.COWORK_BACKEND,
  "D:/GRAV_Project/grav-cms-backend",
  "/Users/risheeray/Documents/cowork-old-backend",
  "/Users/risheeray/grav-cms-backend",
];

/** A file that must exist in any real checkout, used to recognise one. */
const MARKER = "routes/task_routes/taskForward.js";

function locate(): string | null {
  for (const dir of CANDIDATES) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, MARKER)).isFile()) return dir;
    } catch {
      /* Not this one. Never a reason to throw — the caller's `available()`
         check is what turns absence into a skip. */
    }
  }
  return null;
}

/** The engine checkout, or null where this machine has none. */
export const BACKEND: string | null = locate();

/** Whether the engine's source can be read at all. Callers skip when false. */
export function backendAvailable(): boolean {
  return BACKEND !== null;
}

/**
 * One engine file, comments stripped and line endings normalised.
 *
 * **`\r\n` → `\n` matters.** These tests match multi-line shapes, and a Windows
 * checkout stores the engine with CRLF endings — so assertions that were
 * correct about the code failed on invisible characters. That is the same class
 * of false negative as the missing path: a test reporting a fault that is not
 * there teaches people to ignore it.
 *
 * Throws where the backend is absent, deliberately: a caller reaching here
 * without checking `backendAvailable()` has a bug, and a silent empty string
 * would make every assertion below it pass.
 */
export function backendSource(relativePath: string): string {
  if (!BACKEND) {
    throw new Error(
      "The engine checkout was not found. Set COWORK_BACKEND, or guard this test with backendAvailable().",
    );
  }
  const full = join(BACKEND, relativePath);
  if (!existsSync(full)) {
    throw new Error(`The engine has no file at ${relativePath}.`);
  }
  return readFileSync(full, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
