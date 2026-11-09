#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Fills the skolia-tf-providers bucket, infra/terraformrc's network mirror, with each
provider in infra/.terraform.lock.hcl for PLATFORMS, and does nothing when it has them
all. A zip whose sha256 isn't one of the lock file's zh: hashes is refused. The registry
sends Terraform to GitHub's releases, which time out for unauthenticated requests at
times, so a zip there is downloaded with gh (GH_TOKEN in CI). Uploading needs
CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN; without them it fails if anything is
missing.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, cast

INFRA = Path(__file__).resolve().parent
BUCKET = "skolia-tf-providers"
PLATFORMS = ("linux_amd64", "darwin_arm64")
ATTEMPTS = 3
TIMEOUT_S = 120


class Archive(TypedDict):
    url: str
    hashes: list[str]


class VersionDoc(TypedDict):
    archives: dict[str, Archive]


class IndexDoc(TypedDict):
    versions: dict[str, dict[str, str]]


class RegistryDownload(TypedDict):
    filename: str
    download_url: str
    shasum: str


@dataclass(frozen=True)
class Provider:
    host: str
    namespace: str
    name: str
    version: str
    zip_sha256s: frozenset[str]

    @property
    def path(self) -> str:
        return f"{self.host}/{self.namespace}/{self.name}"


def locked_providers(lock: str) -> list[Provider]:
    def provider(address: str, body: str) -> Provider:
        host, namespace, name = address.split("/")
        version = re.search(r'^\s*version\s*=\s*"([^"]+)"', body, re.M)
        if version is None:
            raise SystemExit(f"{address}: no version in the lock file")
        return Provider(
            host,
            namespace,
            name,
            version[1],
            frozenset(re.findall(r'"zh:([0-9a-f]{64})"', body)),
        )

    blocks = cast(
        list[tuple[str, str]],
        re.findall(r'^provider "([^"]+)" \{\n(.*?)^\}', lock, re.M | re.S),
    )
    return [provider(address, body) for address, body in blocks]


def mirror_url() -> str:
    url = re.search(r'url\s*=\s*"([^"]+/)"', (INFRA / "terraformrc").read_text())
    if url is None:
        raise SystemExit("infra/terraformrc: no network_mirror url ending in /")
    return url[1]


def request(
    url: str,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> bytes | None:
    """The response's body, or None on 404. Retries timeouts and 5xx."""
    for attempt in range(1, ATTEMPTS + 1):
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={"User-Agent": "skolia-mirror-providers"} | (headers or {}),
        )
        deadline = time.monotonic() + TIMEOUT_S
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as response:
                body = bytearray()
                while chunk := cast(bytes, response.read(1 << 20)):
                    if time.monotonic() > deadline:
                        raise TimeoutError(f"not done after {TIMEOUT_S} s")
                    body += chunk
                return bytes(body)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code < 500 or attempt == ATTEMPTS:
                detail = e.read().decode(errors="replace")[:500]
                raise SystemExit(f"{method} {url}: {e.code} {e.reason} {detail}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == ATTEMPTS:
                raise SystemExit(f"{method} {url}: {e}") from e
        print(f"{method} {url}: attempt {attempt} failed, retrying", file=sys.stderr)
        time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def download(url: str) -> bytes:
    github = re.fullmatch(
        r"https://github\.com/([^/]+/[^/]+)/releases/download/([^/]+)/([^/]+)", url
    )
    if github is None:
        body = request(url)
        if body is None:
            raise SystemExit(f"GET {url}: 404")
        return body
    repo, tag, filename = github[1], github[2], github[3]
    with tempfile.TemporaryDirectory() as dir:
        out = Path(dir) / filename
        for attempt in range(1, ATTEMPTS + 1):
            try:
                subprocess.run(
                    [
                        "gh",
                        "release",
                        "download",
                        tag,
                        "-R",
                        repo,
                        "-p",
                        filename,
                        "-O",
                        str(out),
                        "--clobber",
                    ],
                    check=True,
                    timeout=TIMEOUT_S,
                )
                return out.read_bytes()
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                if attempt == ATTEMPTS:
                    raise SystemExit(
                        f"gh release download {tag} -R {repo} -p {filename}: {e}"
                    ) from e
                print(f"{filename}: attempt {attempt} failed, retrying", file=sys.stderr)
    raise AssertionError("unreachable")


@dataclass(frozen=True)
class Bucket:
    account_id: str
    token: str

    def put(self, key: str, body: bytes, content_type: str) -> None:
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}"
            f"/r2/buckets/{BUCKET}/objects/{urllib.parse.quote(key, safe='')}"
        )
        request(
            url,
            method="PUT",
            data=body,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": content_type},
        )
        print(f"uploaded {key}")

    def put_json(self, key: str, doc: VersionDoc | IndexDoc) -> None:
        self.put(key, json.dumps(doc, indent=2).encode(), "application/json")


def mirror_package(provider: Provider, platform: str, bucket: Bucket) -> Archive:
    if provider.host != "registry.terraform.io":
        raise SystemExit(f"{provider.path}: only registry.terraform.io is supported")
    os_name, arch = platform.split("_")
    meta_url = (
        f"https://registry.terraform.io/v1/providers/{provider.namespace}/{provider.name}"
        f"/{provider.version}/download/{os_name}/{arch}"
    )
    body = request(meta_url)
    if body is None:
        raise SystemExit(f"{provider.path} {provider.version}: no {platform} package")
    meta = cast(RegistryDownload, json.loads(body))
    if meta["shasum"] not in provider.zip_sha256s:
        raise SystemExit(f"{meta['filename']}: the registry's sha256 isn't in the lock file")
    package = download(meta["download_url"])
    sha256 = hashlib.sha256(package).hexdigest()
    if sha256 != meta["shasum"]:
        raise SystemExit(f"{meta['filename']}: sha256 {sha256}, the lock file has {meta['shasum']}")
    bucket.put(f"{provider.path}/{meta['filename']}", package, "application/zip")
    return {"url": meta["filename"], "hashes": [f"zh:{sha256}"]}


def bucket_from_env() -> Bucket:
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not account_id or not token:
        raise SystemExit(
            "the mirror is missing providers, and uploading them needs CLOUDFLARE_ACCOUNT_ID"
            " and CLOUDFLARE_API_TOKEN (a fork's pull request has neither: someone with"
            " them runs just mirror-providers)"
        )
    return Bucket(account_id, token)


def main() -> None:
    mirror = mirror_url()
    for provider in locked_providers((INFRA / ".terraform.lock.hcl").read_text()):
        index_body = request(f"{mirror}{provider.path}/index.json")
        version_body = request(f"{mirror}{provider.path}/{provider.version}.json")
        index = cast(IndexDoc, json.loads(index_body)) if index_body else IndexDoc(versions={})
        archives = cast(VersionDoc, json.loads(version_body))["archives"] if version_body else {}
        missing = [p for p in PLATFORMS if p not in archives]
        if not missing and provider.version in index["versions"]:
            print(f"{provider.path} {provider.version}: in the mirror")
            continue
        print(f"{provider.path} {provider.version}: mirroring {', '.join(missing) or 'its index'}")
        bucket = bucket_from_env()
        added = {p: mirror_package(provider, p, bucket) for p in missing}
        bucket.put_json(
            f"{provider.path}/{provider.version}.json", VersionDoc(archives=archives | added)
        )
        bucket.put_json(
            f"{provider.path}/index.json",
            IndexDoc(versions=index["versions"] | {provider.version: {}}),
        )


if __name__ == "__main__":
    main()
