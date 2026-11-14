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

/** SQL text as it is: for a fixed piece of a query written in code, never for a value or a
 * name; sql.id quotes names. */
sql.raw = Sql.raw;

/** Nothing: a fragment for a clause that isn't wanted. */
sql.empty = Sql.raw("");

/** A condition, or a falsy value for one that isn't wanted. */
export type Condition = Sql | false | null | undefined;

const wanted = (parts: readonly Condition[]): readonly Sql[] => parts.filter((part): part is Sql => part instanceof Sql);

/** The wanted conditions joined by AND. Empty for none. */
sql.and = (parts: readonly Condition[]): Sql => sql.join(wanted(parts), " AND ");

/** WHERE and the wanted conditions joined by AND, or nothing for none. */
sql.where = (parts: readonly Condition[]): Sql => (wanted(parts).length === 0 ? sql.empty : sql`WHERE ${sql.and(parts)}`);

/** The values in parentheses, as parameters: (?, ?). */
sql.tuple = (values: readonly (SqlValue | Sql)[]): Sql => sql`(${sql.join(values, ", ")})`;

/** The queries joined by UNION ALL. */
sql.unionAll = (queries: readonly Sql[]): Sql => sql.join(queries, " UNION ALL ");

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** A quoted identifier, its names joined by dots: sql.id("tagged", "user_id") is
 * "tagged"."user_id". For names written in code; anything but a plain name throws. */
sql.id = (...names: readonly string[]): Sql => {
  const bad = names.find((name) => !NAME.test(name));
  if (names.length === 0 || bad !== undefined) throw new Error(`not an SQL name: ${JSON.stringify(bad ?? names)}`);
  return Sql.raw(names.map((name) => `"${name}"`).join("."));
};

const literal = (value: SqlValue): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`no SQL literal for ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
};

/** A value written in as a literal rather than a parameter: for a constant in code that a
 * partial index's WHERE has to see, as SQLite only uses one when the query names the same
 * constant. */
sql.literal = (value: SqlValue): Sql => Sql.raw(literal(value));

/** The query with its parameters written in as literals, for SQL run without parameters
 * (wrangler d1 execute --file). Its own text mustn't have a ? but its placeholders. */
sql.inline = ({ text, params }: Sql): string => {
  const parts = text.split("?");
  if (parts.length !== params.length + 1) throw new Error(`${params.length} parameters for ${parts.length - 1} placeholders`);
  return parts.reduce((inlined, part, i) => inlined + literal(params[i - 1] as SqlValue) + part);
};
