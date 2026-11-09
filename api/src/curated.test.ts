// The curated texts in curated/, on their own so CI's check-curated job runs them without a build
import assert from "node:assert/strict";
import { test } from "node:test";
import { readCurated } from "./sync-curated.ts";

test("every curated text in curated/ parses", async () => {
  const texts = await readCurated(new URL("../../curated", import.meta.url).pathname);
  assert.ok(texts.length > 0);
});
