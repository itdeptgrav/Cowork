import { NextResponse, type NextRequest } from "next/server";
import { youtubeProvider } from "@/lib/music/youtube";
import { MusicError } from "@/lib/music/errors";
import { fail, guard, readPageToken, readQuery } from "../_shared";

/**
 * Music search. The expensive one — 100 quota units per uncached call, against a
 * 10,000/day project ceiling.
 *
 * Node runtime and force-dynamic: the key is read at request time from the
 * server environment, and a response carrying someone's query must never be
 * statically cached.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const params = req.nextUrl.searchParams;
  const q = readQuery(params.get("q"));
  if (q.length < 2) {
    return fail(new MusicError("invalid_query", "Type at least two characters to search."));
  }

  // No `type` parameter: this endpoint searches music. A mode switch is how a
  // music search quietly becomes a video search.
  try {
    const page = await youtubeProvider.search(
      { q, pageToken: readPageToken(params.get("pageToken")) },
      req.signal,
    );
    return NextResponse.json(page, {
      // Private — the query belongs to the person who typed it. The short
      // window only blunts double submits.
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    return fail(e);
  }
}
