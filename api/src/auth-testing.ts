import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import type { User } from "@skolia/shared/api";
import { authOptions, toAuth, type AuthConfig } from "./auth.ts";
import type { Auth } from "./ports.ts";

export const ORIGIN = "http://localhost:5173";

export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0002_auth.sql", import.meta.url), "utf8"));
  return db;
}

export function testConfig(database: DatabaseSync): AuthConfig {
  return {
    database,
    baseURL: ORIGIN,
    secret: "a test secret that is at least 32 characters",
    google: { clientId: "id", clientSecret: "secret" },
  };
}

export interface TestAuth {
  auth: Auth;
  db: DatabaseSync;
  signUp(fields: { name: string; email: string }): Promise<User>;
  signIn(userId: string): Promise<Headers>;
}

export async function testAuth(): Promise<TestAuth> {
  const db = migratedDatabase();
  const instance = betterAuth({ ...authOptions(testConfig(db)), plugins: [testUtils()] });
  const { test } = await instance.$context;
  return {
    auth: toAuth(instance),
    db,
    async signUp(fields) {
      const { id, name, email, image } = await test.saveUser(test.createUser(fields));
      return { id, name, email, image: image ?? null };
    },
    signIn: (userId) => test.getAuthHeaders({ userId }),
  };
}
