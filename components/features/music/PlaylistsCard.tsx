"use client";

import { useState } from "react";
import { useMusic } from "./MusicContext";
import { ResultRow } from "./ResultRow";
import { Icon } from "@/components/ui/Icons";
import { Card } from "@/components/features/dashboard/Card";
import {
  NAME_PROBLEM_MESSAGE,
  PLAYLIST_LIMITS,
  nameProblem,
} from "@/lib/music/playlists";

/**
 * Playlists — the lists a person keeps for themselves.
 *
 * Favourites answers "did I like this". A playlist answers "what am I putting
 * on", which is a different question with an order in it, so the two are
 * separate surfaces rather than one list with a filter.
 *
 * Playing a playlist REPLACES the queue and Add to queue appends: two named
 * buttons rather than one that guesses, because the difference between "play
 * this now" and "play this after the forty minutes already lined up" is not
 * something a single control can express.
 *
 * Deleting asks first. Everything else here is reversible in one click; this
 * one throws away a list somebody built by hand, and Cowork keeps no copy.
 */
export function PlaylistsCard() {
  const music = useMusic();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const full = music.playlists.length >= PLAYLIST_LIMITS.playlists;
  const draftProblem = draft.trim()
    ? nameProblem(music.playlists, draft)
    : null;
  const renameProblem =
    renamingId && renameDraft.trim()
      ? nameProblem(music.playlists, renameDraft, renamingId)
      : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (draftProblem || !draft.trim() || full) return;
    const made = await music.createPlaylist(draft);
    setDraft("");
    setCreating(false);
    /* Open what was just made. An empty list that stays collapsed gives no
       sign of where the next track is supposed to go. */
    if (made) setOpenId(made.id);
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingId || renameProblem || !renameDraft.trim()) return;
    await music.renamePlaylist(renamingId, renameDraft);
    setRenamingId(null);
    setRenameDraft("");
  }

  return (
    <Card
      title="Playlists"
      padded={false}
      headerRight={
        <button
          type="button"
          onClick={() => {
            setCreating((c) => !c);
            setDraft("");
          }}
          aria-expanded={creating}
          disabled={full}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-40"
        >
          <Icon.plus className="h-3 w-3" />
          New
        </button>
      }
    >
      {creating && (
        <form onSubmit={create} className="px-5 pb-3">
          <label htmlFor="playlist-name" className="sr-only">
            Playlist name
          </label>
          <div className="flex items-center gap-2">
            <input
              id="playlist-name"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Deep work"
              maxLength={PLAYLIST_LIMITS.nameLength}
              autoComplete="off"
              aria-invalid={!!draftProblem}
              className="h-9 min-w-0 flex-1 rounded-inset bg-[var(--surface-sunken)] px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            />
            <button
              type="submit"
              disabled={!draft.trim() || !!draftProblem}
              className="h-9 shrink-0 rounded-full bg-ink px-3 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Create
            </button>
          </div>
          {draftProblem && (
            <p role="alert" className="mt-1.5 text-[11px] text-ink-muted">
              {NAME_PROBLEM_MESSAGE[draftProblem]}
            </p>
          )}
        </form>
      )}

      {music.playlists.length === 0 ? (
        <p className="px-5 pb-1 text-xs text-ink-faint">
          No playlists yet. Make one here, or use the list button on any track.
        </p>
      ) : (
        <ul aria-label="Playlists" className="divide-y divide-hairline">
          {music.playlists.map((p) => {
            const open = openId === p.id;
            const empty = p.items.length === 0;
            return (
              <li key={p.id}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 transition-colors hover:bg-[var(--row-hover)]">
                  {renamingId === p.id ? (
                    <form
                      onSubmit={rename}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <label htmlFor={`rename-${p.id}`} className="sr-only">
                        Rename {p.name}
                      </label>
                      <input
                        id={`rename-${p.id}`}
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        maxLength={PLAYLIST_LIMITS.nameLength}
                        autoComplete="off"
                        aria-invalid={!!renameProblem}
                        className="h-8 min-w-0 flex-1 rounded-inset bg-[var(--surface-sunken)] px-2.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      />
                      <button
                        type="submit"
                        disabled={!renameDraft.trim() || !!renameProblem}
                        className="h-8 shrink-0 rounded-full bg-ink px-3 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="h-8 shrink-0 rounded-full px-2 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : p.id)}
                        aria-expanded={open}
                        className="flex min-w-0 flex-1 basis-[120px] items-center gap-2 rounded-inset py-0.5 text-left focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                      >
                        <Icon.chevronDown
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform ${
                            open ? "" : "-rotate-90"
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">
                            {p.name}
                          </span>
                          <span className="block text-[11px] text-ink-faint">
                            <span data-figure>{p.items.length}</span>
                            {p.items.length === 1 ? " track" : " tracks"}
                          </span>
                        </span>
                      </button>

                      <span className="flex shrink-0 items-center gap-0.5">
                        <Act
                          label={`Play ${p.name} — this replaces the queue`}
                          disabled={empty}
                          onClick={() => music.playPlaylist(p.id)}
                        >
                          <Icon.play className="h-3.5 w-3.5" />
                        </Act>
                        <Act
                          label={`Add ${p.name} to the end of the queue`}
                          disabled={empty}
                          onClick={() => music.queuePlaylist(p.id)}
                        >
                          <Icon.queue className="h-3.5 w-3.5" />
                        </Act>
                        <Act
                          label={`Rename ${p.name}`}
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameDraft(p.name);
                            setConfirmingId(null);
                          }}
                        >
                          <Icon.rename className="h-3.5 w-3.5" />
                        </Act>
                        <Act
                          label={`Delete ${p.name}`}
                          onClick={() =>
                            setConfirmingId(
                              confirmingId === p.id ? null : p.id,
                            )
                          }
                        >
                          <Icon.close className="h-3.5 w-3.5" />
                        </Act>
                      </span>
                    </>
                  )}
                </div>

                {/* Confirmation in place, not a dialog. The thing being deleted
                    is named and still on screen underneath it. */}
                {confirmingId === p.id && (
                  <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5">
                    <p className="text-[11px] text-ink-muted">
                      Delete “{p.name}”? The tracks stay on YouTube; the list
                      does not come back.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        setConfirmingId(null);
                        if (openId === p.id) setOpenId(null);
                        await music.deletePlaylist(p.id);
                      }}
                      className="rounded-full bg-ink px-3 py-1 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="rounded-full px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                    >
                      Keep it
                    </button>
                  </div>
                )}

                {open &&
                  (empty ? (
                    <p className="px-3 pb-2.5 text-[11px] text-ink-faint">
                      Nothing in here yet. Search for a track and use its list
                      button.
                    </p>
                  ) : (
                    <ul
                      aria-label={`Tracks in ${p.name}`}
                      className="@container divide-y divide-hairline border-t border-hairline bg-[var(--surface-sunken)]"
                    >
                      {p.items.map((track, i) => (
                        <ResultRow
                          key={`${p.id}-${track.id}`}
                          item={track}
                          index={i}
                          variant="playlist"
                          listLength={p.items.length}
                          onMove={(from, to) =>
                            music.movePlaylistTrack(p.id, from, to)
                          }
                          onRemove={(at) =>
                            music.removeFromPlaylist(p.id, p.items[at].id)
                          }
                        />
                      ))}
                    </ul>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {full && (
        <p className="px-5 pt-2 text-[11px] text-ink-faint">
          That is the most playlists Cowork keeps (
          <span data-figure>{PLAYLIST_LIMITS.playlists}</span>). Delete one to
          make another.
        </p>
      )}
    </Card>
  );
}

/** The same 32px round action button the track rows use. */
function Act({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
