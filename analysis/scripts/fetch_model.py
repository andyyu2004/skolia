"""Download one Hugging Face model at a fixed revision into the cache, for the Cloudflare
image (analysis/flake.nix): one image layer per model, as Cloudflare's registry times
out on a single 3 GB layer.

  python scripts/fetch_model.py REPO REVISION [FILE ...]

COMBO loads models by name, which the cache resolves through refs/main, so refs/main is
pointed at the pinned revision.
"""

import sys
from pathlib import Path

from huggingface_hub import (
    constants,
    snapshot_download,  # pyright: ignore[reportUnknownVariableType]
)


def main() -> None:
    repo, revision, *files = sys.argv[1:]
    snapshot_download(repo, revision=revision, allow_patterns=files or None)
    refs = Path(constants.HF_HUB_CACHE) / f"models--{repo.replace('/', '--')}" / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text(revision)


if __name__ == "__main__":
    main()
