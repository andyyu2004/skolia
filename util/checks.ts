// SQLite column checks for SQL written in TypeScript, such as the user Durable Object's
// migrations. An applied migration's SQL is checksummed, so what these make can't change:
// a new kind of check is a new function.

/** The column is a time as toISOString() writes it. */
export const iso = (column: string) => `CHECK (${column} IS strftime('%Y-%m-%dT%H:%M:%fZ', ${column}))`;

/** The column is null or a time as toISOString() writes it. */
export const isoOrNull = (column: string) => `CHECK (${column} IS NULL OR ${column} IS strftime('%Y-%m-%dT%H:%M:%fZ', ${column}))`;
