import assert from "node:assert/strict";
import { test } from "node:test";
import { MigrationError, applied, checksum, plan, problems, withChecksums, type LogEntry } from "./migrator.ts";

const MIGRATIONS = await withChecksums([
  { version: 1, name: "one", up: "CREATE TABLE one (id TEXT)", down: "DROP TABLE one" },
  { version: 2, name: "two", up: "CREATE TABLE two (id TEXT)", down: "DROP TABLE two" },
]);
const [ONE, TWO] = MIGRATIONS as [(typeof MIGRATIONS)[0], (typeof MIGRATIONS)[0]];

let seq = 0;
function entry(version: number, direction: "up" | "down", fields: Partial<LogEntry> = {}): LogEntry {
  const m = MIGRATIONS[version - 1]!;
  const sum = direction === "up" ? m.upChecksum : m.downChecksum;
  return { seq: ++seq, version, name: m.name, direction, checksum: sum, appliedAt: "2026-11-07T00:00:00.000Z", ...fields };
}

test("a checksum is the SHA-256 of the exact SQL", async () => {
  assert.equal(await checksum(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.notEqual(await checksum("DROP TABLE one"), await checksum("DROP TABLE one "));
});

test("replaying the log leaves the ups that weren't reverted", () => {
  assert.deepEqual(applied([]), []);
  const log = [entry(1, "up"), entry(2, "up"), entry(2, "down"), entry(2, "up")];
  assert.deepEqual(applied(log), [log[0], log[3]]);
  assert.deepEqual(applied([entry(1, "up"), entry(1, "down")]), []);
});

test("a log that skips or reverts out of order is refused", () => {
  assert.throws(() => applied([entry(2, "up")]), MigrationError);
  assert.throws(() => applied([entry(1, "up"), entry(1, "up")]), MigrationError);
  assert.throws(() => applied([entry(1, "up"), entry(2, "up"), entry(1, "down")]), MigrationError);
  assert.throws(() => applied([entry(1, "down")]), MigrationError);
});

test("applied migrations must still be in the code, unedited and under the same name", () => {
  assert.deepEqual(problems([entry(1, "up"), entry(2, "up")], MIGRATIONS), []);
  assert.deepEqual(problems([entry(1, "up", { checksum: "edited" })], MIGRATIONS), ["version 1 (one) was edited after it was applied"]);
  assert.deepEqual(problems([entry(1, "up", { name: "uno" })], MIGRATIONS), ["version 1 was applied as uno but is one in the code"]);
  assert.deepEqual(problems([entry(1, "up"), entry(2, "up")], [ONE]), ["version 2 (two) is applied but isn't in the code"]);
});

test("a plan goes up or down one version at a time, to any version in the code", () => {
  assert.deepEqual(
    plan(0, 2, MIGRATIONS).map((s) => [s.version, s.direction, s.sql, s.checksum]),
    [
      [1, "up", ONE.up, ONE.upChecksum],
      [2, "up", TWO.up, TWO.upChecksum],
    ],
  );
  assert.deepEqual(
    plan(2, 0, MIGRATIONS).map((s) => [s.version, s.direction, s.sql, s.checksum]),
    [
      [2, "down", TWO.down, TWO.downChecksum],
      [1, "down", ONE.down, ONE.downChecksum],
    ],
  );
  assert.deepEqual(plan(1, 1, MIGRATIONS), []);
  assert.throws(() => plan(0, 3, MIGRATIONS), MigrationError);
  assert.throws(() => plan(0, -1, MIGRATIONS), MigrationError);
  assert.throws(() => plan(0, 1.5, MIGRATIONS), MigrationError);
});
