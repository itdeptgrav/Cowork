"use client";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Avatar } from "@/components/ui/Avatar";
import {
  activeMention,
  matchMentions,
  insertMention,
  mentionToken,
  resolveMentionIds,
  type MentionPerson,
} from "@/lib/rules/messages/mentions";
import type { EmployeeId } from "@/lib/domain";

/**
 * @-mention autocomplete for a plain `<textarea>` composer.
 *
 * Given the people, the text, its setter and the textarea ref, this owns the
 * popup and the picks. The composer:
 *  · calls `sync()` on every caret-moving event (change/keyup/click/select);
 *  · calls `onKeyDown(e)` FIRST in its own handler and bails if it returns true
 *    (so Enter/Tab/arrows drive the popup, not send);
 *  · renders `menu` inside a `relative` wrapper around the input row;
 *  · reads `mentionIds()` on send and calls `reset()` after.
 */
export function useMentions({
  people,
  text,
  setText,
  textareaRef,
}: {
  people: readonly MentionPerson[];
  text: string;
  setText: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [caret, setCaret] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const pickedRef = useRef<{ id: EmployeeId; token: string }[]>([]);
  /* When dismissed with Escape, suppress the popup for the token at this start
     until the caret leaves it. */
  const [suppressedStart, setSuppressedStart] = useState<number | null>(null);

  const sync = useCallback(() => {
    const el = textareaRef.current;
    setCaret(el ? (el.selectionStart ?? text.length) : text.length);
  }, [textareaRef, text]);

  const active = activeMention(text, caret);
  const matches = active ? matchMentions(people, active.query) : [];
  const open =
    !!active && matches.length > 0 && active.start !== suppressedStart;

  const pick = useCallback(
    (person: MentionPerson) => {
      const a = activeMention(text, caret);
      if (!a) return;
      const { text: next, caret: nextCaret } = insertMention(
        text,
        caret,
        a.start,
        person,
      );
      pickedRef.current = [
        ...pickedRef.current,
        { id: person.id, token: mentionToken(person) },
      ];
      setText(next);
      setActiveIdx(0);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(nextCaret, nextCaret);
        }
        setCaret(nextCaret);
      });
    },
    [text, caret, setText, textareaRef],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % matches.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[activeIdx] ?? matches[0]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuppressedStart(active ? active.start : null);
        return true;
      }
      return false;
    },
    [open, matches, activeIdx, pick, active],
  );

  const menu = open ? (
    <MentionMenu matches={matches} activeIdx={activeIdx} onPick={pick} />
  ) : null;

  return {
    menu,
    onKeyDown,
    sync,
    mentionIds: () => resolveMentionIds(text, pickedRef.current),
    reset: () => {
      pickedRef.current = [];
      setSuppressedStart(null);
    },
  };
}

function MentionMenu({
  matches,
  activeIdx,
  onPick,
}: {
  matches: MentionPerson[];
  activeIdx: number;
  onPick: (p: MentionPerson) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-[260px] overflow-y-auto rounded-panel border border-hairline bg-[var(--surface-raised)] p-1 shadow-lg">
      {matches.map((p, i) => (
        <button
          key={p.id}
          type="button"
          /* mousedown, not click: click fires after the textarea blurs and the
             popup would already be gone. */
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(p);
          }}
          className={`flex w-full items-center gap-2 rounded-inset px-2 py-1.5 text-left text-[13px] transition-colors ${
            i === activeIdx
              ? "bg-[var(--control-active)] text-ink"
              : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          }`}
        >
          <Avatar
            initials={p.displayName
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase()}
            hue={2}
            name={p.displayName}
            size="sm"
          />
          <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
        </button>
      ))}
    </div>
  );
}
