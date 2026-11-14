import assert from "node:assert/strict";
import { test } from "node:test";
import { timestamp, type Annotation, type DocumentId, type DocumentSummary, type UserId } from "@skolia/shared/api";
import { plan, toCurated, type Curated, type CuratedAnnotation } from "./sync-curated.ts";

const TEXT = { title: "A", licence: "cc0", tags: {}, text: "Ala ma kota." } as const;
const KOT = { kind: "text", data: { text: "cat" }, licence: "cc0", start: 7, end: 11 } as const;
const ALA = { kind: "text", data: { text: "Alice" }, licence: "cc0", start: 0, end: 3 } as const;

function summary({ id, request }: Curated): DocumentSummary {
  return {
    id,
    title: request.title ?? "",
    lang: request.lang,
    importedAt: timestamp(new Date(0)),
    words: 3,
    visibility: "public",
    licence: request.licence,
    author: null,
    source: null,
    tags: {},
    importer: { id: "curated" as UserId, name: "Curated" },
    mine: true,
    state: "ready",
  };
}

function stored({ id, request }: CuratedAnnotation): Annotation {
  return { ...request, id, author: null, source: null, addedAt: timestamp(new Date(0)) };
}

const kinds = (changes: ReturnType<typeof plan>) =>
  changes.map((c) => (c.kind === "annotate" || c.kind === "unannotate" ? `${c.kind} ${c.annotation.id}` : c.kind));

test("a text imported now gets all its annotations, after every import", async () => {
  const text = await toCurated("pl/a.yaml", "pl", { ...TEXT, annotations: [KOT, ALA] });
  const other = await toCurated("pl/b.yaml", "pl", { ...TEXT, text: "Inny tekst.", annotations: [] });
  const [kot, ala] = text.annotations.map((a) => a.id);
  assert.deepEqual(kinds(plan([text, other], [], new Map())), ["import", "import", `annotate ${kot}`, `annotate ${ala}`]);
});

test("an imported text's annotations not in its file are removed, and those missing added", async () => {
  const before = await toCurated("pl/a.yaml", "pl", { ...TEXT, annotations: [KOT, ALA] });
  const after = await toCurated("pl/a.yaml", "pl", { ...TEXT, annotations: [{ ...KOT, data: { text: "a cat" } }, ALA] });
  const [kot, ala] = before.annotations;
  const [edited] = after.annotations;
  assert.ok(kot && ala && edited);
  const had = new Map<DocumentId, readonly Annotation[]>([[before.id, [kot, ala].map(stored)]]);
  assert.deepEqual(plan([before], [summary(before)], had), []);
  assert.deepEqual(kinds(plan([after], [summary(after)], had)), [`unannotate ${kot.id}`, `annotate ${edited.id}`]);
  assert.deepEqual(kinds(plan([{ ...after, annotations: [] }], [summary(after)], had)), [`unannotate ${kot.id}`, `unannotate ${ala.id}`]);
});
