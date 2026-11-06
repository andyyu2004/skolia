"""skolia-ingest: configured by environment variables, so the same image runs under
wrangler dev and on Cloudflare.

  SKOLIA_HTTP_PORT     takes jobs as POST /jobs on this port (see http.py)
  SKOLIA_S3_BUCKET     blob bucket
  SKOLIA_S3_ENDPOINT   S3 endpoint (R2, or wrangler dev's local R2); unset for AWS
  SKOLIA_S3_HOST       Host header for the endpoint; optional, for wrangler dev
                       (see S3Blobs)
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION   S3 credentials
  SKOLIA_LANGS         languages to ingest, comma-separated, e.g. pl,en
  SKOLIA_DATA          the languages' data directory: {lang}.sqlite (skolia-build-lexicon)
                       and each plugin's own files (pl: pl-valency.json)
"""

import logging
import os
import signal
import sys
from pathlib import Path
from types import FrameType

from .. import lang
from ..lexicon.store import Lexicon
from ..plugin import Options, lexicon_path
from .blobs import S3Blobs
from .http import HttpJobs, serve
from .worker import Ingester, Pipeline

log = logging.getLogger("skolia_analysis.ingest")


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"skolia-ingest: set {name} (see skolia-ingest --help)")
    return value


def pipeline(code: str, data: Path) -> Pipeline:
    plugin = lang.plugin(code)
    log.info("loading %s pipeline (model %s)", code, plugin.DEFAULT_MODEL)
    parser = plugin.parser(plugin.DEFAULT_MODEL)
    analyzer = plugin.analyzer(parser, Options(plugin.DEFAULT_SNAP), data)
    lexicon = Lexicon(lexicon_path(data, code))
    return Pipeline(
        lang=code,
        analyze=analyzer,
        bundle=plugin.bundler(lexicon, data),
        analyzer=analyzer.name,
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
    data = Path(env("SKOLIA_DATA"))
    codes = [c.strip() for c in env("SKOLIA_LANGS").split(",") if c.strip()]
    unknown = set(codes) - set(lang.LANGS)
    if unknown:
        sys.exit(f"skolia-ingest: unknown languages in SKOLIA_LANGS: {', '.join(sorted(unknown))}")
    pipelines = {code: pipeline(code, data) for code in codes}
    ingester = Ingester(blobs, pipelines)
    ingester.publish_versions()
    log.info("waiting for jobs")
    ingester.run(queue)
