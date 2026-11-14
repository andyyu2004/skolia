import * as z from "zod";
import type { Migration } from "./migrations/index.ts";

export const LogEntry = z.object({
  seq: z.number().int(),
  version: z.number().int().positive(),
  name: z.string(),
  direction: z.enum(["up", "down"]),
  checksum: z.string(),
  /** An up's down as it was when the up was applied; null on a down, and on an up logged before downs were kept */
  down: z.string().nullable(),
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
  down: string | null;
}

export class MigrationError extends Error {
  override name = "MigrationError";
}

export async function checksum(sql: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function withChecksums(migrations: readonly Migration[]): Promise<Checksummed[]> {
  return Promise.all(migrations.map(async (m) => ({ ...m, upChecksum: await checksum(m.up), downChecksum: await checksum(m.down) })));
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
    if (migration.name !== entry.name)
      return [`version ${entry.version} was applied as ${entry.name} but is ${migration.name} in the code`];
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
    steps.push({ version: v, name: m.name, direction: "up", sql: m.up, checksum: m.upChecksum, down: m.down });
  }
  for (let v = current; v > target; v--) {
    const m = migrations[v - 1]!;
    steps.push({ version: v, name: m.name, direction: "down", sql: m.down, checksum: m.downChecksum, down: null });
  }
  return steps;
}

/** The step that reverts the latest applied migration with the down it was applied with, if
 * it's the code's last migration and has been edited since: while a migration is being
 * written, its edits are redone this way where MUTABLE_FINAL_USER_MIGRATION is set. */
export async function revertEdited(stack: readonly LogEntry[], migrations: readonly Checksummed[]): Promise<Step | null> {
  const top = stack.at(-1);
  const last = migrations.at(-1);
  if (top === undefined || last === undefined || top.down === null) return null;
  if (top.version !== last.version || top.name !== last.name || top.checksum === last.upChecksum) return null;
  return { version: top.version, name: top.name, direction: "down", sql: top.down, checksum: await checksum(top.down), down: null };
}
