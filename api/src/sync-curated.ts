// Makes the curated user's documents match curated/: imports each text there publicly,
// updates the title, licence, author, source or tags of those already imported, and deletes the
// curated user's documents that aren't there any more. A document's id is its text's hash,
// so an edited text, in the file or at its source, is a new document and the old one is
// deleted. Each text's annotations are added, and those not in its file any more removed;
// an annotation's id is a hash of what it says, so an edited one is removed and added again.
// With --check, only lists what it would do, and fails if that's anything.
// curated/{lang}/{name}.yaml: one text, of a kind (curated-kinds.ts) that has it inline or
// names where to fetch it.
// usage: SYNC_CURATED_API_KEY=<key> node src/sync-curated.ts <base url> <curated dir> [--check]
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hc } from "hono/client";
import { parse as parseYaml } from "yaml";
import * as z from "zod";
import {
  ANNOTATION_PAGE,
  DOCUMENT_PAGE,
  LANGS,
  type Annotation,
  type AnnotationId,
  type AnnotationKey,
  type DocumentId,
  type DocumentKey,
  type DocumentSummary,
  type DocumentUpdate,
  type Lang,
  type NewAnnotation,
  type Tags,
} from "@skolia/shared/api";
import { annotationId } from "@skolia/shared/annotations";
import { docId } from "@skolia/shared/keys";
import { allPages, type Cursor } from "@skolia/shared/page";
import * as schemas from "@skolia/shared/schemas";
import type { AppType } from "./app.ts";
import { API_KEY_HEADER } from "./auth.ts";
import { CuratedSpec, resolve, type Fetch, type Resolved } from "./curated-kinds.ts";
import { trimSpans } from "./curated-spans.ts";

/** A curated file, checked but not yet resolved. */
export interface CuratedFile {
  readonly path: string;
  readonly lang: Lang;
  readonly spec: CuratedSpec;
}

/** An annotation on a curated text: the request that adds it, and the id the API gives it. */
export type CuratedAnnotation = {
  readonly id: AnnotationId;
  readonly request: NewAnnotation;
};

export type Curated = {
  readonly path: string;
  readonly id: DocumentId;
  readonly request: z.output<typeof schemas.ImportRequest>;
  readonly annotations: readonly CuratedAnnotation[];
};

export type Change =
  | { kind: "import"; text: Curated }
  | { kind: "update"; text: Curated; id: DocumentId; update: DocumentUpdate }
  | { kind: "delete"; document: DocumentSummary }
  | { kind: "annotate"; text: Curated; annotation: CuratedAnnotation }
  | { kind: "unannotate"; text: Curated; annotation: Annotation };

/** A curated file's YAML, checked against its kind. Throws, naming the file, if it isn't one. */
export function parseCurated(path: string, lang: Lang, raw: string): CuratedFile {
  let yaml: unknown;
  try {
    yaml = parseYaml(raw, { merge: true });
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

/** A resolved text as a public import, trimmed, with its annotations moved to where they
 * are in the trimmed text. Throws, naming the file, if it isn't one or has the same
 * annotation twice. */
export async function toCurated(path: string, lang: Lang, resolved: Resolved): Promise<Curated> {
  const { text, spans } = trimSpans(resolved.text, resolved.annotations);
  const request = schemas.ImportRequest.safeParse({ ...resolved, text, lang, visibility: "public" });
  if (!request.success) throw new Error(`${path}: ${request.error.issues[0]?.message ?? "not a valid import"}`);
  const annotations = await Promise.all(
    spans.map(async (annotation) => {
      const parsed = schemas.NewAnnotation.safeParse(annotation);
      if (!parsed.success)
        throw new Error(
          `${path}: the annotation at ${annotation.start}-${annotation.end}: ${parsed.error.issues[0]?.message ?? "not valid"}`,
        );
      return { id: await annotationId(parsed.data), request: annotation };
    }),
  );
  const twice = annotations.find((a, i) => annotations.findIndex((b) => b.id === a.id) !== i);
  if (twice) throw new Error(`${path}: the same annotation twice at ${twice.request.start}-${twice.request.end}`);
  return { path, id: await docId(lang, text), request: request.data, annotations };
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

/** What makes the curated user's documents, and the annotations on those already imported
 * (by document), match the texts. A text imported now gets all its annotations, after
 * every import. */
export function plan(
  texts: readonly Curated[],
  mine: readonly DocumentSummary[],
  annotations: ReadonlyMap<DocumentId, readonly Annotation[]>,
): Change[] {
  return [...planDocuments(texts, mine), ...planAnnotations(texts, annotations)];
}

function planAnnotations(texts: readonly Curated[], annotations: ReadonlyMap<DocumentId, readonly Annotation[]>): Change[] {
  return texts.flatMap((text): Change[] => {
    const had = annotations.get(text.id) ?? [];
    const wanted = new Set(text.annotations.map((a) => a.id));
    const hadIds = new Set(had.map((a) => a.id));
    return [
      ...had.filter((a) => !wanted.has(a.id)).map((annotation) => ({ kind: "unannotate" as const, text, annotation })),
      ...text.annotations.filter((a) => !hadIds.has(a.id)).map((annotation) => ({ kind: "annotate" as const, text, annotation })),
    ];
  });
}

function planDocuments(texts: readonly Curated[], mine: readonly DocumentSummary[]): Change[] {
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
    case "annotate":
      return `annotate ${change.text.path}: ${describeAnnotation(change.annotation.request)}`;
    case "unannotate":
      return `unannotate ${change.text.path}: ${describeAnnotation(change.annotation)}`;
  }
}

function describeAnnotation({ kind, start, end }: { kind: string; start: number; end: number }): string {
  return `${kind} at ${start}-${end}`;
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
  const imported = new Set(mine.map((d) => d.id));
  const annotations = new Map(
    await Promise.all(texts.filter((t) => imported.has(t.id)).map(async (t) => [t.id, await annotationsOf(api, t.id)] as const)),
  );
  const changes = plan(texts, mine, annotations);
  for (const change of changes) log(describe(change));
  if (check) return changes;
  for (const change of changes) await make(api, change);
  return changes;
}

/** Every page of the signed-in user's annotations on their document. */
function annotationsOf(api: Api, id: DocumentId): Promise<readonly Annotation[]> {
  return allPages(async (after?: Cursor<AnnotationKey>) => {
    const listed = await api.documents[":id"].annotations.$get({ param: { id }, query: { after, limit: String(ANNOTATION_PAGE.max) } });
    if (!listed.ok) throw new Error(`annotations of ${id}: ${listed.status} ${await listed.text()}`);
    return listed.json();
  });
}

async function make(api: Api, change: Change): Promise<void> {
  const what = describe(change);
  switch (change.kind) {
    case "import":
      return expectOk(await api.documents.$post({ json: change.text.request }), what);
    case "update":
      return expectOk(await api.documents[":id"].$patch({ param: { id: change.id }, json: change.update }), what);
    case "delete":
      return expectOk(await api.documents[":id"].$delete({ param: { id: change.document.id } }), what);
    case "annotate":
      return expectOk(
        await api.documents[":id"].annotations.$post({ param: { id: change.text.id }, json: change.annotation.request }),
        what,
      );
    case "unannotate":
      return expectOk(
        await api.documents[":id"].annotations[":annotationId"].$delete({
          param: { id: change.text.id, annotationId: change.annotation.id },
        }),
        what,
      );
  }
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
