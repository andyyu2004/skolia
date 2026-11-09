import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { createTestHarness, type TestHarness } from "wrangler";
import { LANGS, type User } from "@skolia/shared/api";
import { UserId, UserType } from "@skolia/shared/schemas";
import * as z from "zod";
import type { IngestJob } from "@skolia/shared/schema";
import { authOptions, toAuth, type AuthConfig } from "../auth.ts";
import type { Auth } from "../ports.ts";
import { lexiconBinding, lexiconsOf, type LexiconBindings } from "../worker/adapters.ts";
import type { User as UserObject } from "../worker/user.ts";
import type IngestRecorder from "./ingest-recorder.ts";

export const ORIGIN = "http://localhost:5173";

const API = new URL("../../", import.meta.url).pathname;
const DIST = `${API}dist/`;

interface Flush {
  flush: number;
}

export interface TestEnv extends LexiconBindings {
  DB: D1Database;
  USER: DurableObjectNamespace<UserObject>;
  BLOBS: R2Bucket;
  INGEST: Queue<IngestJob | Flush>;
}

export function authConfig(database: D1Database): AuthConfig {
  return {
    database,
    baseURL: ORIGIN,
    secret: "a test secret that is at least 32 characters",
    google: { clientId: "id", clientSecret: "secret" },
  };
}

export interface Local {
  server: TestHarness;
  env: TestEnv;
  auth: Auth;
  signUp(fields: { name: string; email: string }): Promise<User>;
  signIn(userId: string): Promise<Headers>;
  takeQueued(): Promise<IngestJob[]>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function startLocal(): Promise<Local> {
  assert.ok(existsSync(`${DIST}main.js`), "api/dist/main.js is missing: just build first");
  const server = createTestHarness({
    root: API,
    workers: [
      { configPath: "./wrangler.jsonc", env: "", prebuiltWorkerDir: DIST },
      { configPath: "./src/testing/ingest-recorder.jsonc" },
    ],
  });
  await server.listen();
  const worker = server.getWorker<TestEnv>();
  await worker.applyD1Migrations("DB");
  for (const lang of LANGS) await worker.applyD1Migrations(lexiconBinding(lang));
  const env = await worker.getEnv();
  const recorder = await server.getWorker<object, { default: typeof IngestRecorder }>("skolia-ingest").getExport();
  const options = authOptions(authConfig(env.DB));
  const instance = betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
  const { test } = await instance.$context;
  let flushes = 0;

  async function takeQueued(): Promise<IngestJob[]> {
    const flush = ++flushes;
    await env.INGEST.send({ flush });
    for (let tries = 0; tries < 250; tries++) {
      const received = (await recorder.received()) as (IngestJob | Flush)[];
      if (received.some((m) => "flush" in m && m.flush === flush)) {
        await recorder.clear();
        return received.filter((m): m is IngestJob => !("flush" in m));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("the queue didn't deliver within 5 s");
  }

  return {
    server,
    env,
    auth: toAuth(instance),
    async signUp(fields) {
      const saved = await test.saveUser(test.createUser(fields));
      const { id, name, email, image } = saved;
      const { type } = z.object({ type: UserType }).parse(saved);
      return { id: UserId.parse(id), name, email, image: image ?? null, type };
    },
    signIn: (userId) => test.getAuthHeaders({ userId }),
    takeQueued,
    async reset() {
      const tables = ["user_document", "document_content", "apikey", "session", "account", "verification"];
      await env.DB.batch([
        ...tables.map((t) => env.DB.prepare(`DELETE FROM "${t}"`)),
        // The system users are the migrations'
        env.DB.prepare(`DELETE FROM "user" WHERE "type" != 'system'`),
      ]);
      for (const db of Object.values(lexiconsOf(env))) {
        await db.batch(["entry", "featureset", "loaded"].map((t) => db.prepare(`DELETE FROM ${t}`)));
      }
      const { objects } = await env.BLOBS.list();
      if (objects.length > 0) await env.BLOBS.delete(objects.map((o) => o.key));
      await takeQueued();
    },
    close: () => server.close(),
  };
}
