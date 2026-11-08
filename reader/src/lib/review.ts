// The review page's keyboard shortcuts (Space or Enter shows the answer, then 1 to 4
// grade it), and the English clue on a production card's front.
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

/** Words in a gloss part short enough to be a translation, not a definition. */
const MAX_CLUE_WORDS = 4;
/** Translations shown at most, from the gloss's own order. */
const MAX_CLUES = 4;

/** The English words a gloss translates to: "dog (Canis lupus familiaris)" is "dog", and
 * "Form of greeting ... terms with; hi; hello; bye" is "hi, hello, bye". A gloss that's
 * only a definition is shown whole. */
export function clue(gloss: string): string {
  let plain = gloss;
  for (let prev = ""; prev !== plain; ) [prev, plain] = [plain, plain.replace(/\s*\([^()]*\)/g, "")];
  const parts = plain
    .split(";")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter((p) => p.length > 0);
  const short = parts.filter((p) => p.split(" ").length <= MAX_CLUE_WORDS);
  const words = (short.length > 0 ? short : parts.slice(0, 1)).flatMap((p) => p.split(/,\s*/));
  const unique = [...new Set(words.filter((w) => w.length > 0))];
  return unique.length > 0 ? unique.slice(0, MAX_CLUES).join(", ") : gloss;
}
