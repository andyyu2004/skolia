// Resolves every curated text as the sync would, fetching those whose kind names a source,
// without an API to sync to: for CI's check-curated job, so a pull request that only
// changes curated/ finds a text that can't be had before it reaches the sync.
// usage: node src/check-curated.ts <curated dir>
import { readCurated, resolveCurated } from "./sync-curated.ts";

async function main(): Promise<void> {
  const [, , dir] = process.argv;
  if (!dir) {
    console.error("usage: node src/check-curated.ts <curated dir>");
    process.exit(2);
  }
  const texts = await resolveCurated(await readCurated(dir));
  console.log(`${texts.length} texts resolved`);
}

if (import.meta.main) await main();
