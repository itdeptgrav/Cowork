"use client";

import { ReactRenderer, type Editor } from "@tiptap/react";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import {
  SuggestionMenu,
  type SuggestionItem,
  type SuggestionMenuHandle,
} from "@/components/features/workspace/docs/SuggestionMenu";

/**
 * The `render` half of a Tiptap suggestion, for `SuggestionMenu`.
 *
 * Shared by @mentions and slash commands: mounts the menu in a fixed-position
 * host at the caret's rectangle, moves it as the caret moves, forwards keys,
 * and tears it down. The menu itself knows nothing about Tiptap.
 */
export function suggestionRender(
  title?: string,
): NonNullable<SuggestionOptions<SuggestionItem>["render"]> {
  return () => {
    let component: ReactRenderer<SuggestionMenuHandle> | null = null;
    let host: HTMLDivElement | null = null;

    const place = (props: SuggestionProps<SuggestionItem>) => {
      if (!host) return;
      const rect = props.clientRect?.();
      if (!rect) return;
      /* Below the caret; flipped above when there is no room. */
      const below = rect.bottom + 6;
      const fits = below + 300 < window.innerHeight;
      host.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
      host.style.top = fits ? `${below}px` : `${Math.max(8, rect.top - 306)}px`;
    };

    return {
      onStart: (props) => {
        component = new ReactRenderer(SuggestionMenu, {
          props: { items: props.items, command: props.command, title },
          editor: props.editor as Editor,
        });
        host = document.createElement("div");
        host.style.position = "fixed";
        host.style.zIndex = "96";
        host.appendChild(component.element);
        document.body.appendChild(host);
        place(props);
      },
      onUpdate: (props) => {
        component?.updateProps({ items: props.items, command: props.command, title });
        place(props);
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") {
          host?.remove();
          host = null;
          return true;
        }
        return component?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: () => {
        component?.destroy();
        host?.remove();
        component = null;
        host = null;
      },
    };
  };
}
