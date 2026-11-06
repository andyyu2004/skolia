import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { addWithoutRowid, migrationsSource } from "../../scripts/user-migrations.ts";

test("migrations.gen.ts is up to date with drizzle-kit's migrations (pnpm --dir api user-migrations)", () => {
  assert.equal(readFileSync(new URL("migrations.gen.ts", import.meta.url), "utf8"), migrationsSource());
});

test("WITHOUT ROWID goes on the listed tables, and on drizzle-kit's rebuilds of them", () => {
  const rebuild = [
    "CREATE TABLE `__new_a` (\n\t`id` text PRIMARY KEY NOT NULL\n);",
    "INSERT INTO `__new_a`(\"id\") SELECT \"id\" FROM `a`;",
    "CREATE TABLE `b` (\n\t`id` text PRIMARY KEY NOT NULL\n);",
  ].join("\n--> statement-breakpoint\n");
  assert.equal(
    addWithoutRowid(rebuild, ["a"]),
    [
      "CREATE TABLE `__new_a` (\n\t`id` text PRIMARY KEY NOT NULL\n) WITHOUT ROWID;",
      "INSERT INTO `__new_a`(\"id\") SELECT \"id\" FROM `a`;",
      "CREATE TABLE `b` (\n\t`id` text PRIMARY KEY NOT NULL\n);",
    ].join("\n--> statement-breakpoint\n"),
  );
});
