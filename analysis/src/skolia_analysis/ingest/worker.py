"""Process import jobs: text blob -> analysis + bundle blobs, with the status kept current."""

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import brotli

from ..blob import SCHEMA
from ..lexicon.schema import BUNDLE_SCHEMA, Bundle
from ..schema import Blob
from .blobs import BROTLI, BlobError, Blobs
from .jobs import JobQueue, Received
from .schema import (
    MAX_TEXT_LENGTH,
    IngestJob,
    State,
    Status,
    Versions,
    analysis_key,
    analysis_name,
    bundle_key,
    bundle_name,
    doc_id,
    status_key,
    text_key,
    versions_key,
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
    analyzer: str
    """The name analyze() puts in its blobs, known without analysing anything."""
    lexicon_version: str

    def versions(self) -> Versions:
        return {
            "analyzer": self.analyzer,
            "lexicon": self.lexicon_version,
            "analysis": analysis_name(SCHEMA, self.analyzer),
            "bundle": bundle_name(BUNDLE_SCHEMA, self.analyzer, self.lexicon_version),
        }


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def compressed_json(value: object) -> bytes:
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    return brotli.compress(data, quality=BROTLI_QUALITY)


class Ingester:
    def __init__(self, blobs: Blobs, pipelines: dict[str, Pipeline]) -> None:
        self._blobs = blobs
        self._pipelines = pipelines

    def publish_versions(self) -> None:
        """Tell the API what's current, so it can queue documents analysed before."""
        for lang, pipeline in self._pipelines.items():
            self._blobs.put(versions_key(lang), json.dumps(pipeline.versions()).encode(), JSON)

    def process(self, job: IngestJob) -> Status:
        """Raises BlobError when storage fails: that's worth retrying, unlike a failed
        analysis, which would fail the same way again."""
        doc = job["doc"]
        try:
            status = self._process(job)
        except BlobError:
            raise
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
        versions = pipeline.versions()
        a_key = analysis_key(doc, versions["analysis"])
        b_key = bundle_key(doc, versions["bundle"])
        # Already made (the job was queued twice, or the API wrote "queued" over a fresh
        # "ready"): the keys name the versions, so the blobs are current
        if not (self._blobs.exists(a_key) and self._blobs.exists(b_key)):
            self._status(doc, "analysing")
            analysis = pipeline.analyze(text)
            if analysis["analyzer"] != pipeline.analyzer:
                # Otherwise the API would keep finding it out of date and queueing it
                raise JobError(
                    f"analysed as {analysis['analyzer']!r}, but published {pipeline.analyzer!r}"
                )
            bundle = pipeline.bundle(analysis)
            self._blobs.put(a_key, compressed_json(analysis), JSON, BROTLI)
            self._blobs.put(b_key, compressed_json(bundle), JSON, BROTLI)
        return self._status(
            doc,
            "ready",
            analyzer=pipeline.analyzer,
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
        previous = self._read_status(doc) if state != "ready" else None
        if previous is not None:
            # Keep serving the last analysis until the new one is ready
            analyzer = analyzer or previous.get("analyzer")
            lexicon = lexicon or previous.get("lexicon")
            analysis = analysis or previous.get("analysis")
            bundle = bundle or previous.get("bundle")
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

    def _read_status(self, doc: str) -> Status | None:
        raw = self._blobs.get(status_key(doc))
        if raw is None:
            return None
        try:
            value: Status = json.loads(raw)
        except ValueError:
            return None
        return value

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
            try:
                status = self.process(received.job)
            except BlobError:
                # Storage is down: put the job back for later rather than fail the document
                failures += 1
                delay = min(MAX_BACKOFF_SECONDS, 2.0**failures)
                log.exception("storage failed; job back on the queue, waiting %.0f s", delay)
                queue.release(received)
                sleep(delay)
                continue
            failures = 0
            queue.ack(received)
            log.info("%s: %s", received.job["doc"], status["state"])
