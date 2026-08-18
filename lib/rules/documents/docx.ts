/**
 * Writing a real `.docx`.
 *
 * **A .docx is a ZIP of XML parts, so this file builds both.** There is no zip
 * library in the project and adding one to export a document is a large
 * dependency for a small job, so the archive is written here — stored, never
 * compressed. A stored ZIP is perfectly valid, every reader accepts it, and it
 * removes the only genuinely hard part (DEFLATE) at the cost of file size that
 * nobody notices on a text document.
 *
 * The alternative that is usually reached for — an HTML file named `.doc` —
 * is not done here. Word opens it, but Google Docs and LibreOffice open it as
 * a web page, the file lies about what it is, and a reader who tries to edit
 * and re-save gets something stranger still. If the menu says Word, the file
 * is Word.
 *
 * Everything in this file is pure and byte-deterministic: the same document
 * exports to the same bytes, which is what makes it testable at all. The
 * timestamp is deliberately fixed for that reason — no reader displays it, and
 * a real clock would mean the output could only ever be eyeballed.
 */

/* ── units ──────────────────────────────────────────────────────────────── */

/** English Metric Units per CSS pixel at 96 DPI. Word measures pictures in these. */
export const EMU_PER_PX = 9525;
/** Twentieths of a point per CSS pixel. Word measures everything else in these. */
export const TWIPS_PER_PX = 15;

export const emu = (px: number) => Math.max(0, Math.round(px * EMU_PER_PX));
export const twips = (px: number) => Math.max(0, Math.round(px * TWIPS_PER_PX));

/* ── XML ────────────────────────────────────────────────────────────────── */

/**
 * Text made safe to put inside XML.
 *
 * Both quote forms are escaped because the same helper is used for attribute
 * values, where an unescaped quote ends the attribute and produces a file Word
 * refuses to open rather than one that merely looks wrong.
 */
export function xmlEscape(input: string): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    /* Control characters are not legal in XML at all; a stray one from a paste
       would make the whole file unreadable. Tab, newline and return are. */
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/* ── ZIP ────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 every ZIP entry is checked against. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
}

/** UTF-8 bytes of a string, for callers building entries. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * A ZIP archive with every entry stored rather than compressed.
 *
 * Written by hand because the only alternative was a dependency. The fixed
 * 1980-01-01 timestamp is what makes the output deterministic — see the file
 * comment.
 */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  /* 1980-01-01 00:00:00 in the DOS format ZIP uses — the earliest it can hold. */
  const DOS_TIME = 0;
  const DOS_DATE = 33;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const sum = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(entry.data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total =
    locals.reduce((n, l) => n + l.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/* ── the fixed parts of a .docx ─────────────────────────────────────────── */

/** Image kinds a picture can be embedded as, by file extension. */
export const DOCX_IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** The extension Word should store a picture under, from its MIME type. */
export function docxImageExt(mimeType: string): string {
  const mime = String(mimeType ?? "").toLowerCase().split(";")[0]!.trim();
  const hit = Object.entries(DOCX_IMAGE_TYPES).find(
    ([ext, m]) => m === mime && ext !== "jpg",
  );
  return hit ? hit[0] : "png";
}

/**
 * `[Content_Types].xml` — what every part in the archive is.
 *
 * Word reads this first, and a picture whose extension is not declared here is
 * a picture Word silently drops, so the extensions actually used are passed in
 * rather than guessed at.
 */
export function contentTypesXml(imageExts: readonly string[]): string {
  const defaults = Array.from(new Set(["rels", "xml", ...imageExts]))
    .map((ext) => {
      const type =
        ext === "rels"
          ? "application/vnd.openxmlformats-package.relationships+xml"
          : ext === "xml"
            ? "application/xml"
            : (DOCX_IMAGE_TYPES[ext] ?? "application/octet-stream");
      return `<Default Extension="${xmlEscape(ext)}" ContentType="${type}"/>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    defaults +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `</Types>`
  );
}

/** `_rels/.rels` — the one relationship that names the main document. */
export const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

export interface DocxRel {
  id: string;
  /** `hyperlink` links out of the file; `image` points at a part inside it. */
  kind: "hyperlink" | "image";
  target: string;
}

/** `word/_rels/document.xml.rels` — every link and picture the document uses. */
export function documentRelsXml(rels: readonly DocxRel[]): string {
  const fixed =
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`;

  const rest = rels
    .map((r) =>
      r.kind === "hyperlink"
        ? `<Relationship Id="${xmlEscape(r.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(r.target)}" TargetMode="External"/>`
        : `<Relationship Id="${xmlEscape(r.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xmlEscape(r.target)}"/>`,
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    fixed +
    rest +
    `</Relationships>`
  );
}

/**
 * `word/styles.xml`.
 *
 * Headings are real Word heading styles rather than "bold, a bit bigger": that
 * is what puts them in Word's navigation pane and what a table of contents is
 * built from, so a document whose structure survives the export is worth the
 * extra part.
 */
export const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>` +
  `</w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  [1, 2, 3, 4, 5, 6]
    .map((n) => {
      const size = [32, 26, 24, 22, 22, 22][n - 1]!;
      return (
        `<w:style w:type="paragraph" w:styleId="Heading${n}">` +
        `<w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/>` +
        `<w:pPr><w:outlineLvl w:val="${n - 1}"/>` +
        `<w:spacing w:before="240" w:after="120"/></w:pPr>` +
        `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`
      );
    })
    .join("") +
  `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>` +
  `<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>` +
  `<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="HTML Preformatted"/>` +
  `<w:pPr><w:shd w:val="clear" w:fill="F3F3F3"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr></w:style>` +
  `</w:styles>`;

/**
 * `word/numbering.xml` — one bulleted list definition and one numbered one.
 *
 * Without this part a list exports as ordinary paragraphs with no marker at
 * all, which is the usual way a converted document loses its structure.
 */
export const NUMBERING_XML = (() => {
  const levels = (bullet: boolean) =>
    Array.from({ length: 9 }, (_, i) => {
      const indent = 720 * (i + 1);
      return bullet
        ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>` +
            `<w:lvlText w:val="${["●", "○", "■"][i % 3]}"/>` +
            `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr>` +
            `<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl>`
        : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/>` +
            `<w:numFmt w:val="${["decimal", "lowerLetter", "lowerRoman"][i % 3]}"/>` +
            `<w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/>` +
            `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>` +
    `</w:numbering>`
  );
})();

/* ── the document body ──────────────────────────────────────────────────── */

export interface DocxRunFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Six hex digits, no leading hash. */
  color?: string;
  /** Six hex digits, no leading hash. */
  highlight?: string;
  /** Points. Word stores half-points, which is what the `w:sz` below is. */
  sizePt?: number;
  font?: string;
  superscript?: boolean;
  subscript?: boolean;
  /** Renders in the Hyperlink character style. */
  link?: boolean;
}

/**
 * One run of text with one set of formatting.
 *
 * `xml:space="preserve"` is not optional: without it Word discards the spaces
 * between two differently-formatted runs, so "**bold** text" arrives as
 * "**bold**text".
 */
export function runXml(text: string, format: DocxRunFormat = {}): string {
  const props: string[] = [];
  if (format.link) props.push(`<w:rStyle w:val="Hyperlink"/>`);
  if (format.font)
    props.push(
      `<w:rFonts w:ascii="${xmlEscape(format.font)}" w:hAnsi="${xmlEscape(format.font)}"/>`,
    );
  if (format.bold) props.push(`<w:b/>`);
  if (format.italic) props.push(`<w:i/>`);
  if (format.strike) props.push(`<w:strike/>`);
  if (format.underline) props.push(`<w:u w:val="single"/>`);
  if (format.color) props.push(`<w:color w:val="${xmlEscape(format.color)}"/>`);
  if (format.highlight)
    props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${xmlEscape(format.highlight)}"/>`);
  if (format.sizePt) {
    const half = Math.max(2, Math.round(format.sizePt * 2));
    props.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  }
  if (format.superscript) props.push(`<w:vertAlign w:val="superscript"/>`);
  if (format.subscript) props.push(`<w:vertAlign w:val="subscript"/>`);

  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";

  /* A line break inside a run is its own element — a newline character alone
     is collapsed to a space by every Word reader. */
  const body = String(text ?? "")
    .split("\n")
    .map((part) => `<w:t xml:space="preserve">${xmlEscape(part)}</w:t>`)
    .join("<w:br/>");

  return `<w:r>${rPr}${body}</w:r>`;
}

/** A run that is a picture, sized in pixels. */
export function imageRunXml(
  relId: string,
  widthPx: number,
  heightPx: number,
  altText = "",
  index = 1,
): string {
  const cx = emu(widthPx);
  const cy = emu(heightPx);
  const alt = xmlEscape(altText);
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${index}" name="Picture ${index}" descr="${alt}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${index}" name="Picture ${index}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${xmlEscape(relId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/** A run wrapped in a hyperlink pointing at a relationship. */
export function hyperlinkXml(relId: string, runs: string): string {
  return `<w:hyperlink r:id="${xmlEscape(relId)}">${runs}</w:hyperlink>`;
}

export interface DocxParagraphFormat {
  /** 1–6 for a heading, absent for body text. */
  heading?: number;
  align?: "left" | "center" | "right" | "justify";
  /** `bullet` uses numId 1, `number` uses numId 2 — see `NUMBERING_XML`. */
  list?: "bullet" | "number";
  /** Nesting depth of a list item, 0 for the outermost. */
  level?: number;
  /** Indentation in whole steps, for a paragraph that is not a list item. */
  indent?: number;
  style?: "Quote" | "Code";
  pageBreakBefore?: boolean;
}

/** One paragraph, with its runs already built. */
export function paragraphXml(
  runs: string,
  format: DocxParagraphFormat = {},
): string {
  const props: string[] = [];
  if (format.pageBreakBefore) props.push(`<w:pageBreakBefore/>`);
  if (format.heading && format.heading >= 1 && format.heading <= 6) {
    props.push(`<w:pStyle w:val="Heading${format.heading}"/>`);
  } else if (format.style) {
    props.push(`<w:pStyle w:val="${format.style}"/>`);
  }
  if (format.list) {
    const level = Math.max(0, Math.min(8, format.level ?? 0));
    props.push(
      `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${format.list === "bullet" ? 1 : 2}"/></w:numPr>`,
    );
  } else if (format.indent) {
    props.push(`<w:ind w:left="${Math.max(0, format.indent) * 720}"/>`);
  }
  if (format.align && format.align !== "left") {
    const val = format.align === "justify" ? "both" : format.align;
    props.push(`<w:jc w:val="${val}"/>`);
  }
  const pPr = props.length ? `<w:pPr>${props.join("")}</w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

/** A horizontal rule — Word draws it as a paragraph with a bottom border. */
export const HORIZONTAL_RULE_XML =
  `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>`;

/** A table, from rows of already-built cell contents. */
export interface DocxCell {
  /** Already-built paragraph XML. Empty means an empty paragraph, not nothing. */
  content: string;
  header?: boolean;
}

export function tableXml(
  rows: readonly (readonly DocxCell[])[],
  widthPx: number,
): string {
  const columns = Math.max(1, ...rows.map((r) => r.length));
  const cellWidth = Math.floor(twips(widthPx) / columns);

  const grid = `<w:tblGrid>${Array.from({ length: columns }, () => `<w:gridCol w:w="${cellWidth}"/>`).join("")}</w:tblGrid>`;

  const border = (side: string) =>
    `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  const props =
    `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${twips(widthPx)}" w:type="dxa"/>` +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    `</w:tblPr>`;

  const body = rows
    .map((cells) => {
      const tcs = cells
        .map((cell) => {
          const shade = cell.header
            ? `<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>`
            : "";
          /* A cell must contain at least one paragraph or Word rejects the
             file — an empty cell is an empty paragraph, not nothing. */
          const content = cell.content || `<w:p/>`;
          return `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${shade}</w:tcPr>${content}</w:tc>`;
        })
        .join("");
      return `<w:tr>${tcs}</w:tr>`;
    })
    .join("");

  return `<w:tbl>${props}${grid}${body}</w:tbl>`;
}

export interface DocxPage {
  /** Page size in pixels at 96 DPI. */
  widthPx: number;
  heightPx: number;
  marginTopPx: number;
  marginRightPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  landscape?: boolean;
}

/** `word/document.xml` — the body, wrapped with the page it is printed on. */
export function documentXml(body: string, page: DocxPage): string {
  const sect =
    `<w:sectPr>` +
    `<w:pgSz w:w="${twips(page.widthPx)}" w:h="${twips(page.heightPx)}"${page.landscape ? ` w:orient="landscape"` : ""}/>` +
    `<w:pgMar w:top="${twips(page.marginTopPx)}" w:right="${twips(page.marginRightPx)}"` +
    ` w:bottom="${twips(page.marginBottomPx)}" w:left="${twips(page.marginLeftPx)}"` +
    ` w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ` +
    `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>${body}${sect}</w:body></w:document>`
  );
}

export interface DocxParts {
  documentBody: string;
  page: DocxPage;
  rels: readonly DocxRel[];
  /** Pictures, already fetched, keyed by the name used in `rels`. */
  media: readonly { name: string; data: Uint8Array }[];
}

/** Every part of the archive, assembled into the finished `.docx` bytes. */
export function buildDocx(parts: DocxParts): Uint8Array {
  const exts = parts.media
    .map((m) => m.name.split(".").pop()?.toLowerCase() ?? "")
    .filter(Boolean);

  return zipStore([
    { name: "[Content_Types].xml", data: utf8(contentTypesXml(exts)) },
    { name: "_rels/.rels", data: utf8(ROOT_RELS_XML) },
    {
      name: "word/document.xml",
      data: utf8(documentXml(parts.documentBody, parts.page)),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: utf8(documentRelsXml(parts.rels)),
    },
    { name: "word/styles.xml", data: utf8(STYLES_XML) },
    { name: "word/numbering.xml", data: utf8(NUMBERING_XML) },
    ...parts.media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ]);
}
