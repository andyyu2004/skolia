import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { User } from "@skolia/shared/api";
import type { Auth } from "./ports.ts";

export interface AuthConfig {
  database: BetterAuthOptions["database"];
  baseURL: string;
  secret: string;
  google: { clientId: string; clientSecret: string };
}

export function authOptions(config: AuthConfig) {
  return {
    database: config.database,
    baseURL: config.baseURL,
    secret: config.secret,
    socialProviders: { google: config.google },
    account: { encryptOAuthTokens: true },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

export function createAuth(config: AuthConfig): Auth {
  const auth = betterAuth(authOptions(config));
  return {
    handle: (request) => auth.handler(request),
    async user(headers) {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      const { id, name, email, image } = session.user;
      return { id, name, email, image: image ?? null } satisfies User;
    },
  };
}

export const NO_AUTH: Auth = {
  handle: async () => Response.json({ error: "sign-in isn't configured" }, { status: 503 }),
  user: async () => null,
};
