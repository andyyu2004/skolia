// Tags as the reader shows them: "level: B1", and the tags that can be given, by kind.
import type { AvailableTag, Tag } from "@skolia/shared/api";

/** A tag as a badge or option shows it: level: B1. */
export function tagLabel({ kind, value }: Tag): string {
  return `${kind}: ${value}`;
}

/** A kind's name as a form field's label: Level. */
export function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll("-", " ");
}

/** The tags grouped by kind, each kind in the order it first comes, its tags in theirs. */
export function byKind(tags: readonly AvailableTag[]): readonly (readonly [string, readonly AvailableTag[]])[] {
  const kinds = [...new Set(tags.map((t) => t.kind))];
  return kinds.map((kind) => [kind, tags.filter((t) => t.kind === kind)] as const);
}
