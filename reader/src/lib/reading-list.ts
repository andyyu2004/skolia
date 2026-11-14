// The signed-in user's reading list: each text's status on it, the list of each status, and
// changing a text's status or taking it off. A change updates the text's entry at once and
// asks for the lists again, since it moves the text between them.
import { createInfiniteQuery, createMutation, createQuery, keepPreviousData, mutationOptions, queryOptions } from "@tanstack/svelte-query";
import type { DocumentId, Lang, ReadingKey, ReadingStatus } from "@skolia/shared/api";
import type { Cursor } from "@skolia/shared/page";
import { getReadingEntry, listReading, removeFromReadingList, setReadingStatus } from "./api.ts";
import { userQuery } from "./queries.ts";

export const READING_STATUS_LABELS: Readonly<Record<ReadingStatus, string>> = {
  "to-read": "To read",
  reading: "Reading now",
  finished: "Finished",
};

const LISTS_KEY = ["me", "reading-list", "list"] as const;

function entryQuery(id: DocumentId) {
  return queryOptions({ queryKey: ["me", "reading-list", "entry", id], queryFn: () => getReadingEntry(id) });
}

/** A status's list, a page at a time, in the language or (undefined) all of them. A new
 * language's list shows the last one's until it comes. */
export function createReadingList(status: ReadingStatus, lang: () => Lang | undefined) {
  const user = createQuery(() => userQuery);
  return createInfiniteQuery(() => ({
    enabled: user.data != null,
    queryKey: [...LISTS_KEY, status, lang()] as const,
    queryFn: ({ pageParam }) => listReading(status, lang(), pageParam),
    initialPageParam: undefined as Cursor<ReadingKey> | undefined,
    getNextPageParam: (page) => page.next ?? undefined,
    placeholderData: keepPreviousData,
  }));
}

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
