// How the word sheet is shown, kept across words.

export type SheetView = "word" | "sentence";
export type SentenceLayout = "arcs" | "tree";

export const sheet = $state<{
  view: SheetView;
  layout: SentenceLayout;
  /** A long sentence drawn whole rather than only the clause around the word */
  whole: boolean;
  /** Paradigm tables unfolded, by title */
  forms: Record<string, boolean>;
  /** The sheet's width on a wide screen once dragged, in pixels, for each view; null is the stylesheet's */
  width: Record<SheetView, number | null>;
}>({
  view: "word",
  layout: "arcs",
  whole: false,
  forms: {},
  width: { word: null, sentence: null },
});
