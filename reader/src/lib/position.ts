// Where the reader was in each text: the word at the top of the screen, by sentence and
// token index as a link's w= has it. Signed in, it's kept with the user's cards
// (/api/me/positions); signed out, in this browser.
import type { DocumentId } from "@skolia/shared/api";
import { getPosition, putPosition } from "./api.ts";
import { formatWord, parseWord, type WordKey } from "./link.ts";

export interface Positions {
  /** Where the reader was, or null for the start. */
  readonly saved: WordKey | null;
  save(word: WordKey, keepalive: boolean): Promise<void>;
}

/** Wait this long after scrolling stops before saving. */
export const SAVE_AFTER_MS = 3000;

const key = (id: DocumentId): string => `skolia:position:${id}`;

/** The word stored in the browser, or null when there's none or it isn't one. Storage
 * can be missing or throw, in a private window or with site data blocked. */
export function readLocal(storage: Storage | undefined, id: DocumentId): WordKey | null {
  try {
    return parseWord(storage?.getItem(key(id)) ?? null);
  } catch {
    return null;
  }
}

export function writeLocal(storage: Storage | undefined, id: DocumentId, word: WordKey): void {
  try {
    storage?.setItem(key(id), formatWord(word));
  } catch {
    // Full or blocked: the position just isn't kept
  }
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The text's saved position and how to save a new one, the user's if signed in. */
export async function positionsOf(id: DocumentId, storage = browserStorage()): Promise<Positions> {
  const remote = await getPosition(id);
  if (remote === undefined) {
    return { saved: readLocal(storage, id), save: async (word) => writeLocal(storage, id, word) };
  }
  return {
    saved: remote && [remote.sentence, remote.token],
    save: ([sentence, token], keepalive) => putPosition(id, { sentence, token, at: new Date().toISOString() }, keepalive),
  };
}

/** The text's word pieces' elements, in piece id order (Layout.words): each is a span,
 * .w or .punct. */
export function wordElements(root: ParentNode): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(":scope > .w, :scope > .punct")];
}

/** The index of the first element on a line that ends below `top`, a y in the viewport:
 * the word at the top of the screen. */
export function firstBelow(elements: readonly Element[], top: number): number {
  let [lo, hi] = [0, elements.length];
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((elements[mid]?.getBoundingClientRect().bottom ?? Infinity) > top) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(lo, elements.length - 1);
}

export function onScreen(element: Element): boolean {
  const { top, bottom } = element.getBoundingClientRect();
  return top >= 0 && bottom <= window.innerHeight;
}

/** Scrolls the window so the element's line is at `top`, a y in the viewport. */
export function scrollToTop(element: Element, top: number): void {
  window.scrollBy({ top: element.getBoundingClientRect().top - top, behavior: "instant" });
}

/** The start of the text from the offset, up to about `length` characters, cut at a space. */
export function snippet(text: string, offset: number, length = 60): string {
  const rest = text.slice(offset).replace(/\s+/gu, " ").trim();
  if (rest.length <= length) return rest;
  const cut = rest.lastIndexOf(" ", length);
  return `${rest.slice(0, cut > 0 ? cut : length).replace(/[\s,;:]+$/u, "")}…`;
}
