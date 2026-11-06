import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

const BUDGET_KIB = 235;

test(`the Worker bundle is at most ${BUDGET_KIB} KiB gzipped`, () => {
  const kib = gzipSync(readFileSync(new URL("../dist/main.js", import.meta.url))).length / 1024;
  assert.ok(
    kib <= BUDGET_KIB,
    `api/dist/main.js is ${kib.toFixed(1)} KiB gzipped. If that's expected, raise BUDGET_KIB in api/src/bundle.test.ts; ` +
      "if not, see what grew with: pnpm --dir api exec wrangler deploy --dry-run --outdir dist --env='' --metafile meta.json",
  );
});
