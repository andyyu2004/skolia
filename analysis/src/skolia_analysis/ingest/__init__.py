"""skolia-ingest: takes import jobs off a queue, analyses the text and builds its bundle.

The API stores the text at text/{doc}.txt, writes status/{doc}.json as queued, and
enqueues {"doc": ..., "lang": ...}. Ingest writes the analysis and bundle (gzipped
JSON) and updates the status, which the API reads to tell the reader when it's ready.

Locally the queue is Redis and the blobs are in MinIO; in production they are
Cloudflare Queues and R2 (both reached the same way: R2 speaks the S3 API).
"""
