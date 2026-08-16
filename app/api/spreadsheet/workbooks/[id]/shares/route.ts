import { NextResponse } from "next/server";
import { accessWorkbook } from "@/lib/server/workbookAccess";
import { workbookStore, type ShareGrant, type ShareRole } from "@/lib/server/workbookStore";

/**
 * Who a workbook is shared with: read the grants (GET) or replace them (PUT).
 *
 * Both go through `accessWorkbook` with the `"own"` intent, so only the OWNER
 * can see or change the share list — a person the workbook was shared with can
 * open it, but cannot discover who else holds it or hand it on. The store is
 * what refuses to grant the owner a role or to store an unknown one; this layer
 * only has to establish who is asking and hand over a well-formed list.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = new Set<ShareRole>(["viewer", "commenter", "editor"]);

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await accessWorkbook(request, id, "own");
  if (!access.ok) return access.response;
  return NextResponse.json({ shares: access.record.shares ?? [] });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await accessWorkbook(request, id, "own");
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const raw = (body as { shares?: unknown })?.shares;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected a shares array." }, { status: 400 });
  }

  /* Validate here rather than trusting the body: an unrecognised role must be a
     400, not silently dropped, so a client bug is visible instead of quietly
     granting nothing. */
  const shares: ShareGrant[] = [];
  for (const item of raw) {
    const principalId = (item as ShareGrant)?.principalId;
    const role = (item as ShareGrant)?.role;
    if (typeof principalId !== "string" || !principalId.trim()) {
      return NextResponse.json({ error: "Each share needs a principalId." }, { status: 400 });
    }
    if (!ROLES.has(role)) {
      return NextResponse.json({ error: `Unknown role: ${String(role)}.` }, { status: 400 });
    }
    shares.push({ principalId: principalId.trim(), role });
  }

  try {
    const updated = await workbookStore.setShares(id, shares);
    if (!updated) return NextResponse.json({ error: "Workbook not found." }, { status: 404 });
    return NextResponse.json({ shares: updated.shares ?? [] });
  } catch {
    return NextResponse.json({ error: "Couldn't update sharing." }, { status: 500 });
  }
}
