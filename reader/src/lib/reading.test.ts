import assert from "node:assert/strict";
import { test } from "node:test";
import { timestamp, type DocumentSummary } from "@skolia/shared/api";
import { DocumentId } from "@skolia/shared/schemas";
import { MAX_RETRY_MS, POLL_MS, afterPoll, badge, notice, retryAfter } from "./reading.ts";

const OLD = { analysis: "s2-a1", bundle: "b1-a1-l1" };
const NEW = { analysis: "s2-a2", bundle: "b1-a2-l1" };

function summary(state: DocumentSummary["state"], reading?: typeof OLD, error?: string): DocumentSummary {
  const base: DocumentSummary = { id: DocumentId.parse("d".repeat(64)), title: "t", lang: "pl", imported: timestamp(new Date(0)), words: 1, visibility: "public", licence: "cc-by", author: null, source: null, importerName: "Ivy", mine: false, state };
  if (reading) base.reading = reading;
  if (error) base.error = error;
  return base;
}

test("a new import waits, then loads once ready", () => {
  assert.deepEqual(afterPoll(summary("queued"), null), { load: null, pollAfter: POLL_MS });
  assert.deepEqual(afterPoll(summary("ready", OLD), null), { load: OLD, pollAfter: null });
  assert.deepEqual(afterPoll(summary("ready", OLD), OLD), { load: null, pollAfter: null });
});

test("an outdated document opens on the old reading and switches when the new one is ready", () => {
  // Re-analysis queued: show the old one now, keep polling
  assert.deepEqual(afterPoll(summary("queued", OLD), null), { load: OLD, pollAfter: POLL_MS });
  assert.deepEqual(afterPoll(summary("analysing", OLD), OLD), { load: null, pollAfter: POLL_MS });
  // Done: the names changed, so load them; nothing to wait for any more
  assert.deepEqual(afterPoll(summary("ready", NEW), OLD), { load: NEW, pollAfter: null });
});

test("a failed re-analysis keeps the old reading and stops polling", () => {
  assert.deepEqual(afterPoll(summary("failed", OLD, "boom"), OLD), { load: null, pollAfter: null });
  assert.deepEqual(notice(summary("failed", OLD, "boom"), true, null), {
    kind: "failed",
    error: "boom",
    previous: true,
  });
});

test("the notice says what's going on", () => {
  assert.deepEqual(notice(null, false, null), { kind: "none" });
  assert.deepEqual(notice(summary("queued"), false, null), { kind: "processing" });
  assert.deepEqual(notice(summary("analysing"), false, null), { kind: "processing" });
  assert.deepEqual(notice(summary("queued", OLD), true, null), { kind: "updating" });
  assert.deepEqual(notice(summary("ready", OLD), true, null), { kind: "none" });
  assert.deepEqual(notice(summary("failed"), false, null), { kind: "failed", error: "unknown error", previous: false });
  assert.deepEqual(notice(summary("ready", OLD), true, "offline"), { kind: "unreachable", error: "offline" });
});

test("failed requests are retried, backing off", () => {
  assert.equal(retryAfter(1), POLL_MS);
  assert.equal(retryAfter(2), POLL_MS * 2);
  assert.equal(retryAfter(20), MAX_RETRY_MS);
});

test("library badges", () => {
  assert.equal(badge(summary("ready", OLD)), null);
  assert.deepEqual(badge(summary("queued")), { text: "processing…", failed: false });
  assert.deepEqual(badge(summary("analysing")), { text: "processing…", failed: false });
  assert.deepEqual(badge(summary("analysing", OLD)), { text: "updating…", failed: false });
  assert.deepEqual(badge(summary("failed", OLD)), { text: "failed", failed: true });
});
