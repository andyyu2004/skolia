// The signed-in user's reading list: each text's status on it, the list of each status, and
// changing a text's status or taking it off. A change updates the text's entry at once and
// asks for the lists again, since it moves the text between them.
import { createMutation, createQuery, mutationOptions, queryOptions } from "@tanstack/svelte-query";
import type { DocumentId, Lang, ReadingStatus } from "@skolia/shared/api";
import { getReadingEntry, removeFromReadingList, setReadingStatus } from "./api.ts";
import { userQuery } from "./queries.ts";

export const READING_STATUS_LABELS: Readonly<Record<ReadingStatus, string>> = {
  "to-read": "To read",
  "in-progress": "In progress",
  done: "Done",
};

const LISTS_KEY = ["me", "reading-list", "list"] as const;

function entryQuery(id: DocumentId) {
  return queryOptions({ queryKey: ["me", "reading-list", "entry", id], queryFn: () => getReadingEntry(id) });
}

/** The lists' query key, one for each status and language (undefined: all languages). */
export const listKey = (status: ReadingStatus, lang: Lang | undefined) => [...LISTS_KEY, status, lang] as const;

/** The text's entry: data is null when it isn't on the list, undefined while loading or signed out. */
export function createReadingEntry(id: () => DocumentId) {
  const user = createQuery(() => userQuery);
  return createQuery(() => ({ ...entryQuery(id()), enabled: user.data != null }));
}

/** status null: off the list. */
export type ReadingChange = { readonly id: DocumentId; readonly status: ReadingStatus | null };

const changeMutation = mutationOptions({
  mutationFn: async ({ id, status }: ReadingChange) => (status === null ? (await removeFromReadingList(id), null) : setReadingStatus(id, status)),
  onSuccess: (entry, { id }, _held, { client }) => {
    client.setQueryData(entryQuery(id).queryKey, entry);
    return client.invalidateQueries({ queryKey: LISTS_KEY });
  },
});

export function createReadingChange() {
  return createMutation(() => changeMutation);
}
