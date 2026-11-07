// The signed-in user's word statuses, loaded once and kept as they're changed.
import type { LemmaId, Word, WordStatus } from "@skolia/shared/api";
import { listWords, setWord } from "./api.ts";

/** byId is null while loading or when signed out. */
export const words = $state<{ byId: Record<string, Word> | null }>({ byId: null });

let loading: Promise<void> | undefined;

export function loadWords(): Promise<void> {
  loading ??= listWords().then(
    (list) => {
      words.byId = list === null ? null : Object.fromEntries(list.map((w) => [w.lemmaId, w]));
    },
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

export async function setStatus(lemmaId: LemmaId, status: WordStatus): Promise<void> {
  await setWord(lemmaId, status);
  const mature = words.byId?.[lemmaId]?.mature ?? false;
  words.byId = { ...words.byId, [lemmaId]: { lemmaId, status, mature, updated: new Date().toISOString() } };
}
