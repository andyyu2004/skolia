// Lists come a page at a time, by keyset: each page ends with its last row's sort key, as
// an opaque cursor, and the next page is the rows after that key. A page costs the same
// however deep into the list it is, where OFFSET would read every row before it.
import * as z from "zod";

declare const cursorKey: unique symbol;

/** A page's cursor, for the list whose sort key is K: a string, typed so that one list's
 * can't be given to another. encodeCursor makes them. */
export type Cursor<K> = string & { readonly [cursorKey]: K };

/** One page of a list, in the list's order of K. next: the cursor for the page after it
 * (?after=), null on the last page. */
export type Paginated<T, K> = {
  readonly items: readonly T[];
  readonly next: Cursor<K> | null;
};

/** What a list's port is asked for: at most limit rows, those after the key, or from the
 * start of the list without one. */
export type PageRequest<K> = {
  readonly after?: K | undefined;
  readonly limit: number;
};

/** A row and its sort key. */
export type Keyed<T, K> = {
  readonly item: T;
  readonly key: K;
};

type KeyPart = string | number;

/** A sort key, as base64url of its JSON. */
export function encodeCursor<K extends readonly KeyPart[]>(key: K): Cursor<K> {
  const bytes = new TextEncoder().encode(JSON.stringify(key));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "") as Cursor<K>;
}

/** The JSON a cursor holds, or undefined for anything that isn't base64url of JSON. */
function decodeCursor(cursor: string): unknown {
  try {
    const binary = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))),
    ) as unknown;
  } catch {
    return undefined;
  }
}

/** A cursor, decoded to the sort key it holds. Typed as the list's Cursor, so the typed
 * client takes only those; any other string is refused when it's parsed. */
export function cursor<K extends readonly KeyPart[]>(key: z.ZodType<K>) {
  return z
    .custom<Cursor<K>>((value) => typeof value === "string")
    .transform((text, context): K => {
      const parsed = key.safeParse(decodeCursor(text));
      if (parsed.success) return parsed.data;
      context.addIssue({ code: "custom", message: "after isn't a cursor this list gave" });
      return z.NEVER;
    });
}

/** How many rows a page of a list has, unless ?limit= asks for fewer, and the most it may ask for. */
export type PageSize = {
  readonly fallback: number;
  readonly max: number;
};

/** ?after= and ?limit=, for a list with this sort key. */
export function pageQuery<K extends readonly KeyPart[]>(key: z.ZodType<K>, { fallback, max }: PageSize) {
  return z.object({
    after: cursor(key).optional(),
    limit: z.coerce.number().int().min(1, `limit must be 1 to ${max}`).max(max, `limit must be 1 to ${max}`).default(fallback),
  });
}

/** The page from up to limit + 1 rows: the extra row, if there is one, is only there to
 * show that another page follows. */
export function paginate<T, K extends readonly KeyPart[]>(rows: readonly Keyed<T, K>[], limit: number): Paginated<T, K> {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { items: page.map((row) => row.item), next: rows.length > limit && last !== undefined ? encodeCursor(last.key) : null };
}

/** Every item of a list, following its pages until the last. For lists a client needs whole. */
export async function allPages<T, K>(
  fetchPage: (after: Cursor<K> | undefined) => Promise<Paginated<T, K>>,
  after?: Cursor<K>,
): Promise<readonly T[]> {
  const page = await fetchPage(after);
  return page.next === null ? page.items : [...page.items, ...(await allPages(fetchPage, page.next))];
}
