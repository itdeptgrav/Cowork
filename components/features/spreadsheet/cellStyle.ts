/**
 * Turning a `CellStyle` into inline CSS — the one place the pure style model
 * meets the DOM.
 *
 * The engine and the style registry stay DOM-free; this small adapter maps a
 * resolved style plus its computed alignment into the `CSSProperties` a cell div
 * wears. Kept out of `lib/` deliberately: `React.CSSProperties` is a view type,
 * and the model must not depend on it.
 */

import type { CSSProperties } from "react";
import type { CellAlign } from "@/lib/spreadsheet/values";
import type { Border, CellStyle } from "@/lib/spreadsheet/style";

const BORDER_WIDTH: Record<Border["style"], string> = {
  thin: "1px solid",
  medium: "2px solid",
  thick: "3px solid",
  dashed: "1px dashed",
  dotted: "1px dotted",
  double: "3px double",
};

function edgeCss(b: Border): string {
  return `${BORDER_WIDTH[b.style]} ${b.color}`;
}

/**
 * The inline CSS for a cell, given its style and its resolved horizontal
 * alignment (which already accounts for the value's default when the style sets
 * none). The grid renders every populated or formatted cell as a flex box, so
 * horizontal alignment is `justifyContent` and vertical is `alignItems`.
 */
export function styleToCss(style: CellStyle, align: CellAlign): CSSProperties {
  const css: CSSProperties = {};

  if (style.fontFamily) css.fontFamily = style.fontFamily;
  if (style.fontSize) css.fontSize = style.fontSize;
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = "italic";
  const decoration = [
    style.underline ? "underline" : null,
    style.strikethrough ? "line-through" : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (decoration) css.textDecorationLine = decoration;
  if (style.color) css.color = style.color;
  if (style.background) css.background = style.background;

  css.justifyContent = align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";
  css.textAlign = align;
  css.alignItems =
    style.valign === "top" ? "flex-start" : style.valign === "bottom" ? "flex-end" : "center";

  if (style.wrap) {
    css.whiteSpace = "normal";
    css.wordBreak = "break-word";
  } else {
    css.whiteSpace = "nowrap";
  }

  if (style.borders) {
    if (style.borders.top) css.borderTop = edgeCss(style.borders.top);
    if (style.borders.right) css.borderRight = edgeCss(style.borders.right);
    if (style.borders.bottom) css.borderBottom = edgeCss(style.borders.bottom);
    if (style.borders.left) css.borderLeft = edgeCss(style.borders.left);
  }

  return css;
}

/**
 * What a cell's TEXT wears on top of the cell box: a rotation, or the stacked
 * "vertical text". Kept apart from the box so borders and fills stay square
 * while only the words turn.
 */
export function textCss(style: CellStyle): CSSProperties | undefined {
  if (style.stackText) {
    return { writingMode: "vertical-lr", textOrientation: "upright", whiteSpace: "nowrap", lineHeight: 1.1 };
  }
  if (style.rotation) {
    return {
      display: "inline-block",
      transform: `rotate(${-style.rotation}deg)`,
      transformOrigin: "center",
      whiteSpace: "nowrap",
    };
  }
  return undefined;
}
