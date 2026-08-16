/**
 * The spreadsheet engine — a pure, DOM-free layer the UI renders.
 *
 * Nothing here imports React. The engine owns the model (Workbook → Worksheet →
 * sparse cells), the addressing (A1 ↔ coordinates), the geometry
 * (virtualization maths), and the selection calculations. The UI reads it and
 * dispatches to it; it never reaches the other way.
 */

export * from "./coordinates";
export * from "./metrics";
export * from "./model";
export * from "./selection";
export * from "./values";
export * from "./editor";
export * from "./clipboard";
export * from "./fill";
export * from "./history";
export * from "./style";
export * from "./format";
export * from "./structure";
export * from "./workbook";
export * from "./sort";
export * from "./filter";
export * from "./validation";
export * from "./conditional";
export * from "./merge";
export * from "./search";
export * from "./hyperlink";
export * from "./comments";
export * from "./datatools";
export * from "./csvio";
export * from "./jsonio";
/* Note: `xlsxio` is intentionally NOT re-exported — it pulls in the ~1 MB
   SheetJS library, so it is imported directly (and lazily) by the one caller
   that needs it, keeping the library out of the common bundle. */
