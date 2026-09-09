/**
 * Send a batch of staged files, together rather than one after another.
 *
 * ## The wait this removes
 *
 * Two places attach files to a record that must exist first — a new task and a
 * submission — and both wrote the same loop:
 *
 * ```ts
 * for (const file of staged) {
 *   const up = await repo.uploadAttachment({ ... });
 *   if (!up.ok) failed.push(file.name);
 * }
 * ```
 *
 * That `await` inside the `for` is the whole cost. Nothing about one upload
 * decides another — each is an independent write against a record that already
 * exists — so the loop was paying the full round trip N times end to end while
 * the person watched a button spin. Four reference files on a new task is four
 * India-to-server round trips, in series, after the create round trip they had
 * already waited through.
 *
 * ## Why a limit rather than all at once
 *
 * `Promise.all` over every file is the obvious version and it is wrong at the
 * edges: attachments here have no size cap at all (`MAX_BYTES` is null), so
 * "all at once" can mean ten large videos opening ten sockets on a connection
 * that cannot carry them, which is slower than the loop it replaced and starves
 * everything else the page is doing. A small pool takes the round-trip latency
 * out — the part that was actually being paid N times — without pretending the
 * link has unlimited bandwidth.
 *
 * ## What it guarantees
 *
 * The names of whatever failed, **in the order they were staged**, so the
 * message naming them reads in the order the person sees them on screen rather
 * than in the order the network happened to finish. Nothing throws: an upload
 * that rejects outright counts as a failure exactly like one that answers
 * `ok: false`, because both mean the same thing to the reader — that file is
 * not on the record.
 *
 * A failure never cancels the rest. The record already exists and the other
 * files belong on it; stopping at the first bad one would strand files that
 * would have gone up perfectly well.
 */

/** How many uploads may be open at once. See the note above on why not all. */
const CONCURRENCY = 3;

export async function uploadAll<F extends { name: string }>(
  files: readonly F[],
  upload: (file: F) => Promise<{ ok: boolean }>,
  concurrency: number = CONCURRENCY,
): Promise<string[]> {
  if (files.length === 0) return [];

  /* Indexed rather than pushed, so the result is staging order and not
     completion order — with a pool those two genuinely differ. */
  const failed: (string | null)[] = new Array(files.length).fill(null);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= files.length) return;
      const file = files[index];
      try {
        const result = await upload(file);
        if (!result.ok) failed[index] = file.name;
      } catch {
        /* A rejection and an `ok: false` mean the same thing here: that file is
           not on the record. The reader is told which, not which way it went
           wrong — and one bad file must not take the batch down with it. */
        failed[index] = file.name;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, worker),
  );

  return failed.filter((name): name is string => name !== null);
}
