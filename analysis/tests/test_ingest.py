import json
import re
from pathlib import Path

import brotli
import pytest

from skolia_analysis.ingest.blobs import DirBlobs
from skolia_analysis.ingest.jobs import InvalidJob, MemoryQueue, Received, parse_job
from skolia_analysis.ingest.schema import MAX_TEXT_LENGTH, doc_id, status_key, text_key
from skolia_analysis.ingest.worker import Ingester, Pipeline
from skolia_analysis.lexicon.schema import Bundle
from skolia_analysis.schema import Blob

TEXT = "Idę do psa."


def fake_analysis(text: str) -> Blob:
    return {"schema": 2, "analyzer": "test/1", "lang": "pl", "hash": "", "sentences": []}


def fake_bundle(blob: Blob) -> Bundle:
    return {
        "lang": "pl",
        "lexicon": "lex/1",
        "attribution": "",
        "entries": {},
        "lookup": {},
        "match": {},
        "feats": [],
    }


def pipelines() -> dict[str, Pipeline]:
    return {"pl": Pipeline("pl", fake_analysis, fake_bundle, "lex/1")}


def status(blobs: DirBlobs, doc: str) -> dict[str, str]:
    raw = blobs.get(status_key(doc))
    assert raw is not None
    return json.loads(raw)


def test_job_writes_analysis_bundle_and_ready_status(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id(TEXT)
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
    doc = doc_id(TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    ready = Ingester(blobs, pipelines()).process({"doc": doc, "lang": "pl"})
    keys = [text_key(doc), status_key(doc), ready.get("analysis", ""), ready.get("bundle", "")]
    assert all(key.startswith(f"doc/{doc}/") for key in keys), keys


def test_missing_text_and_unknown_language_fail_without_retry(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    ingester = Ingester(blobs, pipelines())
    assert ingester.process({"doc": "abc", "lang": "pl"})["state"] == "failed"
    doc = doc_id(TEXT)
    blobs.put(text_key(doc), TEXT.encode(), "text/plain")
    failed = ingester.process({"doc": doc, "lang": "xx"})
    assert failed["state"] == "failed"
    assert "xx" in failed.get("error", "")


def test_text_over_the_limit_fails_before_analysis(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    text = "a" * (MAX_TEXT_LENGTH + 1)
    doc = doc_id(text)
    blobs.put(text_key(doc), text.encode(), "text/plain")
    analysed: list[str] = []
    pipeline = Pipeline("pl", lambda t: analysed.append(t) or fake_analysis(t), fake_bundle, "")
    failed = Ingester(blobs, {"pl": pipeline}).process({"doc": doc, "lang": "pl"})
    assert failed["state"] == "failed"
    assert analysed == []


def test_limit_matches_the_api() -> None:
    shared = Path(__file__).resolve().parents[2] / "shared" / "api.ts"
    declared = re.search(r"MAX_TEXT_LENGTH = ([\d_]+);", shared.read_text(encoding="utf-8"))
    assert declared is not None
    assert int(declared.group(1).replace("_", "")) == MAX_TEXT_LENGTH


def test_text_must_match_its_id(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    blobs.put(text_key("abc"), TEXT.encode(), "text/plain")
    assert Ingester(blobs, pipelines()).process({"doc": "abc", "lang": "pl"})["state"] == "failed"


class FlakyQueue(MemoryQueue):
    """Fails the first receive, like Redis restarting."""

    def __init__(self) -> None:
        super().__init__()
        self.failed = False

    def receive(self, timeout: float) -> Received | None:
        if not self.failed:
            self.failed = True
            raise ConnectionError("redis went away")
        return super().receive(timeout)


def test_worker_survives_a_failing_queue(tmp_path: Path) -> None:
    blobs = DirBlobs(tmp_path)
    doc = doc_id(TEXT)
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
