import { NextResponse } from "next/server";
import {
  workbookPrincipal,
  workbookEmployeeId,
} from "@/lib/server/workbookPrincipal";
import { workbookStore } from "@/lib/server/workbookStore";
import type { SerializedWorkbook } from "@/lib/spreadsheet/persistence";

/**
 * The workbook collection: list the caller's workbooks, and create one.
 *
 * Both are scoped to the verified caller — a listing only ever returns the
 * caller's own workbooks, and a new one is owned by them. MongoDB (through this
 * Node route) is never reached by the browser; the browser holds a cookie, the
 * route holds the identity.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A minimal shape check — enough that a malformed body is a 400, not a 500. */
function isSerializedWorkbook(v: unknown): v is SerializedWorkbook {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as SerializedWorkbook).sheets) &&
    Array.isArray((v as SerializedWorkbook).styles)
  );
}

export async function GET(request: Request) {
  const principal = await workbookPrincipal(request);
  if (!principal) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  try {
    /* Owned workbooks are found by the owner id; a workbook shared with this
       person by NAME is found by their directory employee id, so the listing
       spans both. The employee id costs a resolve (a `/cowork/me` round trip on
       the Firebase path); a listing is not the hot path, so it is paid here. */
    const employeeId = await workbookEmployeeId(request);
    const ids = employeeId ? [principal.ownerId, employeeId] : [principal.ownerId];
    const workbooks = await workbookStore.listForPrincipal(ids);
    /* The owner id is internal — the client never needs to see it. `access` says
       whether each row is theirs or shared with them, and `shares` (present only
       on rows they OWN — the store scopes it) is what the collaborators panel
       reads back, so a share survives a refresh instead of vanishing from view. */
    return NextResponse.json(
      {
        workbooks: workbooks.map((w) => ({
          id: w.id,
          title: w.title,
          revision: w.revision,
          createdAt: w.createdAt,
          updatedAt: w.updatedAt,
          access: w.access,
          ...(w.shares ? { shares: w.shares } : {}),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Storage is unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const principal = await workbookPrincipal(request);
  if (!principal) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { title?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isSerializedWorkbook(body.data)) {
    return NextResponse.json({ error: "Missing or invalid workbook data." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title : "Untitled workbook";

  try {
    const record = await workbookStore.create({ ownerId: principal.ownerId, title, data: body.data });
    return NextResponse.json(
      { id: record.id, title: record.title, revision: record.revision, updatedAt: record.updatedAt },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: "Storage is unavailable." }, { status: 500 });
  }
}
