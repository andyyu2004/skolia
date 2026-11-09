#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["json5==0.17.3"]
# ///
"""Wrangler configs and URL for a preview environment, pr-<N> (one per pull request):
  preview.py config pr-12   writes api/wrangler.pr-12.json and api/wrangler.ingest.pr-12.json
  preview.py url pr-12      prints its workers.dev URL
Each config is the committed config's env.staging block at the top level, with -pr-12
for -staging in the names, and no routes: a preview is on
workers.dev only. Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import cast

import json5

type Json = str | int | float | bool | None | list[Json] | dict[str, Json]
type JsonObject = dict[str, Json]

API = Path(__file__).resolve().parent.parent / "api"
# The end-to-end tests take one per language, so ten deploys a day
MAX_IMPORTS_PER_DAY = "20"
# A preview's only jobs are its deploy's (the end-to-end tests, then the curated sync), so its
# containers needn't wait long for more
PREVIEW_SLEEP_AFTER = "10s"


def as_object(value: Json, what: str) -> JsonObject:
    if not isinstance(value, dict):
        raise SystemExit(f"{what}: not an object")
    return value


def as_string(value: Json, what: str) -> str:
    if not isinstance(value, str):
        raise SystemExit(f"{what}: not a string")
    return value


def variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} isn't set")
    return value


def read(file: str) -> JsonObject:
    return as_object(cast(Json, json5.loads((API / file).read_text())), file)


def rename(value: Json, env: str) -> Json:
    if isinstance(value, str):
        return re.sub(r"-staging$", f"-{env}", value)
    if isinstance(value, list):
        return [rename(v, env) for v in value]
    if isinstance(value, dict):
        return {k: rename(v, env) for k, v in value.items()}
    return value


def promote(file: str, env: str) -> JsonObject:
    """Bindings, routes and vars aren't inherited by an environment, so staging's replace
    the top level's; the rest (main, assets, migrations) is the top level's"""
    top = read(file)
    environments = as_object(top.pop("env", None), f"{file} env")
    staging = as_object(environments.get("staging"), f"{file} env.staging")
    config = as_object(rename({**top, **staging}, env), file)
    config.pop("routes", None)
    config["name"] = f"{as_string(top.get('name'), f'{file} name')}-{env}"
    return config


def url(env: str) -> str:
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{variable('CLOUDFLARE_ACCOUNT_ID')}/workers/subdomain",
        headers={"Authorization": f"Bearer {variable('CLOUDFLARE_API_TOKEN')}"},
    )
    with urllib.request.urlopen(request) as response:
        body = as_object(cast(Json, json.load(response)), "workers.dev subdomain")
    subdomain = as_string(as_object(body.get("result"), "workers.dev subdomain").get("subdomain"), "subdomain")
    name = as_string(read("wrangler.jsonc").get("name"), "wrangler.jsonc name")
    return f"https://{name}-{env}.{subdomain}.workers.dev"


def config(env: str) -> None:
    web = promote("wrangler.jsonc", env)
    web["workers_dev"] = True
    web["preview_urls"] = False
    web["vars"] = {**as_object(web.get("vars"), "vars"), "MAX_IMPORTS_PER_DAY": MAX_IMPORTS_PER_DAY, "BASE_URL": url(env)}
    ingest = promote("wrangler.ingest.jsonc", env)
    ingest["vars"] = {**as_object(ingest.get("vars"), "vars"), "SLEEP_AFTER": PREVIEW_SLEEP_AFTER}
    configs = {f"wrangler.{env}.json": web, f"wrangler.ingest.{env}.json": ingest}
    for file, content in configs.items():
        text = json.dumps(content, indent=2)
        if "staging" in text:
            raise SystemExit(f"{file}: still names staging")
        (API / file).write_text(f"{text}\n")
        print(f"api/{file}")


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("config", "url") or not re.fullmatch(r"pr-[0-9]+", sys.argv[2]):
        raise SystemExit("usage: preview.py <config|url> pr-<N>")
    command, env = sys.argv[1], sys.argv[2]
    if command == "url":
        print(url(env))
    else:
        config(env)


if __name__ == "__main__":
    main()
