// The signed-in user's word statuses, by lemma id. App loads them when someone signs in;
// the word sheet and Review read and change them.
import { createMutation, createQuery, mutationOptions, queryOptions } from "@tanstack/svelte-query";
import { timestamp, type LemmaId, type Word, type WordStatus } from "@skolia/shared/api";
import { clearWordStatus, listWords, setWord } from "./api.ts";
import { resume, userQuery } from "./queries.ts";

export type WordsById = Readonly<Record<string, Word>>;

const wordsQuery = queryOptions({
  queryKey: ["me", "words"],
  queryFn: async (): Promise<WordsById | null> => {
    const list = await listWords();
    return list && Object.fromEntries(list.map((w) => [w.lemmaId, w]));
  },
  staleTime: Infinity,
});

/** data is null when signed out, undefined while loading. */
export function createWords() {
  const user = createQuery(() => userQuery);
  return createQuery(() => ({ ...wordsQuery, enabled: user.data != null }));
}

function withWord(words: WordsById, lemmaId: LemmaId, word: Word | undefined): WordsById {
  const { [lemmaId]: _, ...rest } = words;
  return word ? { ...rest, [lemmaId]: word } : rest;
}

/** status null takes the word's status away, and its cards out of reviews. */
export type StatusChange = { readonly lemmaId: LemmaId; readonly status: WordStatus | null };

const statusMutation = mutationOptions({
  mutationFn: ({ lemmaId, status }: StatusChange) => (status === null ? clearWordStatus(lemmaId) : setWord(lemmaId, status)),
  onMutate: async ({ lemmaId, status }, { client }) => {
    await client.cancelQueries({ queryKey: wordsQuery.queryKey });
    const previous = client.getQueryData(wordsQuery.queryKey)?.[lemmaId];
    const word = status === null ? undefined : { lemmaId, status, mature: previous?.mature ?? false, updated: timestamp(new Date()) };
    client.setQueryData(wordsQuery.queryKey, (words) => words && withWord(words, lemmaId, word));
    return { previous };
  },
  onError: (_error, { lemmaId }, changed, { client }) =>
    client.setQueryData(wordsQuery.queryKey, (words) => words && withWord(words, lemmaId, changed?.previous)),
  onSettled: (_data, _error, _change, _changed, { client }) => resume(client, wordsQuery.queryKey),
});

/** Changes a word's status, shown at once and undone if the API refuses it. */
export function createSetStatus() {
  return createMutation(() => statusMutation);
}
