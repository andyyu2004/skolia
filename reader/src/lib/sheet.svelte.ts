// How the word sheet is shown, kept across words: the sheet is remade for each one.

export type SheetView = "word" | "sentence";
export type SentenceLayout = "arcs" | "tree";

export const sheet = $state<{ view: SheetView; layout: SentenceLayout; formsOpen: boolean }>({
  view: "word",
  layout: "arcs",
  formsOpen: false,
});
