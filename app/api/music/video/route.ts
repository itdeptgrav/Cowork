import { NextResponse, type NextRequest } from "next/server";
import { youtubeProvider } from "@/lib/music/youtube";
import { fail, guard } from "../_shared";

/**
 * Batched video details — duration, embeddability, live state.
 *
 * One quota unit for up to fifty ids, which is why the client asks for a whole
 * page at once rather than a row at a time.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[\w-]{6,20}$/.test(s))
    .slice(0, 50);

  if (!ids.length) return NextResponse.json({ items: [] });

  try {
    const items = await youtubeProvider.getVideoDetails(ids, req.signal);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    return fail(e);
  }
}
