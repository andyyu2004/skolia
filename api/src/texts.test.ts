// The curated texts in texts/, on their own so CI's check-texts job runs them without a build
import assert from "node:assert/strict";
import { test } from "node:test";
import { readCurated } from "./seed.ts";

test("every curated text in texts/ parses", async () => {
  const texts = await readCurated(new URL("../../texts", import.meta.url).pathname);
  assert.ok(texts.length > 0);
});
