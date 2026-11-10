// The signed-in user's cloze cards in the open text, by where their blanks start in it, so
// the word sheet can say a word already has one, and take it away. Reader loads them with
// the text.
import type { CardId, NewClozeInput } from "@skolia/shared/api";
import { deleteCloze, listClozes, makeCloze } from "./api.ts";

/** byStart is null while loading, when signed out, or for another text than documentId. */
export const clozes = $state<{ documentId: string | null; byStart: ReadonlyMap<number, CardId> | null }>({ documentId: null, byStart: null });

/** Bumped by each load, so an older response can't replace a newer state. */
let generation = 0;

export async function loadClozes(documentId: string): Promise<void> {
  const mine = ++generation;
  clozes.documentId = documentId;
  clozes.byStart = null;
  const list = await listClozes(documentId);
  if (mine === generation) clozes.byStart = list && new Map(list.clozes.map((c) => [c.start, c.cardId]));
}

/** A load still in flight may have read the list before this card, so it's loaded again. */
export async function addCloze(cloze: NewClozeInput): Promise<void> {
  const { cardId } = await makeCloze(cloze);
  if (clozes.documentId !== cloze.documentId) return;
  if (clozes.byStart === null) return loadClozes(cloze.documentId);
  clozes.byStart = new Map([...clozes.byStart, [cloze.blankStart, cardId]]);
}

/** Deletes the text's cloze card at start, with its reviews. */
export async function removeCloze(documentId: string, start: number, cardId: CardId): Promise<void> {
  await deleteCloze(cardId);
  if (clozes.documentId !== documentId || clozes.byStart === null) return;
  clozes.byStart = new Map([...clozes.byStart].filter(([s]) => s !== start));
}
