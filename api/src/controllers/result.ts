import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError } from "@skolia/shared/api";
import type { PART_ENCODING } from "@skolia/shared/keys";
import type { StoredBlob } from "../ports.ts";

/** What a controller returns and the app sends: JSON with its status, no content, or a
 * stored blob or that the client's copy of it is current. */
export type Result = Json<unknown, ContentfulStatusCode> | NoContent | BlobResult | NotModified;

export interface Json<T, S extends ContentfulStatusCode> {
  status: S;
  body: T;
}

export type Ok<T> = Json<T, 200>;
export type Failed<S extends ContentfulStatusCode> = Json<ApiError, S>;

export interface NoContent {
  status: 204;
}

/** A blob whose URL names its version, so what's there never changes and its key is its
 * ETag. Who may see it can change, so a client asks again each time it's used, and an
 * If-None-Match that matches gets 304 once access is checked. encoding: how it's stored
 * (PART_ENCODING for an analysis or bundle). */
export interface BlobResult {
  status: 200;
  etag: string;
  blob: StoredBlob;
  encoding: typeof PART_ENCODING | undefined;
}

export interface NotModified {
  status: 304;
  etag: string;
  encoding: typeof PART_ENCODING | undefined;
}

export function ok<T>(body: T): Ok<T> {
  return { status: 200, body };
}

export function fail<S extends ContentfulStatusCode>(status: S, error: string): Failed<S> {
  return { status, body: { error } };
}

export const NO_CONTENT: NoContent = { status: 204 };
