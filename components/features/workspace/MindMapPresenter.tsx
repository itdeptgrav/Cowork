"use client";

import { useEffect, useMemo, useState } from "react";
import type { MindNodeId } from "@/lib/domain/mindmap";
import type { MindMap } from "@/lib/rules/mindmap/tree";
import { presentationOrder, slideFor, stepSlide } from "@/lib/rules/mindmap/present";
import { DriveImage } from "@/components/ui/DriveImage";

/**
 * Presentation mode — the map, one card at a time, full screen.
 *
 * Right arrow, Space or Enter go on; Left goes back; Home and End jump to
 * the ends; Escape leaves. Each slide shows where the card sits in the map,
 * its title and notes, its pictures, and the cards beneath it, so the
 * audience sees the branch's shape before its detail. Clicking a child
 * jumps to it.
 */
export function MindMapPresenter({
  map,
  startId,
  onClose,
}: {
  map: MindMap;
  /** Where to begin — the selected card, or the root. */
  startId?: MindNodeId | null;
  onClose: () => void;
}) {
  const order = useMemo(() => presentationOrder(map), [map]);
  const [currentId, setCurrentId] = useState<MindNodeId | null>(() => (startId && order.includes(startId) ? startId : order[0] ?? null));
  const slide = currentId ? slideFor(map, currentId, order) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentId((c) => stepSlide(order, c, 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace") {
        e.preventDefault();
        setCurrentId((c) => stepSlide(order, c, -1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentId(order[0] ?? null);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentId(order[order.length - 1] ?? null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, onClose]);

  if (!slide) {
    return (
      <div role="dialog" aria-label="Presentation" className="fixed inset-0 z-50 grid place-items-center bg-[#12141a] text-white">
        <p>Nothing to present.</p>
        <button type="button" onClick={onClose} className="mt-3 rounded-full border border-white/30 px-3 py-1 text-[13px]">
          Close
        </button>
      </div>
    );
  }

  const atStart = slide.index <= 1;
  const atEnd = slide.index >= slide.total;

  return (
    <div role="dialog" aria-label="Presentation" className="fixed inset-0 z-50 flex flex-col bg-[#12141a] text-white">
      <header className="flex items-center justify-between px-6 py-4 text-[12px] text-white/60">
        <nav aria-label="Where this card sits" className="flex min-w-0 items-center gap-1.5">
          {slide.breadcrumb.length === 0 ? (
            <span>{slide.floating ? "Floating topic" : "Root"}</span>
          ) : (
            slide.breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>›</span>}
                <span className="truncate">{b}</span>
              </span>
            ))
          )}
        </nav>
        <div className="flex items-center gap-3">
          <span data-figure>
            {slide.index} / {slide.total}
          </span>
          <button type="button" onClick={onClose} className="rounded-full border border-white/25 px-3 py-1 text-white/80 hover:bg-white/10" title="Leave the presentation (Esc)">
            Exit
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-10 pb-8">
        <div className="w-full max-w-4xl">
          <h1 className="text-balance text-[clamp(28px,5vw,56px)] font-semibold leading-tight tracking-tight">
            {slide.icon && <span className="mr-3">{slide.icon}</span>}
            {slide.title}
          </h1>
          {slide.description && (
            <p className="mt-5 max-w-3xl whitespace-pre-wrap text-[clamp(15px,1.6vw,20px)] leading-relaxed text-white/80">{slide.description}</p>
          )}
          {slide.images.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-3">
              {slide.images.slice(0, 4).map((img, i) => (
                <DriveImage key={img.fileId ?? img.url ?? i} url={img.url} fileId={img.fileId} alt="" className="max-h-[32vh] max-w-[46%] rounded-lg object-contain" />
              ))}
            </div>
          )}
          {slide.children.length > 0 && (
            <ol className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {slide.children.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setCurrentId(c.id)}
                    className="flex w-full items-baseline gap-3 rounded-lg border border-white/15 bg-white/[0.06] px-4 py-3 text-left text-[15px] hover:bg-white/[0.12]"
                  >
                    <span className="text-[12px] text-white/50" data-figure>
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {c.count > 0 && (
                      <span className="text-[11px] text-white/45" data-figure title={`${c.count} beneath`}>
                        +{c.count}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-center gap-2 pb-6">
        <button
          type="button"
          disabled={atStart}
          onClick={() => setCurrentId((c) => stepSlide(order, c, -1))}
          className="rounded-full border border-white/25 px-4 py-1.5 text-[13px] text-white/85 hover:bg-white/10 disabled:opacity-30"
        >
          ← Previous
        </button>
        <button
          type="button"
          disabled={atEnd}
          onClick={() => setCurrentId((c) => stepSlide(order, c, 1))}
          className="rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-[#12141a] hover:bg-white/90 disabled:opacity-30"
        >
          Next →
        </button>
      </footer>
    </div>
  );
}
