"use client";

import { createContext, useContext } from "react";

/**
 * The pin/hide state a tile needs to drive from ON the tile.
 *
 * The layout state (which tile is pinned large, which are hidden) belongs to the
 * stage — only one tile is pinned and it decides grid-versus-focus. But the
 * CONTROL that changes it now lives on each participant's tile, and a tile is a
 * template the grid clones, so it cannot be handed per-instance props. The stage
 * provides this once; every tile reads it and reports its own key back up.
 */
export interface TileActions {
  /** The pinned track's `identity:source` key, or null for the plain grid. */
  pinnedKey: string | null;
  onPin: (key: string | null) => void;
  hiddenKeys: Set<string>;
  onHide: (key: string, hidden: boolean) => void;
}

const TileActionsContext = createContext<TileActions | null>(null);

export const TileActionsProvider = TileActionsContext.Provider;

/** The stage's pin/hide controls, or null when a tile is drawn outside a stage
 *  (the lobby preview) — where there is nothing to pin and no menu is shown. */
export function useTileActions(): TileActions | null {
  return useContext(TileActionsContext);
}
