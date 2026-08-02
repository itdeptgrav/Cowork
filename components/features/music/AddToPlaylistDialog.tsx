"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMusic } from "./MusicContext";
import { Icon } from "@/components/ui/Icons";
import {
  NAME_PROBLEM_MESSAGE,
  PLAYLIST_LIMITS,
  nameProblem,
} from "@/lib/music/playlists";
import type { MusicResult } from "@/lib/domain";

/**
 * Putting one track into a list.
 *
 * A dialog rather than a dropdown on the row, for two reasons. The row lives
 * inside a scrolling card in a narrow column, so an anchored menu is one
 * layout change away from being clipped; and the useful answer to "add this
 * where" is *every* list at once — which ones already hold it, which do not —
 * which is a panel, not a menu of one choice.
 *
 * It follows the dialog pattern the product already owns (`NewChatDialog`,
 * `PriorityDialog`): a portal, a frosted panel over a blurred scrim, Escape to
 * close, and the refusal rendered in place rather than thrown away.
 *
 * Membership toggles. Clicking a list that already holds the track takes it
 * out, so the mistake and its undo are the same control in the same place.
 */
export function AddToPlaylistDialog({
  item,
  onClose,
}: {
  item: MusicResult;
  onClose: () => void;
}) {
  const music = useMusic();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const holding = music.playlistsWith(item.id);
  /* An untouched field is not a mistake, so nothing is said until they type. */
  const problem = useMemo(
    () => (name.trim() ? nameProblem(music.playlists, name) : null),
    [music.playlists, name],
  );
  const full = music.playlists.length >= PLAYLIST_LIMITS.playlists;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Focus lands on Close rather than the name field: most opens end in a tap
     on an existing list, and stealing focus into a text input would put a
     keyboard reader in the wrong half of the dialog. */
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  async function toggle(id: string, listName: string) {
    if (holding.has(id)) {
      await music.removeFromPlaylist(id, item.id);
      setStatus(`Removed from ${listName}.`);
      return;
    }
    const added = await music.addToPlaylist(id, item);
    setStatus(
      added ? `Added to ${listName}.` : `${listName} is full — nothing added.`,
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (nameProblem(music.playlists, name) || full) return;
    const created = await music.createPlaylist(name);
    if (!created) return;
    /* Creating a playlist from here means "put this track in a new list" —
       leaving it empty would make the reader do the second half themselves. */
    await music.addToPlaylist(created.id, item);
    setStatus(`Added to ${created.name}.`);
    setName("");
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-playlist-title"
      className="fixed inset-0 z-[90] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative flex max-h-[88vh] w-[min(460px,96vw)] flex-col overflow-hidden rounded-panel">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id="add-to-playlist-title"
                className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
              >
                Add to playlist
              </h2>
              <p className="mt-1.5 truncate text-sm text-ink-muted">
                {item.title}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
            >
              <Icon.close className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-[96px] flex-1 overflow-y-auto border-t border-hairline px-3 py-2 scroll-slim">
          {music.playlists.length === 0 ? (
            <p className="px-3 py-5 text-sm text-ink-muted">
              You have no playlists yet. Name one below and this track goes
              into it.
            </p>
          ) : (
            <ul>
              {music.playlists.map((p) => {
                const has = holding.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={has}
                      onClick={() => toggle(p.id, p.name)}
                      className="flex w-full items-center gap-3 rounded-inset px-3 py-2 text-left transition-colors hover:bg-[var(--control)] focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors ${
                          has
                            ? "bg-ink text-[var(--body-bg)]"
                            : "bg-[var(--control)] text-transparent"
                        }`}
                      >
                        <Icon.check className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">
                          {p.name}
                        </span>
                        <span className="block text-[11px] text-ink-faint">
                          <span data-figure>{p.items.length}</span>
                          {p.items.length === 1 ? " track" : " tracks"}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {has ? "Remove" : "Add"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form
          onSubmit={create}
          className="border-t border-hairline px-6 py-4"
        >
          <label
            htmlFor="new-playlist-name"
            className="block text-[11px] text-ink-faint"
          >
            New playlist
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="new-playlist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Deep work"
              maxLength={PLAYLIST_LIMITS.nameLength}
              disabled={full}
              autoComplete="off"
              aria-invalid={!!problem}
              className="h-10 min-w-0 flex-1 rounded-inset bg-[var(--surface-raised)] px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] transition-shadow duration-[180ms] placeholder:text-ink-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={full || !name.trim() || !!problem}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Icon.plus className="h-3.5 w-3.5" />
              Create
            </button>
          </div>

          {full ? (
            <p className="mt-2 text-[11px] text-ink-muted">
              You have the most playlists Cowork keeps (
              <span data-figure>{PLAYLIST_LIMITS.playlists}</span>). Delete one
              to make another.
            </p>
          ) : problem ? (
            <p role="alert" className="mt-2 text-[11px] text-ink-muted">
              {NAME_PROBLEM_MESSAGE[problem]}
            </p>
          ) : null}

          <p aria-live="polite" className="mt-2 min-h-4 text-[11px] text-ink-faint">
            {status}
          </p>
        </form>
      </div>
    </div>,
    document.body,
  );
}
