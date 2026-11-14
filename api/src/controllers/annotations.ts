// An entry's annotations: what its user attached to ranges of its text (shared/annotations.ts),
// seen by whoever sees the entry.
import type * as z from "zod";
import {
  MAX_ANNOTATIONS,
  timestamp,
  type Annotation,
  type AnnotationId,
  type AnnotationKey,
  type Paginated,
  type User,
} from "@skolia/shared/api";
import { annotationId } from "@skolia/shared/annotations";
import { textKey } from "@skolia/shared/keys";
import type { PageRequest } from "@skolia/shared/page";
import type * as schemas from "@skolia/shared/schemas";
import type { Deps, StoredDocument } from "../ports.ts";
import { findDocument, noSuchDocument } from "./documents.ts";
import { NO_CONTENT, fail, ok, type Failed, type Json, type NoContent, type Ok } from "./result.ts";

/** A page of the annotations of the entry the viewer sees for the text, so they go with the
 * title and credit shown. */
export async function list(
  deps: Deps,
  id: string,
  viewer: User | null,
  page: PageRequest<AnnotationKey>,
): Promise<Ok<Paginated<Annotation, AnnotationKey>> | Failed<404>> {
  const record = await findDocument(deps, id, viewer);
  if (!record) return noSuchDocument();
  return ok(await deps.documents.annotations(record.id, record.user, page));
}

/** 201 for a new annotation on the user's own entry, 200 when it had it already. */
export async function add(
  deps: Deps,
  user: User,
  id: string,
  body: z.output<typeof schemas.NewAnnotation>,
): Promise<Json<Annotation, 201> | Ok<Annotation> | Failed<400 | 404 | 409>> {
  const record = await ownEntry(deps, id, user);
  if (!record) return noEntry();
  const text = await deps.blobs.get(textKey(record.id));
  if (!text) throw new Error(`document ${record.id} has no text`);
  const length = new TextDecoder().decode(text.body).length;
  if (body.end > length) return fail(400, `the annotation ends at ${body.end}, after the text's end at ${length}`);
  const annotated = await deps.documents.annotate(record.id, user.id, {
    ...body,
    id: await annotationId(body),
    added: timestamp(deps.now()),
  });
  switch (annotated.kind) {
    case "added":
      return { status: 201, body: annotated.annotation };
    case "exists":
      return ok(annotated.annotation);
    case "full":
      return fail(409, `an entry has at most ${MAX_ANNOTATIONS} annotations`);
  }
}

export async function remove(deps: Deps, user: User, id: string, annotation: AnnotationId): Promise<NoContent | Failed<404>> {
  const record = await ownEntry(deps, id, user);
  if (!record) return noEntry();
  return (await deps.documents.unannotate(record.id, user.id, annotation)) ? NO_CONTENT : fail(404, "no such annotation");
}

/** The user's own entry for the text: the entry they see, if it's theirs. */
async function ownEntry(deps: Deps, id: string, user: User): Promise<StoredDocument | null> {
  const record = await findDocument(deps, id, user);
  return record?.user === user.id ? record : null;
}

function noEntry(): Failed<404> {
  return fail(404, "you haven't imported this text");
}
