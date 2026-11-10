// SQL with its parameters, written as a tagged template: sql`... WHERE id = ${id}` makes
// "... WHERE id = ?" and [id]. A fragment interpolated into another brings its own SQL and
// parameters, so a query is put together from parts without counting placeholders. Only
// fragments become SQL; every other value is a parameter, so can't inject any.

/** What a parameter can be: what D1 (and SQLite) bind. */
export type SqlValue = string | number | null;

export class Sql {
  readonly text: string;
  readonly params: readonly SqlValue[];

  /** Use sql`...`, sql.join or sql.raw. */
  private constructor(text: string, params: readonly SqlValue[]) {
    this.text = text;
    this.params = params;
  }

  static of(strings: readonly string[], values: readonly (SqlValue | Sql)[]): Sql {
    const parts = values.map((value) => (value instanceof Sql ? value : new Sql("?", [value])));
    return new Sql(
      strings.reduce((text, string, i) => text + (parts[i - 1]?.text ?? "") + string, ""),
      parts.flatMap((part) => part.params),
    );
  }

  static raw(text: string): Sql {
    return new Sql(text, []);
  }
}

export function sql(strings: TemplateStringsArray, ...values: readonly (SqlValue | Sql)[]): Sql {
  return Sql.of(strings, values);
}

/** The items, fragments or parameters, between separators: sql.join(ids, ", ") for an IN
 * list. Empty for no items. */
sql.join = (items: readonly (SqlValue | Sql)[], separator: string): Sql =>
  items.length === 0 ? Sql.raw("") : Sql.of(["", ...items.slice(1).map(() => separator), ""], items);

/** SQL text as it is: for a fixed piece of a query, never for a value. */
sql.raw = Sql.raw;

/** Nothing: a fragment for a clause that isn't wanted. */
sql.empty = Sql.raw("");
