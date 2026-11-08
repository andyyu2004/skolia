"""Jobs over HTTP, for the Cloudflare container: a Worker takes each message off the
queue and POSTs it here, then acks it once it's accepted. Jobs live in memory, so a
container stopped mid-job loses them; the API queues a document again once it has
been queued or analysing for too long.

  POST /jobs   an IngestJob as JSON -> 202
  GET  /busy   {"busy": bool}: whether a job is waiting or running, so the container
               isn't put to sleep mid-analysis
  GET  /jobs   JobsState: whether the pipelines are still loading, and the documents
               running and waiting, in the order they'll run
"""

from __future__ import annotations

import json
import logging
import threading
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TypedDict, override

from .jobs import InvalidJob, Received, parse_job

log = logging.getLogger(__name__)

MAX_BODY_BYTES = 4096


class JobsState(TypedDict):
    loading: bool
    running: list[str]
    waiting: list[str]


class HttpJobs:
    """A JobQueue fed by POST /jobs."""

    def __init__(self) -> None:
        self._pending: deque[Received] = deque()
        self._running: list[Received] = []
        self._loading = True
        self._changed = threading.Condition()

    def add(self, raw: str) -> None:
        received = Received(parse_job(raw), raw)
        with self._changed:
            self._pending.append(received)
            self._changed.notify()

    def loaded(self) -> None:
        """The pipelines are ready: jobs run from now on."""
        with self._changed:
            self._loading = False

    def busy(self) -> bool:
        with self._changed:
            return bool(self._running or self._pending)

    def state(self) -> JobsState:
        with self._changed:
            return {
                "loading": self._loading,
                "running": [r.job["doc"] for r in self._running],
                "waiting": [r.job["doc"] for r in self._pending],
            }

    def receive(self, timeout: float) -> Received | None:
        with self._changed:
            if not self._changed.wait_for(lambda: bool(self._pending), timeout):
                return None
            received = self._pending.popleft()
            self._running.append(received)
            return received

    def ack(self, received: Received) -> None:
        with self._changed:
            self._running.remove(received)

    def release(self, received: Received) -> None:
        # Back in line before it stops counting as running, so busy() never dips
        with self._changed:
            self._pending.append(received)
            self._running.remove(received)
            self._changed.notify()


def serve(jobs: HttpJobs, host: str, port: int) -> ThreadingHTTPServer:
    """Listen in a background thread; returns the server (shutdown() stops it)."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            if self.path != "/jobs":
                return self._reply(HTTPStatus.NOT_FOUND, {"error": "not found"})
            length = int(self.headers.get("content-length") or 0)
            if length > MAX_BODY_BYTES:
                return self._reply(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "too large"})
            raw = self.rfile.read(length).decode("utf-8", errors="replace")
            try:
                jobs.add(raw)
            except (InvalidJob, ValueError) as error:
                return self._reply(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            self._reply(HTTPStatus.ACCEPTED, {"accepted": True})

        def do_GET(self) -> None:
            if self.path == "/busy":
                return self._reply(HTTPStatus.OK, {"busy": jobs.busy()})
            if self.path == "/jobs":
                return self._reply(HTTPStatus.OK, jobs.state())
            self._reply(HTTPStatus.NOT_FOUND, {"error": "not found"})

        def _reply(self, status: HTTPStatus, body: object) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        @override
        def log_message(self, format: str, *args: object) -> None:
            log.debug(format, *args)

    server = ThreadingHTTPServer((host, port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
