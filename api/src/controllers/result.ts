import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError } from "@skolia/shared/api";
import type { PART_ENCODING } from "@skolia/shared/keys";
import type { StoredBlob } from "../ports.ts";

/** What a controller returns and the app sends: JSON with its status, no content, or a
 * stored blob. */
export type Result = Json<unknown, ContentfulStatusCode> | NoContent | BlobResult;

export interface Json<T, S extends ContentfulStatusCode> {
  status: S;
  body: T;
}

export type Ok<T> = Json<T, 200>;
export type Failed<S extends ContentfulStatusCode> = Json<ApiError, S>;

export interface NoContent {
  status: 204;
}

/** A blob whose URL names its version, so it can be cached forever. encoding: how it's
 * stored (PART_ENCODING for an analysis or bundle). */
export interface BlobResult {
  status: 200;
  blob: StoredBlob;
  encoding: typeof PART_ENCODING | undefined;
}

export function ok<T>(body: T): Ok<T> {
  return { status: 200, body };
}

export function fail<S extends ContentfulStatusCode>(status: S, error: string): Failed<S> {
  return { status, body: { error } };
}

export const NO_CONTENT: NoContent = { status: 204 };
