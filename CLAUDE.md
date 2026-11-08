# Notes for Claude

- Open items and follow-ups go in git-bug (`git bug bug`, `git bug bug new --non-interactive -t … -m …`), as the current identity. Bugs are local refs: don't `git bug push` unless asked. A running `git bug webui` holds the lock; ask rather than stop it.
- main moves quickly. Fetch and branch from `origin/main`, and rebase before pushing more work onto an open PR.
- API tests call the typed client: `client(app, headers)` (src/testing/app.ts) with `body()` and `expectStatus()` (src/testing/responses.ts). `raw()` is only for requests the client can't express, such as malformed JSON.
- Users have a `type`, `standard` or `system` (migration 0006). System users skip the daily import cap and don't count toward it: `system` is the e2e tests' importer (src/e2e-keys.ts), `curated` the seed's (src/seed-key.ts). Each script replaces only its own API key id.
- Curated texts live in `texts/{lang}/*.txt` (header lines, `---`, text) and every deploy seeds them (`just seed <env>`, src/seed.ts). An edited text is a new document; the old one is deleted.
- Two different things are called `Ingester`: the Durable Object in api/src/worker/ingest.ts, which starts the container and hands it jobs, and the job loop in analysis/src/skolia_analysis/ingest/worker.py.
- The API binds the ingest Worker's `Ingester` (`INGESTER`, `script_name`) to ask where a document is in the queue. The workerd test harness has no ingest Worker, so src/testing/ingest-recorder is named `skolia-ingest` and has a stub `Ingester`.
- api/src/bundle.test.ts caps the gzipped Worker bundle. CI's gzip came out about 1 KiB bigger than a local macOS build, so leave some room when raising it.
