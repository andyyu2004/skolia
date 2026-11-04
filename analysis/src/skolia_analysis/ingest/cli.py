"""skolia-ingest: configured by environment variables, so the same image runs locally
(docker compose) and in production.

  SKOLIA_REDIS_URL     queue, e.g. redis://localhost:6379/0
  SKOLIA_S3_BUCKET     blob bucket
  SKOLIA_S3_ENDPOINT   S3 endpoint (MinIO or R2); unset for AWS
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION   S3 credentials
  SKOLIA_LEXICON       Polish lexicon .sqlite (skolia-build-lexicon)
  SKOLIA_VALENCY       Polish verb frames .json (skolia-build-valency); optional, for
                       explaining cases by what verbs require
  SKOLIA_MODEL         Polish parser model (default: the plugin's default)
"""

import logging
import os
import sys
from pathlib import Path

from .. import pl
from ..lexicon import bundle
from ..lexicon import pl as lexicon_pl
from ..lexicon.store import Lexicon
from ..valency import Valency
from .blobs import S3Blobs
from .jobs import RedisQueue
from .worker import Ingester, Pipeline

log = logging.getLogger("skolia_analysis.ingest")


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"skolia-ingest: set {name} (see skolia-ingest --help)")
    return value


def polish(lexicon_path: Path, valency_path: Path | None, model: str) -> Pipeline:
    parser = pl.parser(model)
    candidates = pl.candidate_lookup()
    lexicon = Lexicon(lexicon_path)
    converter = lexicon_pl.Converter()
    valency = Valency.load(valency_path) if valency_path else None
    return Pipeline(
        lang=pl.LANG,
        analyze=lambda text: pl.analyze(text, parser, candidates, valency=valency),
        bundle=lambda blob: bundle.make(blob, lexicon, converter.paradigms),
        lexicon_version=lexicon.meta().get("version", ""),
    )


def main() -> None:
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        return
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    queue = RedisQueue(env("SKOLIA_REDIS_URL"))
    blobs = S3Blobs(env("SKOLIA_S3_BUCKET"), os.environ.get("SKOLIA_S3_ENDPOINT") or None)
    lexicon_path = Path(env("SKOLIA_LEXICON"))
    model = os.environ.get("SKOLIA_MODEL") or pl.DEFAULT_MODEL
    log.info("loading %s pipeline (model %s)", pl.LANG, model)
    valency = os.environ.get("SKOLIA_VALENCY")
    if not valency:
        log.warning("SKOLIA_VALENCY not set: case reasons won't use verb frames")
    pipelines = {pl.LANG: polish(lexicon_path, Path(valency) if valency else None, model)}
    recovered = queue.recover()
    if recovered:
        log.info("put %d unfinished jobs back on the queue", recovered)
    log.info("waiting for jobs")
    Ingester(blobs, pipelines).run(queue)
