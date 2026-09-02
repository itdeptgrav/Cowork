/**
 * Splitting one pooled submission into the attempts it really was.
 *
 * ## Why this exists
 *
 * The legacy engine keeps a SINGLE `completionSubmission` per task and
 * overwrites it on every resubmit — see `listSubmissions`, which returns one
 * record with `attempt: 1` and the note "counting resubmissions would need a
 * history legacy does not keep". Its files live under one fixed submission id,
 * so a file from attempt 1 and a file from attempt 2 land in the same bucket and
 * read as one submission with several files — the confusion a reviewer hits:
 * what was sent first, and what was sent after the rework?
 *
 * ## Reconstructing the attempts
 *
 * The history the engine dropped is still in the timestamps. A submit uploads
 * its files in one tight burst; a resubmission comes minutes later, after the
 * person has fixed the work. So a **gap** between consecutive uploads marks the
 * boundary between attempts, and a **rework** (where one was recorded) marks it
 * too — either signal starts a new attempt. This works even when no rework
 * record comes back, which is exactly the case that left three files reading as
 * one submission.
 *
 * It is a heuristic, and honest about being one: two resubmissions inside the
 * gap window, with no rework recorded between them, would read as one attempt.
 * In the ordinary flow — submit, wait for review, fix, resubmit — the uploads
 * are far enough apart that the split is clean.
 */

/** The minimum a file needs to be placed: when it was uploaded. */
export interface DatedFile {
  uploadedAt?: string | null;
}

/** The minimum a rework needs to be a boundary: when it was requested. */
export interface DatedRework {
  requestedAt: string;
}

export interface SubmissionAttempt<F, R> {
  /** 1-based attempt number, oldest first. */
  attempt: number;
  /** The files uploaded during this attempt. */
  files: F[];
  /**
   * The rework that ENDED this attempt, where one was recorded in the gap after
   * it. Null for the current attempt, and null for an earlier attempt whose
   * boundary was a time gap with no rework record.
   */
  rework: R | null;
  /** True for the last attempt — the one still current. */
  isCurrent: boolean;
}

export interface ClusterOptions {
  /**
   * A gap between two consecutive uploads longer than this starts a new
   * attempt. One submit's files arrive within seconds; a resubmission is
   * minutes later. Two minutes separates the two without merging a slow single
   * upload.
   */
  gapMs?: number;
}

const ms = (iso: string): number => new Date(iso).getTime();

/**
 * Cluster pooled files into the attempts they were submitted in.
 *
 * A new attempt begins where either the time since the previous upload exceeds
 * `gapMs`, or a rework was requested between the two uploads. Files with no
 * upload time cannot be placed on the timeline, so they join the current
 * attempt — the safe end, since that is the one a reader is acting on. With one
 * burst of files and nothing to break it, the result is a single current
 * attempt: exactly the one submission it has always been.
 */
export function clusterSubmissionAttempts<F extends DatedFile, R extends DatedRework>(
  files: readonly F[],
  reworks: readonly R[],
  opts: ClusterOptions = {},
): SubmissionAttempt<F, R>[] {
  const gapMs = opts.gapMs ?? 2 * 60_000;

  const dated = files
    .filter((f): f is F & { uploadedAt: string } => Boolean(f.uploadedAt))
    .slice()
    .sort((a, b) => ms(a.uploadedAt) - ms(b.uploadedAt));
  const undated = files.filter((f) => !f.uploadedAt);
  const bounds = [...reworks].sort((a, b) => ms(a.requestedAt) - ms(b.requestedAt));

  /* Each group is a run of uploads with no boundary inside it, tagged with the
     rework that closed it (the one requested in the gap that follows). */
  const groups: { files: F[]; rework: R | null }[] = [];
  let current: F[] = [];

  for (const file of dated) {
    if (current.length > 0) {
      const prev = current[current.length - 1] as F & { uploadedAt: string };
      const gap = ms(file.uploadedAt) - ms(prev.uploadedAt);
      const reworkBetween =
        bounds.find(
          (rw) =>
            ms(rw.requestedAt) > ms(prev.uploadedAt) &&
            ms(rw.requestedAt) <= ms(file.uploadedAt),
        ) ?? null;
      if (gap > gapMs || reworkBetween) {
        groups.push({ files: current, rework: reworkBetween });
        current = [];
      }
    }
    current.push(file);
  }
  /* The last run — plus any undated files — is the current attempt. */
  groups.push({ files: [...current, ...undated], rework: null });

  return groups.map((g, i) => ({
    attempt: i + 1,
    files: g.files,
    rework: g.rework,
    isCurrent: i === groups.length - 1,
  }));
}
