import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { docId } from "@skolia/shared/keys";
import { wolneLekturyLicence, wolneLekturyText, type Fetch } from "./curated-kinds.ts";
import { parseCurated, readCurated, resolveCurated } from "./sync-curated.ts";

const FOOTER_PD = "\n-----\nTa lektura, podobnie jak tysiące innych, dostępna jest na stronie wolnelektury.pl.\nTen utwór jest w domenie publicznej.\nWszystkie materiały dodatkowe (przypisy, motywy literackie) są udostępnione na Licencji Wolnej Sztuki 1.3: https://artlibre.org/licence/lal/pl/\n";

/** A .txt as Wolne Lektury serves it: CRLF, the title wrapped, an indent and *emphasis*. */
const TXT = `Aleksander Fredro\n\nOsiołkowi\nw żłoby dano\n\n\n\nOsiołkowi w żłoby dano\nNagle — *gwizd*!\n\n    Z głodu padła.\n\n\n\n${FOOTER_PD}`.replace(/\n/gu, "\r\n");

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
  const yaml = "kind: inline\ntitle: Inwokacja\nauthor: Adam Mickiewicz\nlicence: public-domain\nsource: https://wolnelektury.pl/katalog/lektura/pan-tadeusz/\ntags:\n  level: C2\ntext: |\n  Litwo! Ojczyzno moja!\n";
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
  const cc = (version: string) => `a\n\n\n\nb\n-----\nTen utwór jest udostępniony na licencji Creative Commons: https://creativecommons.org/licenses/${version}/3.0/\n`;
  assert.equal(wolneLekturyLicence(cc("by-sa")), "cc-by-sa");
  assert.equal(wolneLekturyLicence(cc("by")), "cc-by");
  assert.throws(() => wolneLekturyLicence(cc("by-nc-nd")), /names no licence/u);
  assert.throws(() => wolneLekturyLicence("a\n\n\n\nb"), /no "-----" footer/u);
});

test("a wolnelektury file is fetched: its title, author, licence and catalogue page come from Wolne Lektury, its tags from the file", async () => {
  const { fetch, asked } = wolneLektury();
  const [text] = await resolveCurated([parseCurated("pl/o.yaml", "pl", "kind: wolnelektury\nslug: fredro-osiolkowi-w-zloby-dano\ntags:\n  level: A2\n")], fetch);
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
  const [retitled] = await resolveCurated([parseCurated("pl/o.yaml", "pl", "kind: wolnelektury\nslug: fredro-osiolkowi-w-zloby-dano\ntitle: Osiołek\n")], fetch);
  assert.equal(retitled?.request.title, "Osiołek");
  assert.equal(retitled?.id, text?.id);
});

test("a wolnelektury file that can't be had, or is in another language, is refused, naming the file", async () => {
  const file = (slug: string, lang: "pl" | "en" = "pl") => parseCurated(`${lang}/o.yaml`, lang, `kind: wolnelektury\nslug: ${slug}\n`);
  await assert.rejects(resolveCurated([file("nie-ma-takiej")], wolneLektury().fetch), /pl\/o\.yaml: https:\/\/wolnelektury\.pl\/api\/books\/nie-ma-takiej\/: 404/u);
  await assert.rejects(resolveCurated([file("fredro-osiolkowi-w-zloby-dano", "en")], wolneLektury().fetch), /en\/o\.yaml: fredro-osiolkowi-w-zloby-dano is in pol, not en/u);
  await assert.rejects(resolveCurated([file("fredro-osiolkowi-w-zloby-dano")], wolneLektury({ ...BOOK, txt: "https://wolnelektury.pl/gone.txt" }).fetch), /pl\/o\.yaml: .*gone\.txt: 404/u);
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
