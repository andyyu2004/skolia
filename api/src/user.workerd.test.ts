import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { createTestHarness, type TestHarness } from "wrangler";
import type { KnownLemma, LemmaStatus } from "@skolia/shared/api";
import { MIGRATIONS } from "./user/migrations/index.ts";

const dist = new URL("../dist/", import.meta.url);

interface UserStub {
  migrate(version: number): Promise<void>;
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

test("a new object is migrated to the latest version, and migrates down to empty and back up", async () => {
  const env = await server.getWorker<Env>().getEnv();
  const carol = env.USER.getByName("carol");
  await carol.lemmas();
  const storage = await server.getWorker().getDurableObjectStorage("User", { name: "carol" });
  const tables = async () => (await storage.exec<{ name: string }>("select name from sqlite_master where type = 'table'")).map((t) => t.name);
  const versions = async () => (await storage.exec<{ version: number }>("select version from migration order by version")).map((r) => r.version);
  const all = MIGRATIONS.map((_, i) => i + 1);

  assert.ok((await tables()).includes("known_lemma"));
  assert.deepEqual(await versions(), all);
  await carol.migrate(0);
  assert.ok(!(await tables()).includes("known_lemma"));
  assert.deepEqual(await versions(), []);
  await carol.migrate(MIGRATIONS.length);
  assert.ok((await tables()).includes("known_lemma"));
  assert.deepEqual(await versions(), all);
  await assert.rejects(carol.migrate(MIGRATIONS.length + 1));
});

test("known_lemma is WITHOUT ROWID", async () => {
  const env = await server.getWorker<Env>().getEnv();
  await env.USER.getByName("dave").lemmas();
  const storage = await server.getWorker().getDurableObjectStorage("User", { name: "dave" });
  const [table] = await storage.exec<{ sql: string }>("select sql from sqlite_master where name = 'known_lemma'");
  assert.match(table?.sql ?? "", /WITHOUT ROWID\s*$/);
});
