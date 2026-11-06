// Wrangler configs and URL for a preview environment, pr-<N> (one per pull request):
//   node src/preview.ts config pr-12   writes wrangler.pr-12.json and wrangler.ingest.pr-12.json
//   node src/preview.ts url pr-12      prints its workers.dev URL
// Each config is the committed config's env.staging block at the top level, with
// -pr-12 for -staging in the names, the D1 id from Terraform, and no routes: a preview
// is on workers.dev only. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, and for
// config the state bucket's credentials (infra/tf.sh).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jsonc from "jsonc-parser";

type Json = string | number | boolean | null | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}

const API = join(import.meta.dirname, "..");
// The smoke test takes one per language, so ten deploys a day
const MAX_IMPORTS_PER_DAY = "20";

function object(value: Json | undefined, what: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what}: not an object`);
  return value;
}

function string(value: Json | undefined, what: string): string {
  if (typeof value !== "string") throw new Error(`${what}: not a string`);
  return value;
}

function variable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} isn't set`);
  return value;
}

function read(file: string): JsonObject {
  const errors: jsonc.ParseError[] = [];
  const value: Json = jsonc.parse(readFileSync(join(API, file), "utf8"), errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`${file}: ${errors.map((e) => `${jsonc.printParseErrorCode(e.error)} at ${e.offset}`).join(", ")}`);
  }
  return object(value, file);
}

function rename(value: Json, env: string): Json {
  if (typeof value === "string") return value.replace(/-staging$/, `-${env}`);
  if (Array.isArray(value)) return value.map((v) => rename(v, env));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rename(v, env)]));
  }
  return value;
}

// Bindings, routes and vars aren't inherited by an environment, so staging's replace the
// top level's; the rest (main, assets, migrations) is the top level's
function promote(file: string, env: string): JsonObject {
  const { env: environments, ...top } = read(file);
  const staging = object(object(environments, `${file} env`).staging, `${file} env.staging`);
  const config = object(rename({ ...top, ...staging }, env), file);
  delete config.routes;
  config.name = `${string(top.name, `${file} name`)}-${env}`;
  return config;
}

async function url(env: string): Promise<string> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${variable("CLOUDFLARE_ACCOUNT_ID")}/workers/subdomain`,
    { headers: { authorization: `Bearer ${variable("CLOUDFLARE_API_TOKEN")}` } },
  );
  const body = (await response.json()) as { success: boolean; result: { subdomain: string } | null };
  if (!response.ok || !body.success || !body.result) throw new Error(`workers.dev subdomain: ${response.status}`);
  return `https://${string(read("wrangler.jsonc").name, "wrangler.jsonc name")}-${env}.${body.result.subdomain}.workers.dev`;
}

async function config(env: string): Promise<void> {
  const databaseId = execFileSync(join(API, "../infra/tf.sh"), [env, "output", "-raw", "d1_database_id"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const web = promote("wrangler.jsonc", env);
  web.workers_dev = true;
  web.preview_urls = false;
  if (!Array.isArray(web.d1_databases)) throw new Error("wrangler.jsonc: no d1_databases");
  for (const database of web.d1_databases) object(database, "d1_databases").database_id = databaseId;
  web.vars = { ...object(web.vars, "vars"), MAX_IMPORTS_PER_DAY, BASE_URL: await url(env) };
  const configs = { [`wrangler.${env}.json`]: web, [`wrangler.ingest.${env}.json`]: promote("wrangler.ingest.jsonc", env) };
  for (const [file, content] of Object.entries(configs)) {
    const text = JSON.stringify(content, null, 2);
    if (text.includes("staging")) throw new Error(`${file}: still names staging`);
    writeFileSync(join(API, file), `${text}\n`);
    console.log(`api/${file}`);
  }
}

const [, , command, env] = process.argv;
if (!env || !/^pr-[0-9]+$/.test(env) || (command !== "config" && command !== "url")) {
  console.error("usage: node src/preview.ts <config|url> pr-<N>");
  process.exit(2);
}
if (command === "url") console.log(await url(env));
else await config(env);
