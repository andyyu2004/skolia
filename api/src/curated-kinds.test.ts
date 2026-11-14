import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { annotationId } from "@skolia/shared/annotations";
import { docId } from "@skolia/shared/keys";
import { wolneLekturyLicence, wolneLekturyText, type Fetch } from "./curated-kinds.ts";
import { parseCurated, readCurated, resolveCurated } from "./sync-curated.ts";

const FOOTER_PD =
  "\n-----\nTa lektura, podobnie jak tysiące innych, dostępna jest na stronie wolnelektury.pl.\nTen utwór jest w domenie publicznej.\nWszystkie materiały dodatkowe (przypisy, motywy literackie) są udostępnione na Licencji Wolnej Sztuki 1.3: https://artlibre.org/licence/lal/pl/\n";

/** A .txt as Wolne Lektury serves it: CRLF, the title wrapped, an indent and *emphasis*. */
const TXT =
  `Aleksander Fredro\n\nOsiołkowi\nw żłoby dano\n\n\n\nOsiołkowi w żłoby dano\nNagle — *gwizd*!\n\n    Z głodu padła.\n\n\n\n${FOOTER_PD}`.replace(
    /\n/gu,
    "\r\n",
  );

const BOOK = {
  title: "Osiołkowi w żłoby dano",
  language: "pol",
  url: "https://wolnelektury.pl/katalog/lektura/fredro-osiolkowi-w-zloby-dano/",
  txt: "https://wolnelektury.pl/media/book/txt/fredro-osiolkowi-w-zloby-dano.txt",
  authors: [{ name: "Aleksander Fredro" }],
};

/** Wolne Lektury's API and .txt for BOOK, and the URLs asked for. */
function wolneLektury(book: object = BOOK, txt = TXT): { fetch: Fetch; asked: string[] } {
  const asked: string[] = [];
  const fetch: Fetch = async (url) => {
    asked.push(url);
    if (url === "https://wolnelektury.pl/api/books/fredro-osiolkowi-w-zloby-dano/") return Response.json(book);
    if (url === BOOK.txt) return new Response(txt);
    return new Response("not found", { status: 404 });
  };
  return { fetch, asked };
}

const noFetch: Fetch = async (url) => {
  throw new Error(`fetched ${url}`);
};

test("an inline file is its credits and text, and isn't fetched", async () => {
  const yaml =
    "kind: inline\ntitle: Inwokacja\nauthor: Adam Mickiewicz\nlicence: public-domain\nsource: https://wolnelektury.pl/katalog/lektura/pan-tadeusz/\ntags:\n  level: C2\ntext: |\n  Litwo! Ojczyzno moja!\n";
  const [text] = await resolveCurated([parseCurated("pl/a.yaml", "pl", yaml)], noFetch);
  assert.equal(text?.id, await docId("pl", "Litwo! Ojczyzno moja!"));
  assert.deepEqual(text?.request, {
    title: "Inwokacja",
    text: "Litwo! Ojczyzno moja!",
    lang: "pl",
    visibility: "public",
    licence: "public-domain",
    author: "Adam Mickiewicz",
    source: "https://wolnelektury.pl/katalog/lektura/pan-tadeusz/",
    tags: { level: "C2" },
  });
});

test("a file that isn't YAML of a kind is refused, naming the file and what's wrong", () => {
  const refused = (yaml: string, message: RegExp) => assert.throws(() => parseCurated("pl/a.yaml", "pl", yaml), message);
  refused("kind: inline\ntitle: [", /^Error: pl\/a\.yaml: /u);
  refused("kind: gutenberg\nid: 1342\n", /pl\/a\.yaml: kind: /u);
  refused("kind: inline\ntitle: A\ntext: B\n", /pl\/a\.yaml: licence: /u);
  refused("kind: inline\ntitle: A\nlicence: cc0\ntext: B\nyear: 1834\n", /pl\/a\.yaml: .*year/u);
  refused("kind: wolnelektury\nslug: Tuwim Rzepka\n", /pl\/a\.yaml: slug: slug must be/u);
  refused("kind: wolnelektury\nslug: tuwim-rzepka\ntags:\n  level: B 1\n", /pl\/a\.yaml: tags\.level: /u);
  refused("kind: wolnelektury\nslug: tuwim-rzepka\ntags:\n  Level: B1\n", /pl\/a\.yaml: tags\.Level: /u);
  refused("kind: wolnelektury\nslug: tuwim-rzepka\nlicence: cc0\n", /pl\/a\.yaml: .*licence/u);
});

const WLOSY = `kind: inline
title: Włosy
licence: cc-by-nc
text: |

  [Thuli ma krótkie włosy.]{2}

  [Anna ma długie włosy.]{3} Bez adnotacji, i [jedno słowo]{kot}.
annotations:
  "2":
    kind: audio
    data:
      url: https://example.org/02.mp3
    licence: cc-by
    author: Helena Gabriela
    source: https://example.org/story
  3:
    kind: text
    data:
      text: " Anna has long hair. "
    licence: cc0
    author: ""
  kot:
    - kind: text
      data:
        text: cat
      licence: cc0
    - kind: audio
      data:
        url: https://example.org/kot.mp3
      licence: cc0
`;

test("an inline text's annotations are on its spans, in the text without markup, trimmed", async () => {
  const [text] = await resolveCurated([parseCurated("pl/w.yaml", "pl", WLOSY)], noFetch);
  const plain = "Thuli ma krótkie włosy.\n\nAnna ma długie włosy. Bez adnotacji, i jedno słowo.";
  assert.equal(text?.request.text, plain);
  assert.equal(text?.id, await docId("pl", plain));
  assert.deepEqual(
    text?.annotations.map((a) => [plain.slice(a.request.start, a.request.end), a.request.kind]),
    [
      ["Thuli ma krótkie włosy.", "audio"],
      ["Anna ma długie włosy.", "text"],
      ["jedno słowo", "text"],
      ["jedno słowo", "audio"],
    ],
  );
  const kot = { start: 64, end: 75, licence: "cc0", author: null, source: null } as const;
  assert.deepEqual(
    text?.annotations.map((a) => a.id),
    [
      await annotationId({
        kind: "audio",
        data: { url: "https://example.org/02.mp3" },
        licence: "cc-by",
        author: "Helena Gabriela",
        source: "https://example.org/story",
        start: 0,
        end: 23,
      }),
      await annotationId({ kind: "text", data: { text: "Anna has long hair." }, ...kot, start: 25, end: 46 }),
      await annotationId({ kind: "text", data: { text: "cat" }, ...kot }),
      await annotationId({ kind: "audio", data: { url: "https://example.org/kot.mp3" }, ...kot }),
    ],
  );
});

test("bad annotations or markup are refused offline, naming the file and what's wrong", () => {
  const inline = (text: string, annotations: string) =>
    `kind: inline\ntitle: A\nlicence: cc0\ntext: |\n  ${text}\nannotations:\n${annotations}`;
  const annotation = (label: string, fields: string) => `  ${label}:\n${fields.replace(/^/gmu, "    ")}\n`;
  const audio = (label: string) => annotation(label, "kind: audio\ndata:\n  url: https://example.org/a.mp3\nlicence: cc0");
  const refused = (yaml: string, message: RegExp) => assert.throws(() => parseCurated("pl/a.yaml", "pl", yaml), message);
  refused(inline("[a]{x", audio("x")), /^Error: pl\/a\.yaml: text: line 1: \] needs a \{label\}/u);
  refused(inline("[a]{x} [b]{y}", audio("x")), /pl\/a\.yaml: text: \{y\} has no annotations/u);
  refused(inline("[a]{x}", audio("x") + audio("y")), /pl\/a\.yaml: annotations\.y: no span in the text has this label/u);
  refused(inline("[a]{x}", audio("x") + audio("Y")), /pl\/a\.yaml: annotations\.Y: a label is lowercase/u);
  refused(inline("[a]{x}", "  x: []\n"), /pl\/a\.yaml: annotations\.x: /u);
  refused(
    inline("[a]{x}", annotation("x", "kind: video\ndata: {}\nlicence: cc0")),
    /pl\/a\.yaml: annotations\.x\.0\.kind: kind must be audio or text/u,
  );
  refused(
    inline("[a]{x}", annotation("x", "kind: audio\ndata:\n  url: http://example.org/a.mp3\nlicence: cc0")),
    /pl\/a\.yaml: annotations\.x\.0\.data\.url: url must be an https URL/u,
  );
  refused(
    inline("[a]{x}", annotation("x", "kind: text\ndata:\n  text: a\nlicence: all-rights-reserved")),
    /pl\/a\.yaml: annotations\.x\.0\.licence: an annotation needs a licence that allows sharing it/u,
  );
  refused(
    inline("[a]{x}", annotation("x", "kind: text\ndata:\n  text: a\nlicence: cc0\nstart: 0")),
    /pl\/a\.yaml: annotations\.x\.0: start: an annotation has only licence, author, source, kind, data/u,
  );
  refused("kind: wolnelektury\nslug: tuwim-rzepka\nannotations: {}\n", /pl\/a\.yaml: .*annotations/u);
});

test("an annotation given twice on a span is refused", async () => {
  const yaml =
    "kind: inline\ntitle: A\nlicence: cc0\ntext: '[a]{x}'\nannotations:\n  x:\n    - kind: text\n      data:\n        text: a\n      licence: cc0\n    - kind: text\n      data:\n        text: a\n      licence: cc0\n";
  await assert.rejects(resolveCurated([parseCurated("pl/a.yaml", "pl", yaml)], noFetch), /pl\/a\.yaml: the same annotation twice at 0-1/u);
});

test("a span only on what's trimmed is refused", async () => {
  const yaml =
    "kind: inline\ntitle: A\nlicence: cc0\ntext: '[ ]{x}a'\nannotations:\n  x:\n    kind: text\n    data:\n      text: a\n    licence: cc0\n";
  await assert.rejects(
    resolveCurated([parseCurated("pl/a.yaml", "pl", yaml)], noFetch),
    /pl\/a\.yaml: the annotation at 0-0: an annotation must end after it starts/u,
  );
});

test("a public inline text needs a licence that allows sharing it", async () => {
  const file = parseCurated("pl/a.yaml", "pl", "kind: inline\ntitle: A\nlicence: all-rights-reserved\ntext: B\n");
  await assert.rejects(resolveCurated([file], noFetch), /pl\/a\.yaml: a public text needs/u);
});

test("a Wolne Lektury text is the work between its header and footer, without indents or emphasis", () => {
  const raw = TXT.replace(/\r\n/gu, "\n");
  assert.equal(wolneLekturyText(raw), "Osiołkowi w żłoby dano\nNagle — gwizd!\n\nZ głodu padła.");
  assert.throws(() => wolneLekturyText("Fredro\nOsiołkowi\n-----\n"), /no blank lines after the header/u);
});

test("a Wolne Lektury header with an ISBN ends at it, however many blank lines follow", () => {
  const work = "Położył się Dyzio na łące\n\n\n\nI marzy";
  assert.equal(wolneLekturyText(`Julian Tuwim\n\nDyzio marzyciel\n\nISBN 978-83-288-7398-8\n\n\n${work}\n-----\n`), work);
  assert.equal(wolneLekturyText(`Julian Tuwim\n\nDyzio marzyciel\n\nISBN 978-83-288-7398-8\n\n\n\n\n${work}\n-----\n`), work);
});

test("a Wolne Lektury licence is read from its footer", () => {
  assert.equal(wolneLekturyLicence(`a\n\n\n\nb${FOOTER_PD}`), "public-domain");
  const cc = (version: string) =>
    `a\n\n\n\nb\n-----\nTen utwór jest udostępniony na licencji Creative Commons: https://creativecommons.org/licenses/${version}/3.0/\n`;
  assert.equal(wolneLekturyLicence(cc("by-sa")), "cc-by-sa");
  assert.equal(wolneLekturyLicence(cc("by")), "cc-by");
  assert.throws(() => wolneLekturyLicence(cc("by-nc-nd")), /names no licence/u);
  assert.throws(() => wolneLekturyLicence("a\n\n\n\nb"), /no "-----" footer/u);
});

test("a wolnelektury file is fetched: its title, author, licence and catalogue page come from Wolne Lektury, its tags from the file", async () => {
  const { fetch, asked } = wolneLektury();
  const [text] = await resolveCurated(
    [parseCurated("pl/o.yaml", "pl", "kind: wolnelektury\nslug: fredro-osiolkowi-w-zloby-dano\ntags:\n  level: A2\n")],
    fetch,
  );
  assert.deepEqual(asked, ["https://wolnelektury.pl/api/books/fredro-osiolkowi-w-zloby-dano/", BOOK.txt]);
  assert.deepEqual(text?.request, {
    title: "Osiołkowi w żłoby dano",
    text: "Osiołkowi w żłoby dano\nNagle — gwizd!\n\nZ głodu padła.",
    lang: "pl",
    visibility: "public",
    licence: "public-domain",
    author: "Aleksander Fredro",
    source: BOOK.url,
    tags: { level: "A2" },
  });
  const [retitled] = await resolveCurated(
    [parseCurated("pl/o.yaml", "pl", "kind: wolnelektury\nslug: fredro-osiolkowi-w-zloby-dano\ntitle: Osiołek\n")],
    fetch,
  );
  assert.equal(retitled?.request.title, "Osiołek");
  assert.equal(retitled?.id, text?.id);
});

test("a wolnelektury file that can't be had, or is in another language, is refused, naming the file", async () => {
  const file = (slug: string, lang: "pl" | "en" = "pl") => parseCurated(`${lang}/o.yaml`, lang, `kind: wolnelektury\nslug: ${slug}\n`);
  await assert.rejects(
    resolveCurated([file("nie-ma-takiej")], wolneLektury().fetch),
    /pl\/o\.yaml: https:\/\/wolnelektury\.pl\/api\/books\/nie-ma-takiej\/: 404/u,
  );
  await assert.rejects(
    resolveCurated([file("fredro-osiolkowi-w-zloby-dano", "en")], wolneLektury().fetch),
    /en\/o\.yaml: fredro-osiolkowi-w-zloby-dano is in pol, not en/u,
  );
  await assert.rejects(
    resolveCurated([file("fredro-osiolkowi-w-zloby-dano")], wolneLektury({ ...BOOK, txt: "https://wolnelektury.pl/gone.txt" }).fetch),
    /pl\/o\.yaml: .*gone\.txt: 404/u,
  );
});

test("two files with the same text are refused", async () => {
  const same = (path: string) => parseCurated(path, "pl", "kind: inline\ntitle: A\nlicence: cc0\ntext: Ten sam tekst.\n");
  await assert.rejects(resolveCurated([same("pl/a.yaml"), same("pl/b.yaml")], noFetch), /pl\/b\.yaml: the same text as pl\/a\.yaml/u);
});

test("curated/ is read by language, and holds only .yaml files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "curated-"));
  await mkdir(join(dir, "pl"));
  await writeFile(join(dir, "pl", "a.yaml"), "kind: inline\ntitle: A\nlicence: cc0\ntext: Tekst.\n");
  assert.deepEqual(
    (await readCurated(dir)).map((f) => [f.path, f.lang, f.spec.kind]),
    [[join(dir, "pl", "a.yaml"), "pl", "inline"]],
  );
  await writeFile(join(dir, "pl", "b.txt"), "title: B\nlicence: cc0\n---\nTekst.");
  await assert.rejects(readCurated(dir), /b\.txt: not a \.yaml file/u);
  await mkdir(join(dir, "de"));
  await assert.rejects(readCurated(dir), /de: not a language/u);
});
