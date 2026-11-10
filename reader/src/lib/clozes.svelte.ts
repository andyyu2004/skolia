// The signed-in user's cloze cards in the open text, by where their blanks start in it, so
// the word sheet can say a word already has one. Reader loads them with the text.
import type { NewClozeInput } from "@skolia/shared/api";
import { listClozes, makeCloze } from "./api.ts";

/** starts is null while loading, when signed out, or for another text than documentId. */
export const clozes = $state<{ documentId: string | null; starts: ReadonlySet<number> | null }>({ documentId: null, starts: null });

/** Bumped by each load, so an older response can't replace a newer state. */
let generation = 0;

export async function loadClozes(documentId: string): Promise<void> {
  const mine = ++generation;
  clozes.documentId = documentId;
  clozes.starts = null;
  const list = await listClozes(documentId);
  if (mine === generation) clozes.starts = list && new Set(list.clozes.map((c) => c.start));
}

export async function addCloze(cloze: NewClozeInput): Promise<void> {
  await makeCloze(cloze);
  if (clozes.documentId !== cloze.documentId || clozes.starts === null) return;
  clozes.starts = new Set([...clozes.starts, cloze.sentenceStart + cloze.blankStart]);
}
