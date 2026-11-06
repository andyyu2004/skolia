// End-to-end check of a deployed environment: imports a text no one has imported
// (so ingest really runs), waits until it's ready, then fetches its analysis and bundle.
// Uses one of the day's imports. usage: node src/smoke.ts https://staging.skolia.io
import type { DocumentSummary, ImportRequest } from "@skolia/shared/api";

const TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 10 * 1000;

async function main(base: string): Promise<void> {
  const at = new Date().toISOString();
  const request: ImportRequest = {
    title: `smoke test ${at}`,
    text: `Szukam psa, który uciekł wczoraj wieczorem. Test ${at}.`,
    lang: "pl",
  };
  const posted = await fetch(`${base}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (posted.status !== 202) throw new Error(`import: ${posted.status} ${await posted.text()}`);
  const { id } = (await posted.json()) as DocumentSummary;
  console.log(`imported ${id}`);

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const response = await fetch(`${base}/api/documents/${id}`);
    if (!response.ok) throw new Error(`status: ${response.status} ${await response.text()}`);
    const summary = (await response.json()) as DocumentSummary;
    console.log(summary.state);
    if (summary.state === "failed") throw new Error(`analysis failed: ${summary.error ?? ""}`);
    if (summary.state === "ready") {
      if (!summary.reading) throw new Error("ready without analysis and bundle names");
      for (const [part, name] of Object.entries(summary.reading)) {
        const blob = await fetch(`${base}/api/documents/${id}/${part}/${name}`);
        if (!blob.ok) throw new Error(`${part}: ${blob.status}`);
        console.log(`${part} ${name}: ${(await blob.arrayBuffer()).byteLength} bytes`);
      }
      return;
    }
    if (Date.now() > deadline) throw new Error(`still ${summary.state} after ${TIMEOUT_MS / 60000} min`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const base = process.argv[2];
if (!base) {
  console.error("usage: node src/smoke.ts <base url>");
  process.exit(2);
}
await main(base.replace(/\/$/, ""));
