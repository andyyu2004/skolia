import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { MIGRATIONS } from "./index.ts";

test("MIGRATIONS lists every migration file, numbered from 1 in order", async () => {
  const files = readdirSync(new URL(".", import.meta.url))
    .filter((f) => /^\d{4}_.+\.ts$/u.test(f))
    .sort();
  assert.deepEqual(
    files.map((f) => Number(f.slice(0, 4))),
    files.map((_, i) => i + 1),
  );
  const loaded: unknown[] = await Promise.all(files.map((f) => import(`./${f}`)));
  assert.equal(MIGRATIONS.length, loaded.length);
  MIGRATIONS.forEach((m, i) => assert.equal(m, loaded[i]));
});
