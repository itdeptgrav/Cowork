import { SheetsArea } from "@/components/features/spreadsheet/SheetsArea";

/**
 * The spreadsheet surface, full-bleed.
 *
 * No page heading: the browser names itself, and an open workbook carries its
 * own title, so a "Spreadsheet" above either named the thing twice. The sheet
 * takes that space instead. `sheet-fullbleed` (globals.css) breaks the route out
 * of the shell's centred column — every column the grid cannot show is one you
 * have to scroll to.
 */
export default function Page() {
  return (
    <div className="sheet-fullbleed sheet-light p-3">
      <SheetsArea />
    </div>
  );
}
