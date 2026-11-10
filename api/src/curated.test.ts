// The curated files in curated/, on their own so CI's check-curated job runs them without a
// build. Only parsed and checked against their kind: fetching a text from its source is
// left to the sync, so a test doesn't need the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readCurated } from "./sync-curated.ts";

test("every file in curated/ is YAML of a curated kind", async () => {
  const files = await readCurated(new URL("../../curated", import.meta.url).pathname);
  assert.ok(files.length > 0);
});
