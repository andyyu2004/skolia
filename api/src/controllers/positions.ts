// Where each user was in each text they've read, in their own Durable Object.
import { timestamp, type DocumentId, type ReadingPosition, type User } from "@skolia/shared/api";
import type { Deps, StoredPosition } from "../ports.ts";
import { MAX_CLOCK_SKEW_MS } from "./cards.ts";
import { NO_CONTENT, fail, ok, type Failed, type NoContent, type Ok } from "./result.ts";

export async function get(deps: Deps, user: User, id: DocumentId): Promise<Ok<{ position: StoredPosition | null }>> {
  return ok({ position: await deps.users.position(user.id, id) });
}

/** A position older than the stored one is ignored, so a late write from another tab
 * can't move the reader back. */
export async function set(deps: Deps, user: User, id: DocumentId, { sentence, token, at }: ReadingPosition): Promise<NoContent | Failed<400 | 404>> {
  if (Date.parse(at) > deps.now().getTime() + MAX_CLOCK_SKEW_MS) return fail(400, "position is in the future");
  if (!(await deps.documents.visible(id, user.id))) return fail(404, "no such document");
  await deps.users.setPosition(user.id, id, { sentence, token, at: timestamp(new Date(at)) });
  return NO_CONTENT;
}
