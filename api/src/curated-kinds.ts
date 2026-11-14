// The kinds of curated file, curated/{lang}/{name}.yaml. Each is checked without the
// network (CuratedSpec), then resolved to a text and its credits, fetching it if its
// kind names a source.
import * as z from "zod";
import { LICENCES, type Lang, type Licence, type NewAnnotation, type Tags } from "@skolia/shared/api";
import * as schemas from "@skolia/shared/schemas";
import { LABEL, parseSpans } from "./curated-spans.ts";

/** A curated text, its credits and its annotations, as sync-curated imports them. */
export type Resolved = {
  readonly title: string;
  readonly licence: Licence;
  readonly author?: string | undefined;
  readonly source?: string | undefined;
  readonly tags: Tags;
  readonly text: string;
  readonly annotations: readonly NewAnnotation[];
};

const ANNOTATION_FIELDS: readonly string[] = [...Object.keys(schemas.AnnotationCredit.shape), "kind", "data"];

/** An annotation in a curated file: what the API's NewAnnotation takes but where it is,
 * which its span gives. */
const CuratedAnnotation = z
  .looseObject({})
  .superRefine((annotation, context) => {
    const unknown = Object.keys(annotation).filter((key) => !ANNOTATION_FIELDS.includes(key));
    if (unknown.length > 0)
      context.addIssue({ code: "custom", message: `${unknown.join(", ")}: an annotation has only ${ANNOTATION_FIELDS.join(", ")}` });
  })
  .pipe(z.intersection(schemas.AnnotationCredit, schemas.AnnotationContent));

/** The text without its [span]{label} markup (curated-spans.ts), and its spans. */
const MarkedText = z.string().transform((text, context) => {
  try {
    return parseSpans(text);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
    return z.NEVER;
  }
});

/** The text is in the file. annotations: by the label of the span they're on, one or a list. */
const Inline = z
  .strictObject({
    kind: z.literal("inline"),
    title: z.string().min(1),
    licence: z.enum(LICENCES),
    author: z.string().min(1).optional(),
    source: z.string().optional(),
    tags: schemas.Tags.default({}),
    text: MarkedText,
    annotations: z
      .record(
        z.string(),
        z.preprocess((value) => (Array.isArray(value) ? value : [value]), z.array(CuratedAnnotation).min(1)),
      )
      .default({}),
  })
  .superRefine(({ text, annotations }, context) => {
    for (const { label } of text.spans) {
      if (!Object.hasOwn(annotations, label))
        context.addIssue({ code: "custom", path: ["text"], message: `{${label}} has no annotations` });
    }
    const used = new Set(text.spans.map((s) => s.label));
    for (const label of Object.keys(annotations)) {
      const message = LABEL.test(label) ? "no span in the text has this label" : "a label is lowercase letters, digits and hyphens";
      if (!used.has(label)) context.addIssue({ code: "custom", path: ["annotations", label], message });
    }
  });

/** A whole work from Wolne Lektury, by the slug in its catalogue URL
 * (wolnelektury.pl/katalog/lektura/<slug>/). title replaces Wolne Lektury's. */
const WolneLektury = z.strictObject({
  kind: z.literal("wolnelektury"),
  slug: z.string().regex(/^[a-z0-9-]+$/u, "slug must be lowercase letters, digits and hyphens"),
  title: z.string().min(1).optional(),
  tags: schemas.Tags.default({}),
});

export const CuratedSpec = z.discriminatedUnion("kind", [Inline, WolneLektury]);
export type CuratedSpec = z.output<typeof CuratedSpec>;

export type Fetch = (url: string) => Promise<Response>;

/** The text, its credits and its annotations, each where its span is in the text. */
export async function resolve(spec: CuratedSpec, lang: Lang, fetch: Fetch): Promise<Resolved> {
  switch (spec.kind) {
    case "inline": {
      const { kind: _, text, annotations, ...credits } = spec;
      return {
        ...credits,
        text: text.text,
        annotations: text.spans.flatMap(({ label, start, end }) => (annotations[label] ?? []).map((a) => ({ ...a, start, end }))),
      };
    }
    case "wolnelektury":
      return wolneLektury(spec, lang, fetch);
  }
}

const WOLNE_LEKTURY_API = "https://wolnelektury.pl/api/books/";

const Book = z.object({
  title: z.string(),
  /** ISO 639-2: pol */
  language: z.string(),
  /** The catalogue page */
  url: z.url(),
  txt: z.url(),
  authors: z.array(z.object({ name: z.string() })),
});

/** Wolne Lektury's ISO 639-2 language codes, for the languages skolia has. */
const WOLNE_LEKTURY_LANGS: Readonly<Record<string, Lang>> = { pol: "pl", eng: "en", fre: "fr", fra: "fr" };

async function fetched(fetch: Fetch, url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

async function wolneLektury(spec: z.output<typeof WolneLektury>, lang: Lang, fetch: Fetch): Promise<Resolved> {
  const book = Book.parse(await (await fetched(fetch, `${WOLNE_LEKTURY_API}${spec.slug}/`)).json());
  if (WOLNE_LEKTURY_LANGS[book.language] !== lang) throw new Error(`${spec.slug} is in ${book.language}, not ${lang}`);
  const raw = (await (await fetched(fetch, book.txt)).text()).replace(/\r\n/gu, "\n");
  const author = book.authors.map((a) => a.name).join(", ");
  return {
    title: spec.title ?? book.title,
    licence: wolneLekturyLicence(raw),
    ...(author === "" ? {} : { author }),
    source: book.url,
    tags: spec.tags,
    text: wolneLekturyText(raw),
    annotations: [],
  };
}

const FOOTER = "\n-----\n";

/** An ISBN line, which ends a header with any number of blank lines after it. */
const ISBN_LINE = /^ISBN [0-9X-]+\n/mu;

/** The work in a Wolne Lektury .txt: after its header (author and title, which may wrap,
 * then an ISBN line or three blank lines) and before its footer ("-----"), without the line
 * indents and *emphasis* the .txt keeps. */
export function wolneLekturyText(raw: string): string {
  const body = raw.split(FOOTER)[0] ?? "";
  const blank = body.indexOf("\n\n\n\n");
  const isbn = ISBN_LINE.exec(body);
  const start = isbn && (blank < 0 || isbn.index < blank) ? isbn.index + isbn[0].length : blank;
  if (start < 0) throw new Error("no blank lines after the header");
  return body
    .slice(start)
    .split("\n")
    .map((line) => line.trim().replace(/\*([^*\n]+)\*/gu, "$1"))
    .join("\n")
    .trim();
}

/** The work's licence, from the footer of a Wolne Lektury .txt. */
export function wolneLekturyLicence(raw: string): Licence {
  const footer = raw.split(FOOTER)[1];
  if (footer === undefined) throw new Error('no "-----" footer');
  if (footer.includes("Ten utwór jest w domenie publicznej.")) return "public-domain";
  const cc = /creativecommons\.org\/licenses\/(by-sa|by)\//u.exec(footer);
  if (cc) return cc[1] === "by-sa" ? "cc-by-sa" : "cc-by";
  throw new Error("the footer names no licence skolia knows");
}
