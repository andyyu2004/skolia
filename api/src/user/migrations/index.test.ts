import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { MIGRATIONS } from "./index.ts";

test("MIGRATIONS lists every migration file in order, versioned from 1 and named after its file", async () => {
  const files = readdirSync(new URL(".", import.meta.url))
    .filter((f) => /^\d{4}_.+\.ts$/u.test(f))
    .sort();
  assert.deepEqual(
    MIGRATIONS.map((m) => `${String(m.version).padStart(4, "0")}_${m.name}.ts`),
    files,
  );
  assert.deepEqual(
    MIGRATIONS.map((m) => m.version),
    MIGRATIONS.map((_, i) => i + 1),
  );
  for (const [i, file] of files.entries()) {
    const { up, down } = (await import(`./${file}`)) as { up: string; down: string };
    assert.deepEqual({ up: MIGRATIONS[i]?.up, down: MIGRATIONS[i]?.down }, { up, down });
  }
});
