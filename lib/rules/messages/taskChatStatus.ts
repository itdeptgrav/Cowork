import type { EmployeeId } from "../../domain/identity.ts";

/**
 * Whether your own task-chat message has been read.
 *
 * ## Why this is not `messageStatus`
 *
 * A direct message has exactly one other person, so "read" is a single fact and
 * the tick can be decided from `readBy` being non-empty. A task carries an
 * assignor, one or more assignees and often a reviewer — so "read" there is a
 * question about a SET, and the honest answer is only "read" once everybody who
 * could read it has.
 *
 * Reusing the DM rule would have turned the tick blue the moment ONE of five
 * people opened the tab, which on a task is the difference between "the person
 * I need has seen this" and "somebody has".
 *
 * ## Three states, and what the middle one means HERE
 *
 * The ticks are the shape everybody already reads without a legend — one, two,
 * two blue. But a task has no delivery stamp: the message thread computes
 * `delivered` from a per-client mark on the conversation document, and nothing
 * equivalent exists on `cowork_tasks/{id}/chat`. Inventing one would mean
 * showing "delivered" for a message nobody had received.
 *
 * So the middle state is earned rather than guessed, and it means something a
 * task actually needs to know:
 *
 *   · **one tick** — sent. Nobody else has opened it.
 *   · **two ticks** — SOME of the others have read it.
 *   · **two blue** — everybody else on the task has.
 *
 * That is the same progression a group chat shows, measured against the only
 * evidence this thread has. The `delivered` name is kept so the shared
 * `MessageTicks` can draw it; the WORDS shown to a person are supplied by the
 * caller, because "Delivered" would be a claim nothing here can support.
 */
export type TaskChatStatus = "sent" | "delivered" | "read";

export interface ReadableTaskMessage {
  senderId: EmployeeId | "system";
  readBy?: EmployeeId[];
}

/**
 * @param audience Everybody who can see this thread, the sender included —
 *   the caller passes the task's own people and this removes the sender.
 */
export function taskChatStatus(
  message: ReadableTaskMessage,
  viewerId: string | null,
  audience: readonly EmployeeId[],
): TaskChatStatus {
  /* Only your own messages carry a tick at all; a caller that asks about
     somebody else's gets "sent" rather than a claim about them. */
  if (!viewerId || message.senderId !== viewerId) return "sent";

  const others = audience.filter((id) => id && id !== message.senderId);
  /* Nobody else on the task yet — an unassigned task's thread is a note to
     self, and "read by everyone" would be vacuously true. Say sent. */
  if (others.length === 0) return "sent";

  const read = new Set(message.readBy ?? []);
  const howMany = others.filter((id) => read.has(id)).length;
  if (howMany === 0) return "sent";
  return howMany === others.length ? "read" : "delivered";
}

/**
 * What the ticks mean, in words, for a screen reader and a tooltip.
 *
 * Separate from the status because the shared `MessageTicks` says "Delivered"
 * by default, and on a task that would be a claim about somebody's device that
 * nothing here can support. What IS known is how many people have opened it.
 */
export function taskChatStatusLabel(
  status: TaskChatStatus,
  audienceSize: number,
): string {
  if (status === "read")
    return audienceSize > 1 ? "Read by everyone on this task" : "Read";
  if (status === "delivered") return "Read by some";
  return "Sent";
}

/**
 * Everybody who can see a task's thread, deduplicated and without blanks.
 *
 * Built from the fields a task actually carries. A person appearing twice —
 * an assignor who is also an assignee, which self-assignment makes ordinary —
 * must count once, or `every` below could never be satisfied.
 */
export function taskAudience(input: {
  assignorId?: string | null;
  assigneeIds?: readonly string[] | null;
  reviewerId?: string | null;
}): EmployeeId[] {
  const all = [
    input.assignorId,
    ...(input.assigneeIds ?? []),
    input.reviewerId,
  ];
  return Array.from(
    new Set(all.filter((id): id is string => typeof id === "string" && id !== "")),
  ) as EmployeeId[];
}
