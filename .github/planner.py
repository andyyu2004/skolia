#!/usr/bin/env python3
"""What a CI run needs to deploy, from the files it changes.

usage: planner.py <event name> <event payload path>

Writes deploy=true|false and texts=true|false to $GITHUB_OUTPUT (or prints them).
deploy is false only when every changed file is content: a curated text (texts/), a doc
(docs/) or Markdown, none of which goes into a build. texts is true when a curated text
changed, so the seed should run. Anything it can't be sure of (a tag, a manual run, a push
with no parent to compare with, a git error) deploys.
"""

import json
import os
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

# fnmatch's * matches / too, so these cover subdirectories
CONTENT = ("texts/*", "docs/*", "*.md")
TEXTS = ("texts/*",)
NO_COMMIT = "0" * 40


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def changed(event: str, payload: dict[str, Any]) -> list[str] | None:
    """The changed paths, or None if there's nothing to compare with."""
    match event:
        case "pull_request":
            base, head = payload["pull_request"]["base"]["sha"], payload["pull_request"]["head"]["sha"]
            return git("diff", "--name-only", f"{base}...{head}").splitlines()
        case "merge_group":
            group = payload["merge_group"]
            return git("diff", "--name-only", group["base_sha"], group["head_sha"]).splitlines()
        case "push" if payload["ref"] == "refs/heads/main" and payload["before"] != NO_COMMIT:
            return git("diff", "--name-only", payload["before"], payload["after"]).splitlines()
        case _:
            return None


def matches(path: str, patterns: tuple[str, ...]) -> bool:
    return any(fnmatch(path, p) for p in patterns)


def main() -> None:
    event, payload_path = sys.argv[1:3]
    payload: dict[str, Any] = json.loads(Path(payload_path).read_text())
    try:
        paths = changed(event, payload)
    except (subprocess.CalledProcessError, KeyError) as e:
        print(f"can't tell what changed, so deploying: {e}", file=sys.stderr)
        paths = None
    deploy = paths is None or not all(matches(p, CONTENT) for p in paths)
    texts = paths is None or any(matches(p, TEXTS) for p in paths)
    print(f"changed: {paths}", file=sys.stderr)
    lines = f"deploy={str(deploy).lower()}\ntexts={str(texts).lower()}\n"
    print(lines, end="")
    if out := os.environ.get("GITHUB_OUTPUT"):
        with open(out, "a") as f:
            f.write(lines)


if __name__ == "__main__":
    main()
