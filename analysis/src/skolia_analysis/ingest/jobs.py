"""The job queue: Redis locally. Cloudflare Queues (HTTP pull consumer) comes later."""

from __future__ import annotations

import json
from collections import deque
from typing import TYPE_CHECKING, Protocol, cast
from urllib.parse import urlsplit

from .schema import IngestJob

if TYPE_CHECKING:
    from redis import Redis

DEFAULT_PORT = 6379
SOCKET_TIMEOUT_SECONDS = 30.0
QUEUE = "skolia:ingest"
PROCESSING = "skolia:ingest:processing"
"""Jobs taken but not yet acknowledged. Redis moves a job here atomically as it's taken,
so a job survives ingest crashing mid-analysis: it's put back on the next start."""


class InvalidJob(ValueError):
    pass


class Received:
    def __init__(self, job: IngestJob, raw: str) -> None:
        self.job = job
        self.raw = raw


class JobQueue(Protocol):
    def receive(self, timeout: float) -> Received | None:
        """The next job, waiting up to timeout seconds. None if there's none."""
        ...

    def ack(self, received: Received) -> None:
        """Done with the job (whether it succeeded or failed): don't deliver it again."""
        ...

    def release(self, received: Received) -> None:
        """Not done: deliver the job again later."""
        ...


def parse_job(raw: str) -> IngestJob:
    value: object = json.loads(raw)
    if not isinstance(value, dict):
        raise InvalidJob(f"not an object: {raw!r}")
    fields = cast(dict[str, object], value)
    doc, lang = fields.get("doc"), fields.get("lang")
    if not isinstance(doc, str) or not isinstance(lang, str):
        raise InvalidJob(f"needs string doc and lang: {raw!r}")
    return {"doc": doc, "lang": lang}


class RedisQueue:
    def __init__(self, url: str) -> None:
        import redis

        # Redis.from_url takes untyped **kwargs, so the URL is split here instead
        parts = urlsplit(url)
        db = parts.path.lstrip("/")
        self._redis: Redis = redis.Redis(
            host=parts.hostname or "localhost",
            port=parts.port or DEFAULT_PORT,
            db=int(db) if db else 0,
            password=parts.password,
            decode_responses=True,
            # Must outlast the blocking wait in receive(), or an idle wait times out
            socket_timeout=SOCKET_TIMEOUT_SECONDS,
        )

    def recover(self) -> int:
        """Put jobs a crashed run had taken back on the queue. Only safe with one
        ingest worker; several would need per-worker processing lists."""
        moved = 0
        while self._redis.lmove(PROCESSING, QUEUE, "RIGHT", "LEFT") is not None:
            moved += 1
        return moved

    def receive(self, timeout: float) -> Received | None:
        if timeout >= SOCKET_TIMEOUT_SECONDS:
            raise ValueError(f"timeout must be under {SOCKET_TIMEOUT_SECONDS} s")
        raw = self._redis.blmove(QUEUE, PROCESSING, round(timeout), "RIGHT", "LEFT")
        if raw is None:
            return None
        text = str(raw)
        try:
            return Received(parse_job(text), text)
        except (InvalidJob, json.JSONDecodeError):
            self._redis.lrem(PROCESSING, 1, text)
            raise

    def ack(self, received: Received) -> None:
        self._redis.lrem(PROCESSING, 1, received.raw)

    def release(self, received: Received) -> None:
        # Back of the line (the end receive() doesn't take from), then out of processing
        self._redis.lpush(QUEUE, received.raw)
        self._redis.lrem(PROCESSING, 1, received.raw)

    def send(self, job: IngestJob) -> None:
        """For testing and scripts; the API is what normally enqueues."""
        self._redis.lpush(QUEUE, json.dumps(job))


class MemoryQueue:
    """For tests."""

    def __init__(self) -> None:
        self.pending: deque[str] = deque()
        self.acked: list[IngestJob] = []
        self.released: list[IngestJob] = []

    def send(self, job: IngestJob) -> None:
        self.pending.append(json.dumps(job))

    def receive(self, timeout: float) -> Received | None:
        if not self.pending:
            return None
        raw = self.pending.popleft()
        return Received(parse_job(raw), raw)

    def ack(self, received: Received) -> None:
        self.acked.append(received.job)

    def release(self, received: Received) -> None:
        self.released.append(received.job)
        self.pending.append(received.raw)
