// The review page's keyboard shortcuts: Space or Enter shows the answer, then 1 to 4 grade it.
import { RATINGS, type Rating } from "@skolia/shared/api";

export type Shortcut = { kind: "reveal" } | { kind: "grade"; rating: Rating };

/** Where a key went: a field takes every key, a link or button takes Space and Enter. */
export type KeyTarget = "field" | "control" | "page";

/** The parts of a keydown the shortcuts look at. */
export interface Key {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: KeyTarget;
}

export function shortcut(key: Key, revealed: boolean): Shortcut | null {
  // Ctrl/Cmd+1 switches browser tabs
  if (key.repeat || key.altKey || key.ctrlKey || key.metaKey || key.target === "field") return null;
  if (!revealed) {
    return key.target === "page" && (key.key === " " || key.key === "Enter") ? { kind: "reveal" } : null;
  }
  const rating = RATINGS.find((r) => String(r) === key.key);
  return rating === undefined ? null : { kind: "grade", rating };
}

const FIELDS = "input, select, textarea, [contenteditable]:not([contenteditable='false'])";
const CONTROLS = "a[href], button, summary";

export function keyTarget(target: EventTarget | null): KeyTarget {
  if (!(target instanceof Element)) return "page";
  if (target.closest(FIELDS)) return "field";
  return target.closest(CONTROLS) ? "control" : "page";
}
