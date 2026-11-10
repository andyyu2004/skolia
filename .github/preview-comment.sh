#!/usr/bin/env bash
# The pull request's one comment about its preview: preview-comment.sh <number> [--if-exists],
# with the body on stdin. Edits the comment an earlier run left (found by its marker), or
# posts it; with --if-exists, only edits.
# Needs GH_TOKEN, with pull-requests: write, and GH_REPO.
set -euo pipefail

if [[ ! ${1:-} =~ ^[0-9]+$ ]] || [[ $# -gt 2 ]] || [[ $# -eq 2 && $2 != --if-exists ]]; then
  echo "usage: preview-comment.sh <pull request number> [--if-exists] < body" >&2
  exit 1
fi
pr=$1
if_exists=${2:-}
marker='<!-- skolia-preview -->'
body="$marker"$'\n'"$(cat)"

id=$(gh api --paginate "repos/{owner}/{repo}/issues/$pr/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id")
id=${id%%$'\n'*}
if [ -n "$id" ]; then
  gh api --method PATCH "repos/{owner}/{repo}/issues/comments/$id" -f body="$body" >/dev/null
elif [ -z "$if_exists" ]; then
  gh api --method POST "repos/{owner}/{repo}/issues/$pr/comments" -f body="$body" >/dev/null
fi
