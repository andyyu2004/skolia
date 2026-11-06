// End-to-end check of a deployed environment: in each language, imports a text no one
// has imported (so its ingest container really runs), waits until it's ready, then
// fetches its analysis and bundle. Uses one of the day's imports per language. First
// checks that the environment serves the expected version, i.e. the deploy took.
// usage: node src/smoke.ts https://staging.skolia.io $(git describe --tags --always --dirty)
import { LANGS, type DocumentSummary, type ImportRequest, type Lang, type Version } from "@skolia/shared/api";

const TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 10 * 1000;
const VERSION_TIMEOUT_MS = 2 * 60 * 1000;

const TEXTS: Record<Lang, string> = {
  en: "I'm looking for the dog that ran away last night.",
  pl: "Szukam psa, który uciekł wczoraj wieczorem.",
};

// A new Worker's workers.dev name can take a while to answer (24 s for a preview's), so
// errors are retried until the deadline too
async function checkVersion(base: string, expected: string): Promise<void> {
  const deadline = Date.now() + VERSION_TIMEOUT_MS;
  for (;;) {
    let result: string;
    try {
      const response = await fetch(`${base}/api/version`);
      if (response.ok) {
        const { version } = (await response.json()) as Version;
        if (version === expected) {
          console.log(`version ${version}`);
          return;
        }
        result = `serving ${version}, expected ${expected}`;
      } else {
        result = `${response.status} ${await response.text()}`;
      }
    } catch (error: unknown) {
      result = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) throw new Error(`version: ${result}`);
    console.log(`version: ${result}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function smoke(base: string, lang: Lang): Promise<void> {
  const at = new Date().toISOString();
  const request: ImportRequest = { title: `smoke test ${at}`, text: `${TEXTS[lang]} Test ${at}.`, lang };
  const posted = await fetch(`${base}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (posted.status !== 202) throw new Error(`import: ${posted.status} ${await posted.text()}`);
  const { id } = (await posted.json()) as DocumentSummary;
  console.log(`${lang}: imported ${id}`);

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const response = await fetch(`${base}/api/documents/${id}`);
    if (!response.ok) throw new Error(`${lang} status: ${response.status} ${await response.text()}`);
    const summary = (await response.json()) as DocumentSummary;
    console.log(`${lang}: ${summary.state}`);
    if (summary.state === "failed") throw new Error(`${lang} analysis failed: ${summary.error ?? ""}`);
    if (summary.state === "ready") {
      if (!summary.reading) throw new Error(`${lang}: ready without analysis and bundle names`);
      for (const [part, name] of Object.entries(summary.reading)) {
        const blob = await fetch(`${base}/api/documents/${id}/${part}/${name}`);
        if (!blob.ok) throw new Error(`${lang} ${part}: ${blob.status}`);
        console.log(`${lang}: ${part} ${name}: ${(await blob.arrayBuffer()).byteLength} bytes`);
      }
      return;
    }
    if (Date.now() > deadline) throw new Error(`${lang}: still ${summary.state} after ${TIMEOUT_MS / 60000} min`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const [, , url, expected] = process.argv;
if (!url || !expected) {
  console.error("usage: node src/smoke.ts <base url> <version>");
  process.exit(2);
}
const base = url.replace(/\/$/, "");
await checkVersion(base, expected);
// The containers are separate, so the languages run at the same time
await Promise.all(LANGS.map((lang) => smoke(base, lang)));
