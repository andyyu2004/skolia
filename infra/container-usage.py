#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Container memory use per environment, the unit Cloudflare bills (GiB-seconds):
  container-usage.py [--since 2026-11-01] [--until 2026-11-30]
By default from the first of this month (UTC) to today. Needs CLOUDFLARE_ACCOUNT_ID and
CLOUDFLARE_API_TOKEN (the Terraform token, infra/README.md).

Reads the GraphQL dataset containersUsageAdaptiveGroups, whose allocatedMemory is in
byte-seconds; its total to 2026-11-07 was within 0.1% of the dashboard's. A container
application that no longer exists, almost always a torn-down preview's, is counted as
"deleted". The free allowance is 25 GiB-hours a month.
"""

import argparse
import datetime
import json
import os
import re
import urllib.request
from collections import defaultdict
from typing import TypedDict, cast

API = "https://api.cloudflare.com/client/v4"
GIB = 2**30
FREE_GIB_SECONDS = 25 * 3600
LIMIT = 10000
QUERY = f"""
query ($account: string!, $since: Date!, $until: Date!) {{
  viewer {{ accounts(filter: {{accountTag: $account}}) {{
    containersUsageAdaptiveGroups(
      limit: {LIMIT}, filter: {{date_geq: $since, date_leq: $until}}
    ) {{
      sum {{ allocatedMemory cpuTimeSec }}
      dimensions {{ applicationId date }}
    }}
  }} }}
}}
"""


class Sum(TypedDict):
    allocatedMemory: float
    cpuTimeSec: float


class Dimensions(TypedDict):
    applicationId: str
    date: str


class Group(TypedDict):
    sum: Sum
    dimensions: Dimensions


class Application(TypedDict):
    id: str
    name: str


def variable(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} isn't set")
    return value


def request(path: str, body: object | None = None) -> object:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API}/{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {variable('CLOUDFLARE_API_TOKEN')}",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as response:
        return cast(object, json.load(response))


def usage(account: str, since: str, until: str) -> list[Group]:
    body = cast(
        dict[str, object],
        request(
            "graphql",
            {"query": QUERY, "variables": {"account": account, "since": since, "until": until}},
        ),
    )
    if body.get("errors"):
        raise SystemExit(f"GraphQL: {body['errors']}")
    data = cast(dict[str, dict[str, list[dict[str, list[Group]]]]], body["data"])
    groups = data["viewer"]["accounts"][0]["containersUsageAdaptiveGroups"]
    if len(groups) == LIMIT:
        raise SystemExit(f"{LIMIT} rows: the result may be cut off; pass a shorter range")
    return groups


def applications(account: str) -> dict[str, str]:
    body = cast(
        dict[str, list[Application]], request(f"accounts/{account}/containers/applications")
    )
    return {app["id"].replace("-", ""): app["name"] for app in body["result"]}


def environment(name: str | None) -> str:
    if name is None:
        return "deleted"
    if re.search(r"-pr-\d+$", name):
        return "previews"
    if name.endswith("-staging"):
        return "staging"
    return "production" if name == "skolia-ingest" else name


def main() -> None:
    today = datetime.datetime.now(datetime.UTC).date()
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--since", default=today.replace(day=1).isoformat())
    parser.add_argument("--until", default=today.isoformat())
    args = parser.parse_args()
    since, until = cast(str, args.since), cast(str, args.until)

    account = variable("CLOUDFLARE_ACCOUNT_ID")
    names = applications(account)
    by_env: defaultdict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    by_day: defaultdict[str, defaultdict[str, float]] = defaultdict(lambda: defaultdict(float))
    for group in usage(account, since, until):
        env = environment(names.get(group["dimensions"]["applicationId"].replace("-", "")))
        gib_seconds = group["sum"]["allocatedMemory"] / GIB
        by_env[env][0] += gib_seconds
        by_env[env][1] += group["sum"]["cpuTimeSec"]
        by_day[group["dimensions"]["date"]][env] += gib_seconds

    total = sum(memory for memory, _ in by_env.values())
    print(
        f"{since} to {until}: {total:,.0f} GiB-s ({total / 3600:.1f} GiB-h),",
        f"{total / FREE_GIB_SECONDS:.0%} of the free 25 GiB-h",
    )
    print(f"{'environment':<12} {'GiB-s':>10} {'share':>6} {'CPU s':>8}")
    for env, (memory, cpu) in sorted(by_env.items(), key=lambda item: -item[1][0]):
        print(f"{env:<12} {memory:>10,.0f} {memory / total if total else 0:>6.0%} {cpu:>8,.0f}")
    envs = sorted(by_env)
    print()
    print(f"{'date':<10} " + " ".join(f"{env:>10}" for env in envs))
    for day in sorted(by_day):
        print(f"{day:<10} " + " ".join(f"{by_day[day][env]:>10,.0f}" for env in envs))


if __name__ == "__main__":
    main()
