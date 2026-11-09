// A link to a word in a text, with the sheet as it's shown:
// #/doc/<id>?w=3.12&view=sentence&draw=tree&whole=1 is token 12 of sentence 3, its
// sentence drawn as a tree, whole. Only what differs from the defaults is written.
import type { SentenceLayout, SheetView } from "./sheet.svelte.ts";

/** A token by sentence and token index, as w= writes it: 3.12. */
export type WordKey = readonly [number, number];

export const formatWord = (word: WordKey): string => word.join(".");

export function parseWord(value: string | null): WordKey | null {
  const match = /^(\d+)\.(\d+)$/.exec(value ?? "");
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export interface WordLink {
  readonly word: WordKey;
  readonly view: SheetView;
  readonly layout: SentenceLayout;
  readonly whole: boolean;
}

/** The query part of the link, with its "?", or "" for none. */
export function writeLink(link: WordLink | null): string {
  if (!link) return "";
  const sentence = link.view === "sentence";
  const entries: readonly (readonly [string, string])[] = [
    ["w", formatWord(link.word)],
    ...(sentence ? [["view", "sentence"] as const] : []),
    ...(sentence && link.layout === "tree" ? [["draw", "tree"] as const] : []),
    ...(sentence && link.whole ? [["whole", "1"] as const] : []),
  ];
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, v])).toString()}`;
}

/** The word a hash links to, or null when it names none or another text. */
export function readLink(hash: string, id: string): WordLink | null {
  const prefix = `#/doc/${id}?`;
  if (!hash.startsWith(prefix)) return null;
  const query = new URLSearchParams(hash.slice(prefix.length));
  const word = parseWord(query.get("w"));
  if (!word) return null;
  const sentence = view(query.get("view"));
  return {
    word,
    view: sentence,
    layout: sentence === "sentence" && query.get("draw") === "tree" ? "tree" : "arcs",
    whole: sentence === "sentence" && query.get("whole") === "1",
  };
}

const view = (value: string | null): SheetView => (value === "sentence" ? "sentence" : "word");
