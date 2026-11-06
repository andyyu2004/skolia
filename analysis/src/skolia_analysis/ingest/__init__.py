"""skolia-ingest: takes import jobs off a queue, analyses the text and builds its bundle.

The API stores the text at doc/{doc}/text.txt, writes doc/{doc}/status.json as queued, and
enqueues {"doc": ..., "lang": ...}. Ingest writes the analysis and bundle (Brotli-compressed
JSON) and updates the status, which the API reads to tell the reader when it's ready.

Jobs arrive over HTTP from the queue consumer Worker (api/src/worker/ingest.ts), and blobs
are read and written over R2's S3 API: on Cloudflare, and under wrangler dev through its
local R2's S3 endpoint.
"""
