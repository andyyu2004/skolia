// The curated files in curated/, on their own so CI's check-curated job runs them without a
// build. Only parsed and checked against their kind: fetching a text from its source is
// left to the sync, so a test doesn't need the network. Inline texts, which aren't fetched,
// are resolved too.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { docId } from "@skolia/shared/keys";
import { readCurated, resolveCurated } from "./sync-curated.ts";

const CURATED = new URL("../../curated", import.meta.url).pathname;

test("every file in curated/ is YAML of a curated kind", async () => {
  const files = await readCurated(CURATED);
  assert.ok(files.length > 0);
});

test("every inline text resolves, and one without [span]{label} markup is imported as it is in its file", async () => {
  const inline = (await readCurated(CURATED)).filter((f) => f.spec.kind === "inline");
  const texts = await resolveCurated(inline, async (url) => assert.fail(`fetched ${url}`));
  const plain = inline.flatMap((file, i) =>
    file.spec.kind === "inline" && file.spec.text.spans.length === 0 ? [{ file, text: texts[i] }] : [],
  );
  assert.ok(plain.length > 0);
  for (const { file, text } of plain) {
    const raw = (parseYaml(await readFile(file.path, "utf8")) as { text: string }).text.trim();
    assert.equal(text?.request.text, raw, file.path);
    assert.equal(text?.id, await docId(file.lang, raw), file.path);
    assert.deepEqual(text?.annotations, [], file.path);
  }
});
