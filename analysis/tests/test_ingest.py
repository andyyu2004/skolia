import json
from pathlib import Path

import brotli
import pytest

from skolia_analysis.blob import SCHEMA
from skolia_analysis.ingest.blobs import BlobError, DirBlobs
from skolia_analysis.ingest.jobs import InvalidJob, MemoryQueue, Received, parse_job
from skolia_analysis.ingest.schema import (
    MAX_TEXT_LENGTH,
    doc_id,
    status_key,
    text_key,
    versions_key,
)
from skolia_analysis.ingest.worker import Ingester, Pipeline
from skolia_analysis.lexicon.schema import BUNDLE_SCHEMA, BUNDLER_VERSION, Bundle
from skolia_analysis.schema import Blob

TEXT = "Idę do psa."


def fake_analysis(text: str) -> Blob:
    return {"schema": 2, "analyzer": "test/1", "lang": "pl", "hash": "", "sentences": []}


def fake_bundle(blob: Blob) -> Bundle:
    return {
        "schema": BUNDLE_SCHEMA,
        "lang": "pl",
        "lexicon": "lex/1",
        "attribution": "",
        "entries": {},
        "lookup": {},
        "match": {},
        "feats": [],
    }


def pipelines() -> dict[str, Pipeline]:
    return {"pl": Pipeline("pl", fake_analysis, fake_bundle, "test/1", "lex/1")}


def status(blobs: DirBlobs, doc: str) -> dict[str, str]:
    raw = blobs.get(status_key(doc))
    assert raw is not None
    return json.loads(raw)


def test_job_writes_analysis_bundle_and_ready_status(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    queue = MemoryQueue()
    queue.send({"doc": doc, "lang": "pl"})
    Ingester(blobs, pipelines()).run(queue, stop=lambda: not queue.pending)
    assert queue.acked == [{"doc": doc, "lang": "pl"}]
    ready = status(blobs, doc)
    assert ready["state"] == "ready"
    analysis = blobs.get(ready["analysis"])
    assert analysis is not None
    assert json.loads(brotli.decompress(analysis))["analyzer"] == "test/1"
    assert blobs.get(ready["bundle"]) is not None


def test_all_of_a_document_is_under_one_prefix(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    ready = Ingester(blobs, pipelines()).process({"doc": doc, "lang": "pl"})
    keys = [text_key(doc), status_key(doc), ready.get("analysis", ""), ready.get("bundle", "")]
    assert all(key.startswith(f"doc/{doc}/") for key in keys), keys


def test_missing_text_and_unknown_language_fail_without_retry(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    ingester = Ingester(blobs, pipelines())
    assert ingester.process({"doc": "abc", "lang": "pl"})["state"] == "failed"
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    failed = ingester.process({"doc": doc, "lang": "xx"})
    assert failed["state"] == "failed"
    assert "xx" in failed.get("error", "")


def test_text_over_the_limit_fails_before_analysis(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    text = "a" * (MAX_TEXT_LENGTH + 1)
    doc = doc_id("pl", text)
    blobs.put(text_key(doc), text.encode(), "text/plain")
    analysed: list[str] = []
    pipeline = Pipeline(
        "pl", lambda t: analysed.append(t) or fake_analysis(t), fake_bundle, "test/1", ""
    )
    failed = Ingester(blobs, {"pl": pipeline}).process({"doc": doc, "lang": "pl"})
    assert failed["state"] == "failed"
    assert analysed == []


def test_text_must_match_its_id(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    blobs.put(text_key("abc"), TEXT.encode(), "text/plain")
    assert Ingester(blobs, pipelines()).process({"doc": "abc", "lang": "pl"})["state"] == "failed"


def test_versions_are_published_for_the_api(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    Ingester(blobs, pipelines()).publish_versions()
    raw = blobs.get(versions_key("pl"))
    assert raw is not None
    versions = json.loads(raw)
    assert versions["analyzer"] == "test/1"
    assert versions["lexicon"] == "lex/1"
    # The names are what the API compares: the shapes and the bundler count as much as
    # the versions
    assert versions["analysis"].startswith(f"s{SCHEMA}-a")
    assert versions["bundle"].startswith(f"b{BUNDLE_SCHEMA}-v{BUNDLER_VERSION}-a")


def test_the_status_points_at_the_published_names(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    pipeline = pipelines()["pl"]
    ready = Ingester(blobs, {"pl": pipeline}).process({"doc": doc, "lang": "pl"})
    assert ready.get("analysis") == f"doc/{doc}/analysis/{pipeline.versions()['analysis']}.json.br"
    assert ready.get("bundle") == f"doc/{doc}/bundle/{pipeline.versions()['bundle']}.json.br"


class FailingBlobs(DirBlobs):
    """Storage that goes down after the text has been read, like an S3 outage."""

    def put(self, key: str, data: bytes, content_type: str, encoding: str | None = None) -> None:
        if not key.endswith("text.txt"):
            raise BlobError(f"put {key}: connection refused")
        super().put(key, data, content_type, encoding)


def test_a_storage_failure_puts_the_job_back_instead_of_failing_it(tmp_path: Path) -> None:
    blobs = FailingBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    queue = MemoryQueue()
    queue.send({"doc": doc, "lang": "pl"})
    slept: list[float] = []
    Ingester(blobs, pipelines()).run(queue, stop=lambda: bool(slept), sleep=slept.append)
    assert queue.released == [{"doc": doc, "lang": "pl"}]
    assert queue.acked == []
    assert len(queue.pending) == 1
    assert blobs.get(status_key(doc)) is None


def test_re_analysis_serves_the_old_analysis_until_the_new_one_is_ready(
    tmp_path: Path,
) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    old = Ingester(blobs, pipelines()).process({"doc": doc, "lang": "pl"})
    seen: list[dict[str, str]] = []

    def analyse_v2(text: str) -> Blob:
        seen.append(status(blobs, doc))
        return {**fake_analysis(text), "analyzer": "test/2"}

    upgraded = Pipeline("pl", analyse_v2, fake_bundle, "test/2", "lex/1")
    new = Ingester(blobs, {"pl": upgraded}).process({"doc": doc, "lang": "pl"})
    assert seen[0]["state"] == "analysing"
    assert seen[0]["analysis"] == old.get("analysis")
    assert seen[0]["analyzer"] == "test/1"
    assert new["state"] == "ready"
    assert new.get("analyzer") == "test/2"
    assert new.get("analysis") != old.get("analysis")


def test_a_job_already_done_is_not_analysed_again(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    analysed: list[str] = []
    pipeline = Pipeline(
        "pl", lambda t: analysed.append(t) or fake_analysis(t), fake_bundle, "test/1", "lex/1"
    )
    ingester = Ingester(blobs, {"pl": pipeline})
    ingester.process({"doc": doc, "lang": "pl"})
    assert ingester.process({"doc": doc, "lang": "pl"})["state"] == "ready"
    assert len(analysed) == 1


def test_a_new_lexicon_rebundles_without_analysing_again(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    analysed: list[str] = []
    bundled: list[Blob] = []

    def analyze(text: str) -> Blob:
        analysed.append(text)
        return fake_analysis(text)

    def bundle(blob: Blob) -> Bundle:
        bundled.append(blob)
        return fake_bundle(blob)

    Ingester(blobs, {"pl": Pipeline("pl", analyze, bundle, "test/1", "lex/1")}).process(
        {"doc": doc, "lang": "pl"}
    )
    newer = Ingester(blobs, {"pl": Pipeline("pl", analyze, bundle, "test/1", "lex/2")})
    ready = newer.process({"doc": doc, "lang": "pl"})
    assert ready["state"] == "ready" and ready.get("lexicon") == "lex/2"
    assert len(analysed) == 1
    assert len(bundled) == 2 and bundled[1] == fake_analysis(TEXT)


def test_an_analyser_unlike_the_published_one_fails(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    pipeline = Pipeline("pl", fake_analysis, fake_bundle, "test/2", "lex/1")
    failed = Ingester(blobs, {"pl": pipeline}).process({"doc": doc, "lang": "pl"})
    assert failed["state"] == "failed"
    assert "test/2" in failed.get("error", "")


class FlakyQueue(MemoryQueue):
    """Fails the first receive, like a queue that's briefly unreachable."""

    def __init__(self) -> None:
        super().__init__()
        self.failed = False

    def receive(self, timeout: float) -> Received | None:
        if not self.failed:
            self.failed = True
            raise ConnectionError("queue went away")
        return super().receive(timeout)


def test_worker_survives_a_failing_queue(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id("pl", TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    queue = FlakyQueue()
    queue.send({"doc": doc, "lang": "pl"})
    slept: list[float] = []
    Ingester(blobs, pipelines()).run(queue, stop=lambda: not queue.pending, sleep=slept.append)
    assert slept == [2.0]
    assert queue.acked == [{"doc": doc, "lang": "pl"}]


def test_parse_job_rejects_bad_messages() -> None:
    assert parse_job('{"doc": "a", "lang": "pl"}') == {"doc": "a", "lang": "pl"}
    with pytest.raises(InvalidJob):
        parse_job('{"doc": 1, "lang": "pl"}')
    with pytest.raises(InvalidJob):
        parse_job("[]")


def test_doc_id_matches_the_api() -> None:
    # The same value is asserted in api/src/app.test.ts against docId in shared/keys.ts
    expected = "d8fc9f68cd4e27140cbfe3d63851f0d2af4026ce726f9e9cdcb8682a537c71a7"
    assert doc_id("pl", "Idę do domu.") == expected
    assert doc_id("en", "Idę do domu.") != expected
