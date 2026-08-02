/**
 * A word-level diff between two strings, for the preview a person sees before
 * they apply a rewrite.
 *
 * ## Why word-level, not character-level
 *
 * A character diff on prose is unreadable — "teh" → "the" shows as three
 * single-letter edits scattered through the word instead of one changed
 * word, and a whole-paragraph rewrite renders as an illegible field of red
 * and green fragments. A person deciding whether to accept an AI edit needs
 * to read the SHAPE of the change — which sentences moved, which words
 * changed — not verify it letter by letter.
 *
 * ## Why this, and not a library
 *
 * The standard algorithm (longest common subsequence over the two token
 * arrays) is short enough to own, and every input here is a paragraph or a
 * short selection — never a whole document, per the product's own "send the
 * minimum context" rule, so quadratic LCS cost is never a real concern.
 */

export type DiffOp = { kind: "same" | "add" | "remove"; text: string };

/** Splits on whitespace, keeping the whitespace as its own token so it survives the diff untouched. */
function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [];
}

/**
 * The diff, as a flat list of operations in reading order.
 *
 * Consecutive tokens of the same kind are merged, so the caller renders one
 * `<span>` per changed run rather than one per word.
 */
export function wordDiff(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);

  /* Classic LCS table. `lcs[i][j]` is the length of the longest common
     subsequence of `a[i:]` and `b[j:]`. */
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  const push = (kind: DiffOp["kind"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.kind === kind) last.text += text;
    else ops.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push("remove", a[i]!);
      i++;
    } else {
      push("add", b[j]!);
      j++;
    }
  }
  while (i < a.length) {
    push("remove", a[i]!);
    i++;
  }
  while (j < b.length) {
    push("add", b[j]!);
    j++;
  }

  return ops;
}

/** How much of the text actually changed, 0–1 — used to decide whether a change counts as "large". */
export function diffChangeRatio(before: string, after: string): number {
  const ops = wordDiff(before, after);
  const totalChars = ops.reduce((n, op) => n + op.text.length, 0);
  if (totalChars === 0) return 0;
  const changedChars = ops
    .filter((op) => op.kind !== "same")
    .reduce((n, op) => n + op.text.length, 0);
  return changedChars / totalChars;
}
