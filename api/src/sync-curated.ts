// Makes the curated user's documents match curated/: imports each text there publicly,
// updates the title, licence, author, source or tags of those already imported, and deletes the
// curated user's documents that aren't there any more. A document's id is its text's hash,
// so an edited text, in the file or at its source, is a new document and the old one is
// deleted. With --check, only lists what it would do, and fails if that's anything.
// curated/{lang}/{name}.yaml: one text, of a kind (curated-kinds.ts) that has it inline or
// names where to fetch it.
// usage: SYNC_CURATED_API_KEY=<key> node src/sync-curated.ts <base url> <curated dir> [--check]
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hc } from "hono/client";
import { parse as parseYaml } from "yaml";
import * as z from "zod";
import {
  DOCUMENT_PAGE,
  LANGS,
  type DocumentId,
  type DocumentKey,
  type DocumentSummary,
  type DocumentUpdate,
  type Lang,
  type Tags,
} from "@skolia/shared/api";
import { docId } from "@skolia/shared/keys";
import { allPages, type Cursor } from "@skolia/shared/page";
import * as schemas from "@skolia/shared/schemas";
import type { AppType } from "./app.ts";
import { API_KEY_HEADER } from "./auth.ts";
import { CuratedSpec, resolve, type Fetch, type Resolved } from "./curated-kinds.ts";

/** A curated file, checked but not yet resolved. */
export interface CuratedFile {
  readonly path: string;
  readonly lang: Lang;
  readonly spec: CuratedSpec;
}

export interface Curated {
  path: string;
  id: DocumentId;
  request: z.output<typeof schemas.ImportRequest>;
}

export type Change =
  | { kind: "import"; text: Curated }
  | { kind: "update"; text: Curated; id: DocumentId; update: DocumentUpdate }
  | { kind: "delete"; document: DocumentSummary };

/** A curated file's YAML, checked against its kind. Throws, naming the file, if it isn't one. */
export function parseCurated(path: string, lang: Lang, raw: string): CuratedFile {
  let yaml: unknown;
  try {
    yaml = parseYaml(raw);
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const spec = CuratedSpec.safeParse(yaml);
  if (!spec.success) {
    const issue = spec.error.issues[0];
    throw new Error(`${path}: ${issue ? `${issue.path.join(".") || "kind"}: ${issue.message}` : "not a curated file"}`);
  }
  return { path, lang, spec: spec.data };
}

/** A resolved text as a public import. Throws, naming the file, if it isn't one. */
export async function toCurated(path: string, lang: Lang, resolved: Resolved): Promise<Curated> {
  const text = resolved.text.trim();
  const request = schemas.ImportRequest.safeParse({ ...resolved, text, lang, visibility: "public" });
  if (!request.success) throw new Error(`${path}: ${request.error.issues[0]?.message ?? "not a valid import"}`);
  return { path, id: await docId(lang, text), request: request.data };
}

/** Every file in curated/{lang}/, checked; nothing is fetched. */
export async function readCurated(dir: string): Promise<CuratedFile[]> {
  const langs = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = await Promise.all(
    langs.map(async (entry) => {
      const lang = LANGS.find((l) => l === entry.name);
      if (lang === undefined) throw new Error(`${join(dir, entry.name)}: not a language (${LANGS.join(", ")})`);
      const names = (await readdir(join(dir, lang))).sort();
      return Promise.all(
        names.map(async (name) => {
          const path = join(dir, lang, name);
          if (!name.endsWith(".yaml")) throw new Error(`${path}: not a .yaml file`);
          return parseCurated(path, lang, await readFile(path, "utf8"));
        }),
      );
    }),
  );
  return files.flat();
}

/** The files' texts, fetching those their kind names a source for. Throws, naming the
 * file, if one can't be had or two are the same text. */
export async function resolveCurated(files: readonly CuratedFile[], fetch: Fetch = globalThis.fetch): Promise<Curated[]> {
  const texts = await Promise.all(
    files.map(async ({ path, lang, spec }) => {
      let resolved: Resolved;
      try {
        resolved = await resolve(spec, lang, fetch);
      } catch (error) {
        throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return toCurated(path, lang, resolved);
    }),
  );
  const seen = new Map<DocumentId, string>();
  for (const text of texts) {
    const other = seen.get(text.id);
    if (other !== undefined) throw new Error(`${text.path}: the same text as ${other}`);
    seen.set(text.id, text.path);
  }
  return texts;
}

/** What makes the curated user's documents match the texts. */
export function plan(texts: readonly Curated[], mine: readonly DocumentSummary[]): Change[] {
  const byId = new Map(mine.map((d) => [d.id, d]));
  const changes: Change[] = [];
  for (const text of texts) {
    const document = byId.get(text.id);
    if (document === undefined) {
      changes.push({ kind: "import", text });
      continue;
    }
    const { title, licence, author, source, tags } = text.request;
    const update: DocumentUpdate = {};
    if (title !== undefined && title !== document.title) update.title = title;
    if (licence !== document.licence) update.licence = licence;
    if ((author ?? null) !== document.author) update.author = author ?? null;
    if ((source ?? null) !== document.source) update.source = source ?? null;
    if (!sameTags(tags, document.tags)) update.tags = tags;
    if (Object.keys(update).length > 0) changes.push({ kind: "update", text, id: text.id, update });
  }
  const wanted = new Set(texts.map((t) => t.id));
  for (const document of mine) {
    if (!wanted.has(document.id)) changes.push({ kind: "delete", document });
  }
  return changes;
}

function sameTags(a: Tags, b: Tags): boolean {
  const kinds = Object.keys(a);
  return kinds.length === Object.keys(b).length && kinds.every((kind) => a[kind] === b[kind]);
}

function describe(change: Change): string {
  switch (change.kind) {
    case "import":
      return `import ${change.text.path}`;
    case "update":
      return `update ${change.text.path}: ${Object.keys(change.update).join(", ")}`;
    case "delete":
      return `delete ${change.document.id} (${change.document.lang}, "${change.document.title}")`;
  }
}

async function expectOk(response: { ok: boolean; status: number; text(): Promise<string> }, what: string): Promise<void> {
  if (!response.ok) throw new Error(`${what}: ${response.status} ${await response.text()}`);
}

export type Api = ReturnType<typeof hc<AppType>>["api"];

/** Lists, then unless check is set makes, the changes that make the signed-in user's
 * documents match the texts. */
export async function sync(api: Api, texts: readonly Curated[], { check = false, log = console.log } = {}): Promise<Change[]> {
  // Every page: a document missing from the list would be imported again, and one in
  // the list but not in curated/ deleted
  const mine = await allPages(async (after?: Cursor<DocumentKey>) => {
    const listed = await api.me.documents.$get({ query: { after, limit: String(DOCUMENT_PAGE.max) } });
    if (!listed.ok) throw new Error(`list: ${listed.status} ${await listed.text()}`);
    return listed.json();
  });
  const changes = plan(texts, mine);
  for (const change of changes) log(describe(change));
  if (check) return changes;
  for (const change of changes) {
    const what = describe(change);
    if (change.kind === "import") await expectOk(await api.documents.$post({ json: change.text.request }), what);
    else if (change.kind === "update")
      await expectOk(await api.documents[":id"].$patch({ param: { id: change.id }, json: change.update }), what);
    else await expectOk(await api.documents[":id"].$delete({ param: { id: change.document.id } }), what);
  }
  return changes;
}

async function main(): Promise<void> {
  const [, , url, dir, flag] = process.argv;
  const key = process.env["SYNC_CURATED_API_KEY"];
  if (!url || !dir || !key || (flag !== undefined && flag !== "--check")) {
    console.error("usage: SYNC_CURATED_API_KEY=<key> node src/sync-curated.ts <base url> <curated dir> [--check]");
    process.exit(2);
  }
  const api = hc<AppType>(url.replace(/\/$/u, ""), { headers: { [API_KEY_HEADER]: key } }).api;
  const texts = await resolveCurated(await readCurated(dir));
  const check = flag === "--check";
  const changes = await sync(api, texts, { check });
  console.log(`${texts.length} texts, ${changes.length} ${check ? "to make" : "made"}`);
  if (check && changes.length > 0) process.exit(1);
}

if (import.meta.main) await main();
