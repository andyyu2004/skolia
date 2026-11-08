import { apiKey } from "@better-auth/api-key";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { USER_TYPES, type User } from "@skolia/shared/api";
import { UserId, UserType } from "@skolia/shared/schemas";
import * as z from "zod";
import type { Auth } from "./ports.ts";

export interface AuthConfig {
  database: BetterAuthOptions["database"];
  baseURL: string;
  secret: string;
  /** Without it there's no Google sign-in, but API keys still work. */
  google: { clientId: string; clientSecret: string } | undefined;
}

/** The header an API key is sent in. Keys are made only by writing them to D1
 * (e2e-keys.ts, seed-key.ts), for the end-to-end tests and the seed. */
export const API_KEY_HEADER = "x-api-key";

/** The API key plugin's routes, for making and managing keys as a signed-in user. Nobody
 * gets keys that way. */
const API_KEY_PATHS = ["/api-key/create", "/api-key/delete", "/api-key/get", "/api-key/list", "/api-key/update", "/api-key/verify"];

export function authOptions(config: AuthConfig) {
  return {
    database: config.database,
    baseURL: config.baseURL,
    secret: config.secret,
    socialProviders: config.google ? { google: config.google } : {},
    account: { encryptOAuthTokens: true },
    user: { additionalFields: { type: { type: [...USER_TYPES], required: false, defaultValue: "standard", input: false } } },
    disabledPaths: API_KEY_PATHS,
    plugins: [apiKey({ apiKeyHeaders: API_KEY_HEADER, enableSessionForAPIKeys: true, rateLimit: { enabled: false } })],
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

export function createAuth(config: AuthConfig): Auth {
  return toAuth(betterAuth(authOptions(config)));
}

export function toAuth(auth: Pick<ReturnType<typeof betterAuth>, "handler" | "api">): Auth {
  return {
    handle: (request) => auth.handler(request),
    async user(headers) {
      let session;
      try {
        session = await auth.api.getSession({ headers });
      } catch (error: unknown) {
        // An unknown or disabled API key
        if (error instanceof APIError) return null;
        throw error;
      }
      if (!session) return null;
      const { id, name, email, image } = session.user;
      const { type } = z.object({ type: UserType }).parse(session.user);
      return { id: UserId.parse(id), name, email, image: image ?? null, type } satisfies User;
    },
  };
}

export const NO_AUTH: Auth = {
  handle: async () => Response.json({ error: "sign-in isn't configured" }, { status: 503 }),
  user: async () => null,
};
