// The signed-in user's word statuses. App loads them when someone signs in and clears them
// on sign-out; the word sheet reads and changes them.
import { timestamp, type LemmaId, type Word, type WordStatus } from "@skolia/shared/api";
import { listWords, setWord } from "./api.ts";

/** byId is null while loading or when signed out. */
export const words = $state<{ byId: Record<string, Word> | null }>({ byId: null });

/** Bumped by each load and clear, so an older response can't replace a newer state. */
let generation = 0;

export async function loadWords(): Promise<void> {
  const mine = ++generation;
  const list = await listWords();
  if (mine === generation) words.byId = list && Object.fromEntries(list.map((w) => [w.lemmaId, w]));
}

export function clearWords(): void {
  generation++;
  words.byId = null;
}

export async function setStatus(lemmaId: LemmaId, status: WordStatus): Promise<void> {
  await setWord(lemmaId, status);
  if (words.byId === null) return;
  const mature = words.byId[lemmaId]?.mature ?? false;
  words.byId[lemmaId] = { lemmaId, status, mature, updated: timestamp(new Date()) };
}
