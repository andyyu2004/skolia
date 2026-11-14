// Queries put together as values, untyped, compiled to a Sql: select, insertInto, update,
// deleteFrom and unionAll, with conditions from eq, and, exists and the like.
//
// A string is a column where an expression goes (a selected value, the left of a
// comparison, row, groupBy, orderBy, a function's argument): "entry.title" is
// "entry"."title", through sql.id, so anything but a plain name throws. It's a parameter
// where a value goes (the right of a comparison, inList, values, set, limit). col() makes a
// column of a value's place, and lit() writes a constant in, for a partial index to see. A
// Sql fragment goes anywhere, as it is; a query, as a subquery.

import { Sql, sql, type Condition, type SqlValue } from "./sql.ts";

/** Anything compiled to a Sql. */
export type Query = { readonly sql: Sql };

/** A query, or a Sql as it is. */
export const compile = (query: Query | Sql): Sql => (query instanceof Sql ? query : query.sql);

/** Where an expression goes: a string is a column. */
export type Expr = string | Sql | Query | number | null;

/** Where a value goes: a string is a parameter, an array a row of them. */
export type Value = SqlValue | readonly SqlValue[] | Sql | Query;

const isQuery = (value: unknown): value is Query =>
  typeof value === "object" && value !== null && !(value instanceof Sql) && "sql" in value;

const isRow = (value: unknown): value is readonly SqlValue[] => Array.isArray(value);

/** A column: "entry.title" is "entry"."title". */
export const col = (name: string): Sql => sql.id(...name.split("."));

/** A constant written in as a literal. */
export const lit = (value: SqlValue): Sql => sql.literal(value);

const expr = (value: Expr): Sql =>
  typeof value === "string" ? col(value) : value instanceof Sql ? value : isQuery(value) ? sql`(${value.sql})` : sql`${value}`;

const value = (value: Value): Sql =>
  value instanceof Sql ? value : isRow(value) ? sql.tuple(value) : isQuery(value) ? sql`(${value.sql})` : sql`${value}`;

// Conditions

const compare =
  (op: Sql) =>
  (left: Expr, right: Value): Sql =>
    sql`${expr(left)} ${op} ${value(right)}`;

export const eq = compare(sql`=`);
export const ne = compare(sql`!=`);
export const lt = compare(sql`<`);
export const le = compare(sql`<=`);
export const gt = compare(sql`>`);
export const ge = compare(sql`>=`);
/** = that's true for two nulls, and false, not null, for one. */
export const is = compare(sql`IS`);

export const isNull = (left: Expr): Sql => sql`${expr(left)} IS NULL`;
export const isNotNull = (left: Expr): Sql => sql`${expr(left)} IS NOT NULL`;

/** Expressions as a row, to compare with a row of values: gt(row("a", "b"), [x, y]). */
export const row = (...exprs: readonly Expr[]): Sql => sql.tuple(exprs.map(expr));

/** One of the values, or a row's among rows of values (IN (VALUES ...)). */
export const inList = (left: Expr, values: readonly (SqlValue | readonly SqlValue[])[]): Sql =>
  values.some(isRow)
    ? sql`${expr(left)} IN (VALUES ${sql.join(values.map(value), ", ")})`
    : sql`${expr(left)} IN ${sql.tuple(values as readonly SqlValue[])}`;

/** One of what the query selects. */
export const inQuery = (left: Expr, query: Query): Sql => sql`${expr(left)} IN (${query.sql})`;

/** The text has the string in it, as it is: no character is a wildcard. */
export const contains = (left: Expr, part: string): Sql => sql`${expr(left)} LIKE ${`%${part.replace(/[\\%_]/gu, "\\$&")}%`} ESCAPE '\\'`;

export const exists = (query: Query): Sql => sql`EXISTS (${query.sql})`;

export const not = (condition: Sql): Sql => sql`NOT ${condition}`;

/** The wanted conditions all hold. */
export const and = (...conditions: readonly Condition[]): Sql => sql.and(conditions);

/** One of the wanted conditions holds; false for none. */
export const or = (...conditions: readonly Condition[]): Sql => {
  const any = conditions.filter((c): c is Sql => c instanceof Sql);
  return any.length === 0 ? sql`0` : sql`(${sql.join(any, " OR ")})`;
};

export const desc = (term: Expr): Sql => sql`${expr(term)} DESC`;

export const fn = {
  count: (of?: Expr): Sql => (of === undefined ? sql`count(*)` : sql`count(${expr(of)})`),
  countDistinct: (of: Expr): Sql => sql`count(DISTINCT ${expr(of)})`,
  min: (of: Expr): Sql => sql`min(${expr(of)})`,
  coalesce: (...of: readonly Expr[]): Sql => sql`coalesce(${sql.join(of.map(expr), ", ")})`,
  iif: (condition: Sql, then: Expr, otherwise: Expr): Sql => sql`iif(${condition}, ${expr(then)}, ${expr(otherwise)})`,
  jsonGroupObject: (key: Expr, of: Expr): Sql => sql`json_group_object(${expr(key)}, ${expr(of)})`,
};

// Queries

/** What a select or RETURNING gives: named values (expr AS "name"), or columns as they are. */
export type Columns = Readonly<Record<string, Expr>> | readonly string[];

const columns = (selected: Columns): Sql => {
  const items = isRow(selected)
    ? (selected as readonly string[]).map(col)
    : Object.entries(selected as Readonly<Record<string, Expr>>).map(([name, of]) => sql`${expr(of)} AS ${sql.id(name)}`);
  return items.length === 0 ? sql`1` : sql.join(items, ", ");
};

const source = (table: string, as: string | undefined): Sql => (as === undefined ? sql.id(table) : sql`${sql.id(table)} AS ${sql.id(as)}`);

/** The clauses that have text, between spaces. */
const clauses = (parts: readonly Sql[]): Sql =>
  sql.join(
    parts.filter((part) => part.text !== ""),
    " ",
  );

const terms = (of: readonly Expr[]): Sql => sql.join(of.map(expr), ", ");

type SelectParts = {
  readonly columns: Sql;
  readonly from: Sql;
  readonly joins: readonly Sql[];
  readonly where: readonly Condition[];
  readonly groupBy: Sql;
  readonly orderBy: Sql;
  readonly limit: Sql;
};

export class Select {
  readonly #parts: SelectParts;

  constructor(parts: SelectParts) {
    this.#parts = parts;
  }

  #with(parts: Partial<SelectParts>): Select {
    return new Select({ ...this.#parts, ...parts });
  }

  from(table: string, as?: string): Select {
    return this.#with({ from: sql`FROM ${source(table, as)}` });
  }

  join(table: string, on: Sql): Select;
  join(table: string, as: string, on: Sql): Select;
  join(table: string, asOrOn: string | Sql, on?: Sql): Select {
    return this.#join(sql`JOIN`, table, asOrOn, on);
  }

  leftJoin(table: string, on: Sql): Select;
  leftJoin(table: string, as: string, on: Sql): Select;
  leftJoin(table: string, asOrOn: string | Sql, on?: Sql): Select {
    return this.#join(sql`LEFT JOIN`, table, asOrOn, on);
  }

  #join(kind: Sql, table: string, asOrOn: string | Sql, on: Sql | undefined): Select {
    const [as, condition] = typeof asOrOn === "string" ? [asOrOn, on ?? sql`1`] : [undefined, asOrOn];
    return this.#with({ joins: [...this.#parts.joins, sql`${kind} ${source(table, as)} ON ${condition}`] });
  }

  /** The wanted conditions, ANDed with those it has. */
  where(...conditions: readonly Condition[]): Select {
    return this.#with({ where: [...this.#parts.where, ...conditions] });
  }

  groupBy(...of: readonly Expr[]): Select {
    return this.#with({ groupBy: sql`GROUP BY ${terms(of)}` });
  }

  orderBy(...of: readonly Expr[]): Select {
    return this.#with({ orderBy: sql`ORDER BY ${terms(of)}` });
  }

  limit(count: Value): Select {
    return this.#with({ limit: sql`LIMIT ${value(count)}` });
  }

  get sql(): Sql {
    const { from, joins, where, groupBy, orderBy, limit } = this.#parts;
    return clauses([sql`SELECT ${this.#parts.columns}`, from, ...joins, sql.where(where), groupBy, orderBy, limit]);
  }
}

/** A query for these values; select({}) selects 1, for EXISTS. */
export const select = (selected: Columns): Select =>
  new Select({
    columns: columns(selected),
    from: sql.empty,
    joins: [],
    where: [],
    groupBy: sql.empty,
    orderBy: sql.empty,
    limit: sql.empty,
  });

/** The queries' rows together, ordered by the names of their columns and limited as a whole. */
export class UnionAll {
  readonly #queries: readonly Select[];
  readonly #orderBy: Sql;
  readonly #limit: Sql;

  constructor(queries: readonly Select[], orderBy: Sql, limit: Sql) {
    this.#queries = queries;
    this.#orderBy = orderBy;
    this.#limit = limit;
  }

  orderBy(...names: readonly string[]): UnionAll {
    return new UnionAll(this.#queries, sql`ORDER BY ${terms(names)}`, this.#limit);
  }

  limit(count: Value): UnionAll {
    return new UnionAll(this.#queries, this.#orderBy, sql`LIMIT ${value(count)}`);
  }

  get sql(): Sql {
    return clauses([sql.unionAll(this.#queries.map((query) => query.sql)), this.#orderBy, this.#limit]);
  }
}

export const unionAll = (queries: readonly Select[]): UnionAll => new UnionAll(queries, sql.empty, sql.empty);

/** Values by column; an undefined one is left out. */
type Values = Readonly<Record<string, Value | undefined>>;

const given = (values: Values): readonly [string, Value][] =>
  Object.entries(values).filter((entry): entry is [string, Value] => entry[1] !== undefined);

const assignments = (values: Values): Sql =>
  sql.join(
    given(values).map(([name, to]) => sql`${col(name)} = ${value(to)}`),
    ", ",
  );

/** What an insert does with a row that conflicts on target (a unique index's columns, with
 * where for a partial one): nothing, or with set, updates the row, where setWhere holds. */
type OnConflict = { readonly where?: Sql; readonly set?: Values; readonly setWhere?: Sql };

type InsertParts = {
  readonly table: string;
  readonly orIgnore: boolean;
  readonly values: Values;
  readonly onConflict: Sql;
  readonly returning: Sql;
};

export class Insert {
  readonly #parts: InsertParts;

  constructor(parts: InsertParts) {
    this.#parts = parts;
  }

  values(values: Values): Insert {
    return new Insert({ ...this.#parts, values });
  }

  /** INSERT OR IGNORE: a row that breaks a constraint isn't inserted, and isn't an error. */
  orIgnore(): Insert {
    return new Insert({ ...this.#parts, orIgnore: true });
  }

  onConflict(target: readonly string[], { where, set, setWhere }: OnConflict = {}): Insert {
    const onConflict = clauses([
      sql`ON CONFLICT ${sql.tuple(target.map(col))}`,
      where === undefined ? sql.empty : sql`WHERE ${where}`,
      set === undefined ? sql`DO NOTHING` : sql`DO UPDATE SET ${assignments(set)}`,
      setWhere === undefined ? sql.empty : sql`WHERE ${setWhere}`,
    ]);
    return new Insert({ ...this.#parts, onConflict });
  }

  returning(selected: Columns): Insert {
    return new Insert({ ...this.#parts, returning: sql`RETURNING ${columns(selected)}` });
  }

  get sql(): Sql {
    const { table, orIgnore, onConflict, returning } = this.#parts;
    const values = given(this.#parts.values);
    return clauses([
      sql`INSERT ${orIgnore ? sql`OR IGNORE ` : sql.empty}INTO ${sql.id(table)}`,
      sql.tuple(values.map(([name]) => col(name))),
      sql`VALUES ${sql.tuple(values.map(([, of]) => value(of)))}`,
      onConflict,
      returning,
    ]);
  }
}

export const insertInto = (table: string): Insert =>
  new Insert({ table, orIgnore: false, values: {}, onConflict: sql.empty, returning: sql.empty });

export class Update {
  readonly #table: string;
  readonly #set: Values;
  readonly #where: readonly Condition[];

  constructor(table: string, set: Values, conditions: readonly Condition[]) {
    this.#table = table;
    this.#set = set;
    this.#where = conditions;
  }

  set(values: Values): Update {
    return new Update(this.#table, values, this.#where);
  }

  where(...conditions: readonly Condition[]): Update {
    return new Update(this.#table, this.#set, [...this.#where, ...conditions]);
  }

  get sql(): Sql {
    return clauses([sql`UPDATE ${sql.id(this.#table)} SET ${assignments(this.#set)}`, sql.where(this.#where)]);
  }
}

export const update = (table: string): Update => new Update(table, {}, []);

export class Delete {
  readonly #table: string;
  readonly #where: readonly Condition[];

  constructor(table: string, conditions: readonly Condition[]) {
    this.#table = table;
    this.#where = conditions;
  }

  where(...conditions: readonly Condition[]): Delete {
    return new Delete(this.#table, [...this.#where, ...conditions]);
  }

  get sql(): Sql {
    return clauses([sql`DELETE FROM ${sql.id(this.#table)}`, sql.where(this.#where)]);
  }
}

export const deleteFrom = (table: string): Delete => new Delete(table, []);
