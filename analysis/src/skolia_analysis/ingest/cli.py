"""skolia-ingest: configured by environment variables, so the same image runs under
wrangler dev and on Cloudflare.

  SKOLIA_HTTP_PORT     takes jobs as POST /jobs on this port (see http.py)
  SKOLIA_S3_BUCKET     blob bucket
  SKOLIA_S3_ENDPOINT   S3 endpoint (R2, or wrangler dev's local R2); unset for AWS
  SKOLIA_S3_HOST       Host header for the endpoint; optional, for wrangler dev
                       (see S3Blobs)
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION   S3 credentials
  SKOLIA_LEXICON       Polish lexicon .sqlite (skolia-build-lexicon)
  SKOLIA_VALENCY       Polish verb frames .json (skolia-build-valency); optional, for
                       explaining cases by what verbs require
  SKOLIA_MODEL         Polish parser model (default: the plugin's default)
"""

import logging
import os
import signal
import sys
from pathlib import Path
from types import FrameType

from .. import pl
from ..lexicon import bundle
from ..lexicon import pl as lexicon_pl
from ..lexicon.store import Lexicon
from ..valency import Valency
from .blobs import S3Blobs
from .http import HttpJobs, serve
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
        bundle=lambda blob: bundle.make(
            blob, lexicon, converter.paradigms, valency.frames if valency else bundle.no_frames
        ),
        analyzer=pl.analyzer_name(parser.name, valency=valency),
        lexicon_version=lexicon.version(),
    )


def stop_on_sigterm(_signum: int, _frame: FrameType | None) -> None:
    log.info("SIGTERM: stopping")
    sys.exit(0)


def job_source() -> HttpJobs:
    """Listening starts before the pipeline loads (which takes a while), so the container
    counts as started and jobs wait in memory meanwhile."""
    port = int(env("SKOLIA_HTTP_PORT"))
    jobs = HttpJobs()
    serve(jobs, "0.0.0.0", port)
    log.info("accepting jobs on port %s", port)
    return jobs


def main() -> None:
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        return
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # In a container ingest is PID 1, which ignores SIGTERM unless it handles it: the
    # Cloudflare container would never stop it
    signal.signal(signal.SIGTERM, stop_on_sigterm)
    queue = job_source()
    blobs = S3Blobs(
        env("SKOLIA_S3_BUCKET"),
        os.environ.get("SKOLIA_S3_ENDPOINT") or None,
        os.environ.get("SKOLIA_S3_HOST") or None,
    )
    lexicon_path = Path(env("SKOLIA_LEXICON"))
    model = os.environ.get("SKOLIA_MODEL") or pl.DEFAULT_MODEL
    log.info("loading %s pipeline (model %s)", pl.LANG, model)
    valency = os.environ.get("SKOLIA_VALENCY")
    if not valency:
        log.warning("SKOLIA_VALENCY not set: case reasons won't use verb frames")
    pipelines = {pl.LANG: polish(lexicon_path, Path(valency) if valency else None, model)}
    ingester = Ingester(blobs, pipelines)
    ingester.publish_versions()
    log.info("waiting for jobs")
    ingester.run(queue)
