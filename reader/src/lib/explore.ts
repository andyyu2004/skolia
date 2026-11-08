// Explore's filters: language, who imported a text, and a search of titles.
import type { DocumentSummary, Lang } from "@skolia/shared/api";

/** Everyone, the viewer, or another importer by name. Other importers' names are
 * prefixed so that one named "all" or "mine" can't be taken for the others. */
export type ImporterFilter = "all" | "mine" | `by:${string}`;

export interface Filters {
  lang: Lang | "all";
  importer: ImporterFilter;
  query: string;
}

/** Everyone else who imported one of the texts, by name, sorted. */
export function otherImporters(documents: DocumentSummary[]): string[] {
  return [...new Set(documents.filter((d) => !d.mine).map((d) => d.importerName))].sort((a, b) => a.localeCompare(b));
}

function byImporter(d: DocumentSummary, importer: ImporterFilter): boolean {
  if (importer === "all") return true;
  if (importer === "mine") return d.mine;
  return !d.mine && `by:${d.importerName}` === importer;
}

export function filterDocuments(documents: DocumentSummary[], { lang, importer, query }: Filters): DocumentSummary[] {
  const q = query.trim().toLocaleLowerCase();
  return documents.filter(
    (d) => (lang === "all" || d.lang === lang) && byImporter(d, importer) && (q === "" || d.title.toLocaleLowerCase().includes(q)),
  );
}
