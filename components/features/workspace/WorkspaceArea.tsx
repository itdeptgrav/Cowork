"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { WorkspaceHead } from "@/components/ui/Workspace";
import { Segmented } from "@/components/ui/Primitives";
import { DocumentsArea } from "./DocumentsArea";
import { MindMapsArea } from "./MindMapsArea";

/**
 * Workspace — mindmaps, documents and sheets.
 *
 * Three surfaces, one page, kept as a mode rather than three routes because
 * they are the same activity: this is where thinking is written down before it
 * becomes tasks.
 *
 * ## All three are lists now
 *
 * The mindmap used to be the odd one out. There was exactly ONE map, held in
 * `localStorage`, so this component owned it directly — the canvas, the
 * selection, the toolbar and a chip reading "On this device" were all here,
 * beside two surfaces that were already browsers over many stored things.
 *
 * A mindmap is a server record now, and there can be many, so the shape is the
 * same for all three: **choose one, then work in it.** That is what removed the
 * chip too. It was not a label, it was a warning — the map did not follow you
 * between machines, nobody else could see it, and clearing site data threw it
 * away — and none of those are true any more, so the sentence goes rather than
 * being softened. See {@link MindMapsArea}.
 */
export function WorkspaceArea() {
  /**
   * The deep link a daily report's "Open in Docs" button arrives with —
   * `?mode=docs&doc=<id>&reportTaskId=<taskId>&reportTaskTitle=<title>&progress=<n>`.
   * Read once, at mount: this only needs to seed the initial state, and a
   * `useSearchParams()` value re-read on every render would fight anyone who
   * then navigates elsewhere inside the workspace on the same page load.
   */
  const params = useSearchParams();
  const [deepLink] = useState(() => ({
    mode: params.get("mode"),
    doc: params.get("doc"),
    /* A map may be linked to the same way a document is. */
    map: params.get("map"),
    reportTaskId: params.get("reportTaskId"),
    reportTaskTitle: params.get("reportTaskTitle"),
    progress: params.get("progress"),
  }));

  const [mode, setMode] = useState<"map" | "docs" | "sheets">(
    deepLink.mode === "docs" || deepLink.mode === "sheets"
      ? deepLink.mode
      : "map",
  );

  return (
    <>
      {/* Title, then the surfaces. The per-surface controls — New, the palette,
          the count — belong to the surface below and are drawn by it, because
          each of the three now has its own and crowding them up here would
          make one row that has to be parsed rather than scanned. */}
      <WorkspaceHead
        title="Workspace"
        tabs={
          <Segmented
            label="Workspace mode"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { id: "map", label: "Mindmaps" },
              { id: "docs", label: "Documents" },
              { id: "sheets", label: "Sheets" },
            ]}
          />
        }
      />

      {mode === "sheets" ? (
        <DocumentsArea kind="sheet" mode={mode} onMode={setMode} />
      ) : mode === "docs" ? (
        <DocumentsArea
          kind="doc"
          mode={mode}
          onMode={setMode}
          initialOpenId={deepLink.doc}
          reportTaskId={deepLink.reportTaskId}
          reportTaskTitle={deepLink.reportTaskTitle}
          reportProgress={
            deepLink.progress !== null ? Number(deepLink.progress) : null
          }
        />
      ) : (
        <MindMapsArea
          mode={mode}
          onMode={setMode}
          initialOpenId={deepLink.map}
        />
      )}
    </>
  );
}
