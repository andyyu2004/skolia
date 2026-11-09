// A link to a word in a text, with the sheet as it's shown:
// #/doc/<id>?w=3.12&view=sentence&draw=tree&whole=1 is token 12 of sentence 3, its
// sentence drawn as a tree, whole. Only what differs from the defaults is written.
import type { SentenceLayout, SheetView } from "./sheet.svelte.ts";

export interface WordLink {
  /** Sentence and token index */
  word: [number, number];
  view: SheetView;
  layout: SentenceLayout;
  whole: boolean;
}

/** The query part of the link, with its "?", or "" for none. */
export function writeLink(link: WordLink | null): string {
  if (!link) return "";
  const query = new URLSearchParams({ w: link.word.join(".") });
  if (link.view === "sentence") {
    query.set("view", "sentence");
    if (link.layout === "tree") query.set("draw", "tree");
    if (link.whole) query.set("whole", "1");
  }
  return `?${query.toString()}`;
}

/** The word a hash links to, or null when it names none or another text. */
export function readLink(hash: string, id: string): WordLink | null {
  const prefix = `#/doc/${id}?`;
  if (!hash.startsWith(prefix)) return null;
  const query = new URLSearchParams(hash.slice(prefix.length));
  const match = /^(\d+)\.(\d+)$/.exec(query.get("w") ?? "");
  if (!match) return null;
  const sentence = view(query.get("view"));
  return {
    word: [Number(match[1]), Number(match[2])],
    view: sentence,
    layout: sentence === "sentence" && query.get("draw") === "tree" ? "tree" : "arcs",
    whole: sentence === "sentence" && query.get("whole") === "1",
  };
}

const view = (value: string | null): SheetView => (value === "sentence" ? "sentence" : "word");
