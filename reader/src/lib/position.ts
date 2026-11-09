// Where the reader was in each text: the character offset at the top of the screen. Signed
// in, it's kept with the user's cards (/api/me/positions); signed out, in this browser.
import { getPosition, putPosition } from "./api.ts";

export interface Positions {
  /** Where the reader was, or null for the start. */
  readonly saved: number | null;
  save(offset: number, keepalive: boolean): Promise<void>;
}

/** Wait this long after scrolling stops before saving. */
export const SAVE_AFTER_MS = 3000;

const key = (id: string): string => `skolia:position:${id}`;

/** The offset stored in the browser, or null when there's none or it isn't one. Storage
 * can be missing or throw, in a private window or with site data blocked. */
export function readLocal(storage: Storage | undefined, id: string): number | null {
  try {
    const offset: unknown = JSON.parse(storage?.getItem(key(id)) ?? "null");
    return Number.isInteger(offset) && Number(offset) >= 0 ? Number(offset) : null;
  } catch {
    return null;
  }
}

export function writeLocal(storage: Storage | undefined, id: string, offset: number): void {
  try {
    storage?.setItem(key(id), JSON.stringify(offset));
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
export async function positionsOf(id: string, storage = browserStorage()): Promise<Positions> {
  const remote = await getPosition(id);
  if (remote === undefined) {
    return { saved: readLocal(storage, id), save: async (offset) => writeLocal(storage, id, offset) };
  }
  return {
    saved: remote?.offset ?? null,
    save: (offset, keepalive) => putPosition(id, { offset, at: new Date().toISOString() }, keepalive),
  };
}

/** The start of the sentence holding the offset, so a text reopens at a sentence's start. */
export function sentenceStart(sentences: readonly { readonly start: number }[], offset: number): number {
  return sentences.reduce((found, s) => (s.start <= offset && s.start > found ? s.start : found), 0);
}

interface TextNode {
  readonly node: Text;
  /** Its first character's offset in the root's text. */
  readonly start: number;
}

function textNodes(root: Node): readonly TextNode[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: TextNode[] = [];
  let start = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    nodes.push({ node: text, start });
    start += text.length;
  }
  return nodes;
}

/** Where the character at the offset is drawn, or null for one that isn't (a line break). */
function charRect(nodes: readonly TextNode[], offset: number): DOMRect | null {
  const found = nodes.findLast((n) => n.start <= offset);
  if (!found || offset - found.start >= found.node.length) return null;
  const range = document.createRange();
  range.setStart(found.node, offset - found.start);
  range.setEnd(found.node, offset - found.start + 1);
  return [...range.getClientRects()].find((r) => r.height > 0) ?? null;
}

/** The first drawn character at or after the offset, and where it's drawn. */
function drawnFrom(nodes: readonly TextNode[], offset: number, length: number): { offset: number; rect: DOMRect } | null {
  for (let o = offset; o < length; o++) {
    const rect = charRect(nodes, o);
    if (rect) return { offset: o, rect };
  }
  return null;
}

/** The offset of the first character on a line that ends below `top`, a y in the
 * viewport: the text at the top of the screen. The root's text is the document's, so its
 * offsets are the text's. */
export function offsetAt(root: Node, top: number): number {
  const nodes = textNodes(root);
  const length = root.textContent?.length ?? 0;
  let [lo, hi] = [0, length];
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const drawn = drawnFrom(nodes, mid, length);
    if (!drawn || drawn.rect.bottom > top) hi = mid;
    else lo = drawn.offset + 1;
  }
  return Math.min(lo, Math.max(0, length - 1));
}

/** Whether the line with the offset is on screen, when there's no need to go to it. */
export function onScreen(root: Node, offset: number): boolean {
  const drawn = drawnFrom(textNodes(root), offset, root.textContent?.length ?? 0);
  return drawn !== null && drawn.rect.top >= 0 && drawn.rect.bottom <= window.innerHeight;
}

/** Scrolls the window so the line with the offset is at `top`, a y in the viewport. */
export function scrollToOffset(root: Node, offset: number, top: number): void {
  const drawn = drawnFrom(textNodes(root), offset, root.textContent?.length ?? 0);
  if (drawn) window.scrollBy({ top: drawn.rect.top - top, behavior: "instant" });
}

/** The start of the text from the offset, up to about `length` characters, cut at a space. */
export function snippet(text: string, offset: number, length = 60): string {
  const rest = text.slice(offset).replace(/\s+/gu, " ").trim();
  if (rest.length <= length) return rest;
  const cut = rest.lastIndexOf(" ", length);
  return `${rest.slice(0, cut > 0 ? cut : length).replace(/[\s,;:]+$/u, "")}…`;
}
