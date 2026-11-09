// Makes the curated user's documents match curated/: imports each text there publicly,
// updates the title, licence, author or source of those already imported, and deletes the
// curated user's documents that aren't there any more. A document's id is its text's hash,
// so an edited text is a new document and the old one is deleted. With --check, only
// lists what it would do, and fails if that's anything.
// curated/{lang}/{name}.txt: "key: value" lines (title and licence; author and source if
// known), a line "---", then the text.
// usage: SYNC_CURATED_API_KEY=<key> node src/sync-curated.ts <base url> <texts dir> [--check]
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hc } from "hono/client";
import * as z from "zod";
import { LANGS, type DocumentId, type DocumentSummary, type DocumentUpdate, type Lang } from "@skolia/shared/api";
import { docId } from "@skolia/shared/keys";
import * as schemas from "@skolia/shared/schemas";
import type { AppType } from "./app.ts";
import { API_KEY_HEADER } from "./auth.ts";

const Header = z.strictObject({
  title: z.string(),
  licence: z.string(),
  author: z.string().optional(),
  source: z.string().optional(),
});

export interface Curated {
  path: string;
  id: DocumentId;
  request: z.output<typeof schemas.ImportRequest>;
}

export type Change =
  | { kind: "import"; text: Curated }
  | { kind: "update"; text: Curated; id: DocumentId; update: DocumentUpdate }
  | { kind: "delete"; document: DocumentSummary };

/** A text file's header and text, as a public import. Throws, naming the file, if it isn't one. */
export async function parseCurated(path: string, lang: Lang, raw: string): Promise<Curated> {
  const [head, ...rest] = raw.split(/^---$/mu);
  if (head === undefined || rest.length === 0) throw new Error(`${path}: no "---" line after the header`);
  const fields: Record<string, string> = {};
  for (const line of head.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^([a-z]+):\s*(.*)$/u.exec(line);
    if (!match?.[1] || match[2] === undefined) throw new Error(`${path}: "${line}" isn't "key: value"`);
    fields[match[1]] = match[2].trim();
  }
  const header = Header.safeParse(fields);
  if (!header.success) throw new Error(`${path}: ${header.error.issues[0]?.message ?? "bad header"}`);
  const text = rest.join("---").trim();
  const request = schemas.ImportRequest.safeParse({ ...header.data, text, lang, visibility: "public" });
  if (!request.success) throw new Error(`${path}: ${request.error.issues[0]?.message ?? "not a valid import"}`);
  return { path, id: await docId(lang, text), request: request.data };
}

export async function readCurated(dir: string): Promise<Curated[]> {
  const texts: Curated[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const lang = LANGS.find((l) => l === entry.name);
    if (lang === undefined) throw new Error(`${join(dir, entry.name)}: not a language (${LANGS.join(", ")})`);
    for (const file of (await readdir(join(dir, lang))).sort()) {
      if (!file.endsWith(".txt")) continue;
      const path = join(dir, lang, file);
      texts.push(await parseCurated(path, lang, await readFile(path, "utf8")));
    }
  }
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
    const { title, licence, author, source } = text.request;
    const update: DocumentUpdate = {};
    if (title !== undefined && title !== document.title) update.title = title;
    if (licence !== document.licence) update.licence = licence;
    if ((author ?? null) !== document.author) update.author = author ?? null;
    if ((source ?? null) !== document.source) update.source = source ?? null;
    if (Object.keys(update).length > 0) changes.push({ kind: "update", text, id: text.id, update });
  }
  const wanted = new Set(texts.map((t) => t.id));
  for (const document of mine) {
    if (!wanted.has(document.id)) changes.push({ kind: "delete", document });
  }
  return changes;
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
  const listed = await api.me.documents.$get();
  if (!listed.ok) throw new Error(`list: ${listed.status} ${await listed.text()}`);
  const changes = plan(texts, (await listed.json()).documents);
  for (const change of changes) log(describe(change));
  if (check) return changes;
  for (const change of changes) {
    const what = describe(change);
    if (change.kind === "import") await expectOk(await api.documents.$post({ json: change.text.request }), what);
    else if (change.kind === "update") await expectOk(await api.documents[":id"].$patch({ param: { id: change.id }, json: change.update }), what);
    else await expectOk(await api.documents[":id"].$delete({ param: { id: change.document.id } }), what);
  }
  return changes;
}

async function main(): Promise<void> {
  const [, , url, dir, flag] = process.argv;
  const key = process.env["SYNC_CURATED_API_KEY"];
  if (!url || !dir || !key || (flag !== undefined && flag !== "--check")) {
    console.error("usage: SYNC_CURATED_API_KEY=<key> node src/sync-curated.ts <base url> <texts dir> [--check]");
    process.exit(2);
  }
  const api = hc<AppType>(url.replace(/\/$/u, ""), { headers: { [API_KEY_HEADER]: key } }).api;
  const texts = await readCurated(dir);
  const check = flag === "--check";
  const changes = await sync(api, texts, { check });
  console.log(`${texts.length} texts, ${changes.length} ${check ? "to make" : "made"}`);
  if (check && changes.length > 0) process.exit(1);
}

if (import.meta.main) await main();
