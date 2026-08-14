import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolve the `@/*` path alias for `node --test`.
 *
 * ## Why this exists
 *
 * `tsconfig.json` maps `@/*` to the project root, and every tool that reads a
 * tsconfig honours it — the Next build, `tsc`, the editor. Node does not: it
 * strips TypeScript types but performs ordinary ESM resolution, and `@/lib`
 * looks to it like a package that is not installed.
 *
 * The cost was silent and specific. Any test importing a module that uses the
 * alias — `lib/repositories/legacy/index.ts` does, on its very first line —
 * failed with "Cannot find package '@/lib'". FIVE tests were failing that way,
 * and one of them was masking a real defect that could not surface because the
 * module never loaded at all. Tests that only read source as text passed, which
 * is why the gap survived: the failures looked like a handful of unrelated
 * cases rather than one missing capability.
 *
 * ## Why a hook rather than a different runner
 *
 * `tsx` resolves the alias and would fix this by itself, but it is not a
 * dependency of this project — it has been arriving through `npx` on demand.
 * Adding a runner to make the existing runner's resolution work is a larger
 * change than teaching it the one rule it is missing.
 *
 * ## Why the extension probing
 *
 * Node's ESM resolver does not guess extensions: `@/lib/domain` maps to a
 * directory with no `domain.ts` beside it, so the bare path resolves to
 * nothing. TypeScript's own resolution does guess, which is why the source is
 * written this way. This reproduces that one behaviour and no other.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* In the order TypeScript itself would try them. `.ts` before `.tsx` because a
   module importable from a test is far more often the former, and `index` last
   because a file always beats a directory of the same name. */
const CANDIDATES = [
  (p) => p,
  (p) => `${p}.ts`,
  (p) => `${p}.tsx`,
  (p) => path.join(p, "index.ts"),
  (p) => path.join(p, "index.tsx"),
];

function firstFile(base) {
  for (const candidate of CANDIDATES) {
    const full = candidate(base);
    try {
      if (existsSync(full) && statSync(full).isFile()) return full;
    } catch {
      /* Unreadable is not a match. Never a reason to fail resolution — the
         caller falls through to Node's own, which reports it properly. */
    }
  }
  return null;
}

/** Where a specifier points, as a filesystem path, or null if not a file one. */
function baseFor(specifier, parentURL) {
  if (specifier.startsWith("@/")) return path.join(ROOT, specifier.slice(2));
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    if (!parentURL) return null;
    try {
      return fileURLToPath(new URL(specifier, parentURL));
    } catch {
      return null;
    }
  }
  /* A bare specifier is a package. Not ours to guess at. */
  return null;
}

/**
 * Two rules TypeScript has and Node does not: the `@/*` alias, and extensionless
 * imports.
 *
 * Node's own resolution is tried FIRST and its answer is preferred wherever it
 * has one — so an import that already works keeps working, and this file cannot
 * quietly shadow a real module with a file it guessed at. Only
 * `ERR_MODULE_NOT_FOUND` is caught; every other failure is somebody's real
 * problem and is rethrown untouched.
 *
 * Extensionless RELATIVE imports need this as much as the alias does. The
 * source is full of them — `lib/domain/index.ts` opens with `./identity` — and
 * they are resolved by tsc, by Next and by editors, so they are correct code.
 * They only fail here, and only because this runner is stricter than every
 * other tool that reads the same files.
 */
export async function resolve(specifier, context, next) {
  const aliased = specifier.startsWith("@/");
  if (aliased) {
    const found = firstFile(path.join(ROOT, specifier.slice(2)));
    if (found) return next(pathToFileURL(found).href, context);
  }

  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    const base = baseFor(specifier, context.parentURL);
    const found = base ? firstFile(base) : null;
    /* Nothing found means nothing to say — rethrow Node's own error, which
       names the specifier as written rather than a path invented from it. */
    if (!found) throw error;
    return next(pathToFileURL(found).href, context);
  }
}
