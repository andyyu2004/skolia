// The signed-in user's cloze cards in a text, by where their blanks start in it, so the word
// sheet can say a word already has one, and take it away. Reader loads them with the text.
import { createMutation, createQuery, mutationOptions, queryOptions } from "@tanstack/svelte-query";
import type { CardId, DocumentId, NewClozeInput } from "@skolia/shared/api";
import { deleteCloze, listClozes, makeCloze } from "./api.ts";
import { resume, userQuery } from "./queries.ts";

export type ClozesByStart = ReadonlyMap<number, CardId>;

function clozesQuery(documentId: DocumentId) {
  return queryOptions({
    queryKey: ["me", "clozes", documentId],
    queryFn: async (): Promise<ClozesByStart | null> => {
      const list = await listClozes(documentId);
      return list && new Map(list.map((c) => [c.start, c.cardId]));
    },
  });
}

/** data is null when signed out, undefined while loading. */
export function createClozes(documentId: () => DocumentId) {
  const user = createQuery(() => userQuery);
  return createQuery(() => ({ ...clozesQuery(documentId()), enabled: user.data != null }));
}

const keyOf = (documentId: DocumentId) => clozesQuery(documentId).queryKey;

/** The card's id comes from the API, so it's added once made. */
const addMutation = mutationOptions({
  mutationFn: makeCloze,
  onMutate: (cloze: NewClozeInput & { readonly documentId: DocumentId }, { client }) =>
    client.cancelQueries({ queryKey: keyOf(cloze.documentId) }),
  onSuccess: ({ cardId }, cloze, _held, { client }) =>
    client.setQueryData(keyOf(cloze.documentId), (byStart) => byStart && new Map([...byStart, [cloze.blankStart, cardId]])),
  onSettled: (_made, _error, cloze, _held, { client }) => resume(client, keyOf(cloze.documentId)),
});

export function createAddCloze() {
  return createMutation(() => addMutation);
}

/** The text's cloze card at start. */
export type ClozeRemoval = { readonly documentId: DocumentId; readonly start: number; readonly cardId: CardId };

const removeMutation = mutationOptions({
  mutationFn: ({ cardId }: ClozeRemoval) => deleteCloze(cardId),
  onMutate: async ({ documentId, start }, { client }) => {
    await client.cancelQueries({ queryKey: keyOf(documentId) });
    client.setQueryData(keyOf(documentId), (byStart) => byStart && new Map([...byStart].filter(([s]) => s !== start)));
  },
  onError: (_error, { documentId, start, cardId }, _held, { client }) =>
    client.setQueryData(keyOf(documentId), (byStart) => byStart && new Map([...byStart, [start, cardId]])),
  onSettled: (_data, _error, { documentId }, _held, { client }) => resume(client, keyOf(documentId)),
});

/** Deletes a cloze card, with its reviews: gone at once, and back if the API refuses. */
export function createRemoveCloze() {
  return createMutation(() => removeMutation);
}
