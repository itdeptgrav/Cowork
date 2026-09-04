import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { LOCAL_ORIGIN, applyRemoteEvents, captureEvent, docIsEmpty, keyOf, mapsOf, peersFrom, pushLocalChanges, readDoc, seedDoc, type RemoteEvent } from "./collabSync";
import { createWorkbook, createWorksheet, setCellValue, setCellStyleId, type Workbook, type Worksheet } from "./model";
import { parseCellRef } from "./coordinates";

const at = (ref: string) => parseCellRef(ref)!;
const put = (ws: Worksheet, ref: string, value: string): Worksheet => setCellValue(ws, at(ref).row, at(ref).col, value);
const styled = (ws: Worksheet, ref: string, id: number): Worksheet => setCellStyleId(ws, at(ref).row, at(ref).col, id);
import { StyleRegistry } from "./style";

/** Two clients on one doc: updates from A are applied to B, as the relay does. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "relay") Y.applyUpdate(b, u, "relay");
  });
  b.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "relay") Y.applyUpdate(a, u, "relay");
  });
  return { a, b };
}

/** Collect the map events a doc's observers see, tagged by origin. */
function watch(doc: Y.Doc) {
  const batches: { origin: unknown; tr: Y.Transaction; events: RemoteEvent[] }[] = [];
  const maps = mapsOf(doc);
  for (const m of [maps.cells, maps.styles, maps.sheets, maps.workbook]) {
    m.observe((event, tr) => {
      const captured = captureEvent(event, maps);
      if (!captured) return;
      const last = batches[batches.length - 1];
      if (last && last.tr === tr) last.events.push(captured);
      else batches.push({ origin: tr.origin, tr, events: [captured] });
    });
  }
  return batches;
}

function withCell(wb: Workbook, ref: string, value: string): Workbook {
  const ws = wb.worksheets[0];
  const next = put(ws, ref, value);
  return { ...wb, worksheets: [next, ...wb.worksheets.slice(1)] };
}

test("seeding and reading a doc round-trips a workbook, styles by value", () => {
  const reg = new StyleRegistry();
  let wb = createWorkbook();
  wb = withCell(wb, "A1", "10");
  wb = withCell(wb, "B2", "=A1*2");
  const bold = reg.intern({ bold: true });
  wb = { ...wb, worksheets: [styled(wb.worksheets[0], "A1", bold)] };
  wb = { ...wb, names: [{ name: "Total", sheetId: wb.worksheets[0].id, range: { top: 0, left: 0, bottom: 0, right: 0 } }] };

  const doc = new Y.Doc();
  assert.equal(docIsEmpty(mapsOf(doc)), true);
  seedDoc(doc, wb, reg);
  assert.equal(docIsEmpty(mapsOf(doc)), false);

  const otherReg = new StyleRegistry();
  const back = readDoc(doc, otherReg);
  assert.deepEqual(Object.keys(back.worksheets[0].cells).sort(), ["A1", "B2"]);
  assert.equal(back.worksheets[0].cells.B2.value, "=A1*2");
  assert.deepEqual(otherReg.get(back.worksheets[0].cellStyles.A1), { bold: true }, "the style travelled as a value");
  assert.deepEqual(back.names, wb.names);
});

test("one keystroke is one key written, and the other client applies it", () => {
  const { a, b } = pair();
  const regA = new StyleRegistry();
  const regB = new StyleRegistry();
  let wbA = withCell(createWorkbook(), "A1", "1");
  seedDoc(a, wbA, regA);
  let wbB = readDoc(b, regB);
  const seen = watch(b);

  const next = withCell(wbA, "A2", "2");
  const writes = pushLocalChanges(a, wbA, next, regA);
  wbA = next;
  assert.equal(writes, 1);

  const remote = seen.filter((x) => x.origin !== LOCAL_ORIGIN);
  assert.equal(remote.length, 1);
  const applied = applyRemoteEvents(remote[0].events, b, wbB, regB);
  wbB = applied.workbook;
  assert.equal(wbB.worksheets[0].cells.A2.value, "2");
  assert.deepEqual(applied.change.cells, [{ sheetId: wbB.worksheets[0].id, row: 1, col: 0, value: "2" }]);
  assert.equal(applied.change.structural, false);
});

test("clearing a cell, styling one, and renaming a sheet all cross over", () => {
  const { a, b } = pair();
  const regA = new StyleRegistry();
  const regB = new StyleRegistry();
  let wbA = withCell(withCell(createWorkbook(), "A1", "x"), "A2", "y");
  seedDoc(a, wbA, regA);
  let wbB = readDoc(b, regB);
  const seen = watch(b);

  let next = withCell(wbA, "A2", "");
  const italic = regA.intern({ italic: true, color: "#f00" });
  next = { ...next, worksheets: [{ ...styled(next.worksheets[0], "A1", italic), name: "Budget" }] };
  pushLocalChanges(a, wbA, next, regA);
  wbA = next;

  for (const batch of seen.filter((x) => x.origin !== LOCAL_ORIGIN)) {
    const r = applyRemoteEvents(batch.events, b, wbB, regB);
    wbB = r.workbook;
    assert.equal(r.change.structural, true, "a renamed sheet is structural");
  }
  assert.equal(wbB.worksheets[0].cells.A2, undefined);
  assert.deepEqual(regB.get(wbB.worksheets[0].cellStyles.A1), { italic: true, color: "#f00" });
  assert.equal(wbB.worksheets[0].name, "Budget");
});

test("a sheet added on one side appears with its cells on the other; a removed one goes", () => {
  const { a, b } = pair();
  const regA = new StyleRegistry();
  const regB = new StyleRegistry();
  let wbA = withCell(createWorkbook(), "A1", "1");
  seedDoc(a, wbA, regA);
  let wbB = readDoc(b, regB);
  const seen = watch(b);

  const extra = put(createWorksheet("sheet-2", "Costs"), "C3", "42");
  let next: Workbook = { ...wbA, worksheets: [...wbA.worksheets, extra] };
  pushLocalChanges(a, wbA, next, regA);
  wbA = next;
  for (const batch of seen.splice(0).filter((x) => x.origin !== LOCAL_ORIGIN)) wbB = applyRemoteEvents(batch.events, b, wbB, regB).workbook;
  assert.deepEqual(wbB.worksheets.map((w) => w.name), ["Sheet1", "Costs"]);
  assert.equal(wbB.worksheets[1].cells.C3.value, "42");

  next = { ...wbA, worksheets: [wbA.worksheets[1]], activeSheetId: "sheet-2" };
  pushLocalChanges(a, wbA, next, regA);
  for (const batch of seen.splice(0).filter((x) => x.origin !== LOCAL_ORIGIN)) wbB = applyRemoteEvents(batch.events, b, wbB, regB).workbook;
  assert.deepEqual(wbB.worksheets.map((w) => w.id), ["sheet-2"]);
  assert.equal(mapsOf(b).cells.get(keyOf("sheet-1", "A1")), undefined, "the removed sheet's cells are gone from the doc");
});

test("two people typing in different cells at once both keep their edits", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const regA = new StyleRegistry();
  const regB = new StyleRegistry();
  let wbA = withCell(createWorkbook(), "A1", "1");
  seedDoc(a, wbA, regA);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  let wbB = readDoc(b, regB);

  /* Offline edits on both sides. */
  const nextA = withCell(wbA, "A2", "from A");
  pushLocalChanges(a, wbA, nextA, regA);
  wbA = nextA;
  const nextB = withCell(wbB, "B1", "from B");
  pushLocalChanges(b, wbB, nextB, regB);
  wbB = nextB;

  /* Then they sync. */
  const seenA = watch(a);
  const seenB = watch(b);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "relay");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "relay");
  for (const batch of seenA.filter((x) => x.origin === "relay")) wbA = applyRemoteEvents(batch.events, a, wbA, regA).workbook;
  for (const batch of seenB.filter((x) => x.origin === "relay")) wbB = applyRemoteEvents(batch.events, b, wbB, regB).workbook;
  assert.deepEqual(wbA.worksheets[0].cells, wbB.worksheets[0].cells);
  assert.equal(wbA.worksheets[0].cells.A2.value, "from A");
  assert.equal(wbA.worksheets[0].cells.B1.value, "from B");
});

test("names and the sheet order travel through the workbook map", () => {
  const { a, b } = pair();
  const regA = new StyleRegistry();
  const regB = new StyleRegistry();
  const wbA = createWorkbook();
  seedDoc(a, wbA, regA);
  let wbB = readDoc(b, regB);
  const seen = watch(b);
  const next: Workbook = { ...wbA, names: [{ name: "Sales", sheetId: wbA.worksheets[0].id, range: { top: 0, left: 0, bottom: 9, right: 0 } }] };
  pushLocalChanges(a, wbA, next, regA);
  for (const batch of seen.filter((x) => x.origin !== LOCAL_ORIGIN)) {
    const r = applyRemoteEvents(batch.events, b, wbB, regB);
    wbB = r.workbook;
    assert.equal(r.change.namesChanged, true);
  }
  assert.equal(wbB.names?.[0].name, "Sales");
});

test("peers are read from awareness states, skipping self and the unplaced", () => {
  const states = new Map<number, Record<string, unknown>>([
    [1, { user: { name: "Me", color: "#000" }, sheet: { sheetId: "s1", row: 0, col: 0, range: { top: 0, left: 0, bottom: 0, right: 0 } } }],
    [2, { user: { name: "Asha", color: "#abc" }, sheet: { sheetId: "s1", row: 3, col: 2, range: { top: 3, left: 2, bottom: 5, right: 2 } } }],
    [3, { user: { name: "Bo" } }],
  ]);
  const peers = peersFrom(states, 1);
  assert.deepEqual(peers.map((p) => [p.name, p.color, p.row, p.col, p.range.bottom]), [["Asha", "#abc", 3, 2, 5]]);
});
