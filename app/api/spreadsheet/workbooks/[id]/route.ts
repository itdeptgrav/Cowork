import { NextResponse } from "next/server";
import { accessWorkbook } from "@/lib/server/workbookAccess";
import { WorkbookConflict, workbookStore } from "@/lib/server/workbookStore";
import type { SerializedWorkbook } from "@/lib/spreadsheet/persistence";

/**
 * One workbook: load it (GET), save new content (PUT), rename it (PATCH), or
 * delete it (DELETE). Every method authorizes through `accessWorkbook`, so the
 * caller only ever touches a workbook they own; the errors it can return —
 * unauthorized, not-found, conflict, storage-failure — are the ones the client
 * repository is built to handle.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSerializedWorkbook(v: unknown): v is SerializedWorkbook {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as SerializedWorkbook).sheets) &&
    Array.isArray((v as SerializedWorkbook).styles)
  );
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await accessWorkbook(request, id);
  if (!access.ok) return access.response;
  const { record } = access;
  return NextResponse.json(
    { id: record.id, title: record.title, revision: record.revision, data: record.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await accessWorkbook(request, id);
  if (!access.ok) return access.response;

  let body: { data?: unknown; baseRevision?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isSerializedWorkbook(body.data)) {
    return NextResponse.json({ error: "Missing or invalid workbook data." }, { status: 400 });
  }
  const baseRevision =
    typeof body.baseRevision === "number" ? body.baseRevision : access.record.revision;

  try {
    const updated = await workbookStore.save({ id, data: body.data, baseRevision });
    if (!updated) return NextResponse.json({ error: "Workbook not found." }, { status: 404 });
    return NextResponse.json({ revision: updated.revision, updatedAt: updated.updatedAt });
  } catch (err) {
    if (err instanceof WorkbookConflict) {
      /* The client re-reads and merges, or offers to overwrite. */
      return NextResponse.json(
        { error: "The workbook was changed elsewhere.", currentRevision: err.currentRevision },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Storage is unavailable." }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await accessWorkbook(request, id);
  if (!access.ok) return access.response;

  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.title !== "string" || body.title.trim() === "") {
    return NextResponse.json({ error: "A title is required." }, { status: 400 });
  }

  try {
    const updated = await workbookStore.rename(id, body.title);
    if (!updated) return NextResponse.json({ error: "Workbook not found." }, { status: 404 });
    return NextResponse.json({ title: updated.title, updatedAt: updated.updatedAt });
  } catch {
    return NextResponse.json({ error: "Storage is unavailable." }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await accessWorkbook(request, id);
  if (!access.ok) return access.response;
  try {
    await workbookStore.remove(id);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Storage is unavailable." }, { status: 500 });
  }
}
