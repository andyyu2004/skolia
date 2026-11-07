// Print the frame patterns the word sheet would show, for some lemmas of a bundle.
// usage: node shared/scripts/show-frames.ts BUNDLE.json pl:szukać:VERB pl:mieć:VERB ...
import { readFileSync } from "node:fs";
import type { Bundle } from "@skolia/shared/schema";
import { frames } from "../lang/pl/frames.ts";

const [path, ...ids] = process.argv.slice(2);
if (!path) throw new Error("usage: show-frames.ts BUNDLE.json LEMMA_ID...");
const bundle = JSON.parse(readFileSync(path, "utf-8")) as Bundle;
for (const id of ids) {
  const entry = bundle.entries[id];
  if (!entry) {
    console.log(`${id}: not in the bundle`);
    continue;
  }
  const shown = frames(entry.frames);
  console.log(`\n${entry.lemma} (${entry.frames.length} schemata, ${shown.length} patterns)`);
  for (const frame of shown) {
    const tags = frame.tags.length ? `  (${frame.tags.join(", ")})` : "";
    const head = `${entry.lemma}${frame.reflexive ? " się" : ""}`;
    console.log(`  ${frame.idiom ? "idiom " : "      "}${head} ${frame.pattern}${tags}`);
  }
}
