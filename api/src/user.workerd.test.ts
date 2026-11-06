import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { createTestHarness, type TestHarness } from "wrangler";
import type { KnownLemma, LemmaStatus } from "@skolia/shared/api";

const dist = new URL("../dist/", import.meta.url);

interface UserStub {
  lemmas(): Promise<KnownLemma[]>;
  setLemma(lemmaId: string, status: LemmaStatus, updated: string): Promise<void>;
}

interface Env {
  USER: { getByName(name: string): UserStub };
}

let server: TestHarness;

before(async () => {
  assert.ok(existsSync(new URL("main.js", dist)), "api/dist/main.js is missing: mise run build first");
  server = createTestHarness({
    root: new URL("..", import.meta.url).pathname,
    workers: [{ configPath: "./wrangler.jsonc", env: "", prebuiltWorkerDir: dist.pathname }],
  });
  await server.listen();
});

after(() => server.close());

test("each user's Durable Object keeps its own lemmas", async () => {
  const env = await server.getWorker<Env>().getEnv();
  const alice = env.USER.getByName("alice");
  await alice.setLemma("pl:pies:NOUN", "learning", "2026-11-06T00:00:00.000Z");
  await alice.setLemma("pl:pies:NOUN", "known", "2026-11-06T01:00:00.000Z");
  assert.deepEqual(await alice.lemmas(), [
    { lemmaId: "pl:pies:NOUN", status: "known", updated: "2026-11-06T01:00:00.000Z" },
  ]);
  assert.deepEqual(await env.USER.getByName("bob").lemmas(), []);
});

test("the bundled migrations made the tables, and ran once", async () => {
  const env = await server.getWorker<Env>().getEnv();
  await env.USER.getByName("carol").lemmas();
  const storage = await server.getWorker().getDurableObjectStorage("User", { name: "carol" });
  const tables = await storage.exec<{ name: string }>("select name from sqlite_master where type = 'table' order by name");
  assert.ok(tables.some((t) => t.name === "known_lemma"));
  assert.deepEqual(await storage.exec("select count(*) as n from __drizzle_migrations"), [{ n: 1 }]);
});

test("schema.ts's withoutRowid tables are WITHOUT ROWID", async () => {
  const env = await server.getWorker<Env>().getEnv();
  await env.USER.getByName("dave").lemmas();
  const storage = await server.getWorker().getDurableObjectStorage("User", { name: "dave" });
  const [table] = await storage.exec<{ sql: string }>("select sql from sqlite_master where name = 'known_lemma'");
  assert.match(table?.sql ?? "", /WITHOUT ROWID\s*$/);
});
