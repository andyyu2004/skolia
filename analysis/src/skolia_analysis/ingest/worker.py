"""Process import jobs: text blob -> analysis + bundle blobs, with the status kept current."""

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import brotli

from ..blob import SCHEMA
from ..lexicon.schema import Bundle
from ..schema import Blob
from .blobs import BROTLI, Blobs
from .jobs import JobQueue, Received
from .schema import (
    MAX_TEXT_LENGTH,
    IngestJob,
    State,
    Status,
    analysis_key,
    bundle_key,
    doc_id,
    status_key,
    text_key,
)

log = logging.getLogger(__name__)

JSON = "application/json"
POLL_SECONDS = 5.0
MAX_BACKOFF_SECONDS = 60.0
# Highest quality: about 1.6 s for a 2,800-word story, paid once per import
BROTLI_QUALITY = 11


class JobError(Exception):
    """A job that can't succeed as given; recorded in the status, not retried."""


@dataclass
class Pipeline:
    """What one language needs to ingest a text. Loading it is slow (models), so it's
    built once per worker."""

    lang: str
    analyze: Callable[[str], Blob]
    bundle: Callable[[Blob], Bundle]
    lexicon_version: str


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def compressed_json(value: object) -> bytes:
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    return brotli.compress(data, quality=BROTLI_QUALITY)


class Ingester:
    def __init__(self, blobs: Blobs, pipelines: dict[str, Pipeline]) -> None:
        self._blobs = blobs
        self._pipelines = pipelines

    def process(self, job: IngestJob) -> Status:
        doc = job["doc"]
        try:
            status = self._process(job)
        except JobError as error:
            status = self._status(doc, "failed", error=str(error))
        except Exception as error:
            log.exception("ingest of %s failed", doc)
            status = self._status(doc, "failed", error=f"{type(error).__name__}: {error}")
        return status

    def _process(self, job: IngestJob) -> Status:
        doc = job["doc"]
        pipeline = self._pipelines.get(job["lang"])
        if pipeline is None:
            raise JobError(f"no pipeline for language {job['lang']!r}")
        raw = self._blobs.get(text_key(doc))
        if raw is None:
            raise JobError(f"no text at {text_key(doc)}")
        text = raw.decode("utf-8")
        if doc_id(text) != doc:
            raise JobError("text doesn't match the document id (sha256 of the text)")
        if len(text) > MAX_TEXT_LENGTH:
            raise JobError(f"text is longer than {MAX_TEXT_LENGTH} characters")
        self._status(doc, "analysing")
        analysis = pipeline.analyze(text)
        bundle = pipeline.bundle(analysis)
        a_key = analysis_key(doc, SCHEMA, analysis["analyzer"])
        b_key = bundle_key(doc, analysis["analyzer"], pipeline.lexicon_version)
        self._blobs.put(a_key, compressed_json(analysis), JSON, BROTLI)
        self._blobs.put(b_key, compressed_json(bundle), JSON, BROTLI)
        return self._status(
            doc,
            "ready",
            analyzer=analysis["analyzer"],
            lexicon=pipeline.lexicon_version,
            analysis=a_key,
            bundle=b_key,
        )

    def _status(
        self,
        doc: str,
        state: State,
        *,
        analyzer: str | None = None,
        lexicon: str | None = None,
        analysis: str | None = None,
        bundle: str | None = None,
        error: str | None = None,
    ) -> Status:
        status: Status = {"state": state, "updated": now()}
        if analyzer is not None:
            status["analyzer"] = analyzer
        if lexicon is not None:
            status["lexicon"] = lexicon
        if analysis is not None:
            status["analysis"] = analysis
        if bundle is not None:
            status["bundle"] = bundle
        if error is not None:
            status["error"] = error
        self._blobs.put(status_key(doc), json.dumps(status).encode(), JSON)
        return status

    def run(
        self,
        queue: JobQueue,
        stop: Callable[[], bool] = lambda: False,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        failures = 0
        while not stop():
            try:
                received: Received | None = queue.receive(POLL_SECONDS)
            except Exception:
                # Queue down or a malformed message: keep the worker alive, back off
                failures += 1
                delay = min(MAX_BACKOFF_SECONDS, 2.0**failures)
                log.exception("receiving a job failed; retrying in %.0f s", delay)
                sleep(delay)
                continue
            failures = 0
            if received is None:
                continue
            log.info("ingesting %s (%s)", received.job["doc"], received.job["lang"])
            status = self.process(received.job)
            queue.ack(received)
            log.info("%s: %s", received.job["doc"], status["state"])
