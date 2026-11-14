// The texts on each user's reading list, with their statuses, in their own Durable Object.
import { timestamp, type DocumentId, type ListedReading, type ReadingEntry, type ReadingFilter, type ReadingKey, type ReadingStatus, type User } from "@skolia/shared/api";
import type { Paginated, PageRequest } from "@skolia/shared/page";
import type { Deps } from "../ports.ts";
import { listed } from "./documents.ts";
import { NO_CONTENT, fail, ok, type Failed, type NoContent, type Ok } from "./result.ts";

export async function get(deps: Deps, user: User, id: DocumentId): Promise<Ok<{ entry: ReadingEntry | null }>> {
  return ok({ entry: await deps.users.reading(user.id, id) });
}

/** Only a text the user can see goes on the list. */
export async function set(deps: Deps, user: User, id: DocumentId, status: ReadingStatus): Promise<Ok<{ entry: ReadingEntry }> | Failed<404>> {
  const document = await deps.documents.visible(id, user.id);
  if (!document) return fail(404, "no such document");
  return ok({ entry: await deps.users.setReading(user.id, id, document.lang, status, timestamp(deps.now())) });
}

export async function remove(deps: Deps, user: User, id: DocumentId): Promise<NoContent> {
  await deps.users.removeReading(user.id, id);
  return NO_CONTENT;
}

/** A page of the texts with the status, each with the entry the user sees for it. A text
 * the user can no longer see stays on the list but is left out of the page, so a page
 * can have fewer than its limit and still be followed by another. */
export async function list(
  deps: Deps,
  user: User,
  filter: ReadingFilter,
  page: PageRequest<ReadingKey>,
): Promise<Ok<Paginated<ListedReading, ReadingKey>>> {
  const { items, next } = await deps.users.readingList(user.id, filter, page);
  const documents = await deps.documents.visibleAll(
    items.map((item) => item.documentId),
    user.id,
  );
  const shown = await Promise.all(
    items.flatMap(({ documentId, ...entry }) => {
      const record = documents.get(documentId);
      return record === undefined ? [] : [listed(deps, record, user).then((document): ListedReading => ({ ...entry, document }))];
    }),
  );
  return ok({ items: shown, next });
}
