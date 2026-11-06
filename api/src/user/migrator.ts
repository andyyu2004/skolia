import * as z from "zod";
import type { Migration } from "./migrations/index.ts";

export const LogEntry = z.object({
  seq: z.number().int(),
  version: z.number().int().positive(),
  name: z.string(),
  direction: z.enum(["up", "down"]),
  checksum: z.string(),
  appliedAt: z.string(),
});
export type LogEntry = z.output<typeof LogEntry>;
export type Direction = LogEntry["direction"];

export interface Checksummed extends Migration {
  upChecksum: string;
  downChecksum: string;
}

export interface Step {
  version: number;
  name: string;
  direction: Direction;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  override name = "MigrationError";
}

export const LOG_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS migration_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('up', 'down')),
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TRIGGER IF NOT EXISTS migration_log_no_update BEFORE UPDATE ON migration_log
    BEGIN SELECT RAISE(ABORT, 'migration_log is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS migration_log_no_delete BEFORE DELETE ON migration_log
    BEGIN SELECT RAISE(ABORT, 'migration_log is append-only'); END`,
];

export const READ_LOG = `SELECT seq, version, name, direction, checksum, applied_at AS "appliedAt" FROM migration_log ORDER BY seq`;

export const APPEND_LOG = "INSERT INTO migration_log (version, name, direction, checksum, applied_at) VALUES (?, ?, ?, ?, ?)";

export async function checksum(sql: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function withChecksums(migrations: readonly Migration[]): Promise<Checksummed[]> {
  return Promise.all(
    migrations.map(async (m) => ({ ...m, upChecksum: await checksum(m.up), downChecksum: await checksum(m.down) })),
  );
}

export function applied(log: readonly LogEntry[]): LogEntry[] {
  const stack: LogEntry[] = [];
  for (const entry of log) {
    if (entry.direction === "up") {
      if (entry.version !== stack.length + 1) {
        throw new MigrationError(`log entry ${entry.seq} applies version ${entry.version} on top of version ${stack.length}`);
      }
      stack.push(entry);
    } else {
      if (entry.version !== stack.length) {
        throw new MigrationError(`log entry ${entry.seq} reverts version ${entry.version} but version ${stack.length} is current`);
      }
      stack.pop();
    }
  }
  return stack;
}

export function problems(stack: readonly LogEntry[], migrations: readonly Checksummed[]): string[] {
  return stack.flatMap((entry) => {
    const migration = migrations[entry.version - 1];
    if (migration === undefined) return [`version ${entry.version} (${entry.name}) is applied but isn't in the code`];
    if (migration.name !== entry.name) return [`version ${entry.version} was applied as ${entry.name} but is ${migration.name} in the code`];
    if (migration.upChecksum !== entry.checksum) return [`version ${entry.version} (${entry.name}) was edited after it was applied`];
    return [];
  });
}

export function plan(current: number, target: number, migrations: readonly Checksummed[]): Step[] {
  if (!Number.isInteger(target) || target < 0 || target > migrations.length) {
    throw new MigrationError(`no version ${target}: the versions are 0 to ${migrations.length}`);
  }
  const steps: Step[] = [];
  for (let v = current + 1; v <= target; v++) {
    const m = migrations[v - 1]!;
    steps.push({ version: v, name: m.name, direction: "up", sql: m.up, checksum: m.upChecksum });
  }
  for (let v = current; v > target; v--) {
    const m = migrations[v - 1]!;
    steps.push({ version: v, name: m.name, direction: "down", sql: m.down, checksum: m.downChecksum });
  }
  return steps;
}
