"""Download Stanza models for one language at a fixed revision into a Stanza resources
directory, for the Cloudflare image (analysis/flake.nix).

  python scripts/fetch_stanza.py DIR LANG REVISION MODEL ...

MODEL is a path under the repo's models/, e.g. pos/combined_electra-large.pt. They land
in DIR/LANG/, where Stanza looks for them (STANZA_RESOURCES_DIR=DIR). resources.json is
fetched separately (the flake pins its hash).
"""

import shutil
import sys
from pathlib import Path

from huggingface_hub import snapshot_download  # pyright: ignore[reportUnknownVariableType]


def main() -> None:
    out, lang, revision, *models = sys.argv[1:]
    staging = Path(out) / ".download"
    snapshot_download(
        f"stanfordnlp/stanza-{lang}",
        revision=revision,
        allow_patterns=[f"models/{m}" for m in models],
        local_dir=staging,
    )
    for model in models:
        target = Path(out) / lang / model
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(staging / "models" / model, target)
    shutil.rmtree(staging)


if __name__ == "__main__":
    main()
