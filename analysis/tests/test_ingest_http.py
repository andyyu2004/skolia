import json
import urllib.error
import urllib.request
from collections.abc import Iterator

import pytest

from skolia_analysis.ingest.http import HttpJobs, serve

JOB = {"doc": "a" * 64, "lang": "pl"}


def test_busy_while_a_job_waits_or_runs() -> None:
    jobs = HttpJobs()
    assert not jobs.busy()
    jobs.add(json.dumps(JOB))
    assert jobs.busy()
    received = jobs.receive(0.1)
    assert received is not None and received.job == JOB
    assert jobs.busy()
    jobs.ack(received)
    assert not jobs.busy()
    assert jobs.receive(0.01) is None


def test_a_released_job_comes_back() -> None:
    jobs = HttpJobs()
    jobs.add(json.dumps(JOB))
    received = jobs.receive(0.1)
    assert received is not None
    jobs.release(received)
    assert jobs.busy()
    again = jobs.receive(0.1)
    assert again is not None and again.job == JOB


def request(port: int, method: str, path: str, body: bytes | None = None) -> tuple[int, object]:
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


@pytest.fixture
def server() -> Iterator[tuple[HttpJobs, int]]:
    jobs = HttpJobs()
    httpd = serve(jobs, "127.0.0.1", 0)
    yield jobs, httpd.server_address[1]
    httpd.shutdown()


def test_jobs_are_posted_and_busy_reported(server: tuple[HttpJobs, int]) -> None:
    jobs, port = server
    assert request(port, "GET", "/busy") == (200, {"busy": False})
    assert request(port, "POST", "/jobs", json.dumps(JOB).encode()) == (202, {"accepted": True})
    assert request(port, "GET", "/busy") == (200, {"busy": True})
    received = jobs.receive(0.1)
    assert received is not None and received.job == JOB


def test_a_malformed_job_is_refused(server: tuple[HttpJobs, int]) -> None:
    jobs, port = server
    status, _ = request(port, "POST", "/jobs", b'{"doc": 1}')
    assert status == 400
    status, _ = request(port, "POST", "/jobs", b"not json")
    assert status == 400
    assert not jobs.busy()
