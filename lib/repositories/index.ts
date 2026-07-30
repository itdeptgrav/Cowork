/**
 * Repository selection.
 *
 * The single place that knows which implementation is in use. Swapping to a
 * production API is a one-line change here plus a new class satisfying
 * `CoworkRepository` — no component, hook or page changes.
 */

import type { CoworkRepository } from "./types";
import { mockRepository } from "./mock";

export type { CoworkRepository } from "./types";
export * from "./types";

let current: CoworkRepository = mockRepository;

export function getRepository(): CoworkRepository {
  return current;
}

/** Used by tests and, later, by the production bootstrap. */
export function setRepository(repo: CoworkRepository): void {
  current = repo;
}
