// What the reader page does while a document is analysed, re-analysed or out of reach,
// decided from each poll so it can be tested without a browser.
import type { DocumentSummary, ReadingNames } from "@skolia/shared/api";

export const POLL_MS = 1500;
export const MAX_RETRY_MS = 30_000;

/** What to do after a poll. */
export interface Step {
  /** The reading to load: the summary's, when it isn't the one last tried. */
  load: ReadingNames | null;
  /** Poll again after this many milliseconds, or null to stop. */
  pollAfter: number | null;
}

/** tried: the names last loaded (or found unreadable), so each reading loads once. */
export function afterPoll(summary: DocumentSummary, tried: ReadingNames | null): Step {
  const names = summary.reading ?? null;
  return {
    load: names !== null && !sameNames(names, tried) ? names : null,
    pollAfter: isBusy(summary) ? POLL_MS : null,
  };
}

/** After failures requests in a row: try again, backing off. */
export function retryAfter(failures: number): number {
  return Math.min(MAX_RETRY_MS, POLL_MS * 2 ** Math.max(0, failures - 1));
}

export function sameNames(a: ReadingNames | null, b: ReadingNames | null): boolean {
  return a?.analysis === b?.analysis && a?.bundle === b?.bundle;
}

export function isBusy(summary: DocumentSummary): boolean {
  return summary.state === "queued" || summary.state === "analysing";
}

/** What the page says beside the text. queued and analysing: the plain text is shown
 * until the first reading is ready. updating: a newer reading is on its way. */
export type Notice =
  | { kind: "none" }
  | { kind: "queued" }
  | { kind: "analysing" }
  | { kind: "updating" }
  | { kind: "failed"; error: string; previous: boolean }
  | { kind: "unreachable"; error: string };

/** showing: a reading is on screen. error: the last request failed with this message. */
export function notice(summary: DocumentSummary | null, showing: boolean, error: string | null): Notice {
  if (error !== null) return { kind: "unreachable", error };
  if (summary === null) return { kind: "none" };
  if (summary.state === "failed") {
    return { kind: "failed", error: summary.error ?? "unknown error", previous: showing };
  }
  if (!isBusy(summary)) return { kind: "none" };
  if (showing) return { kind: "updating" };
  return { kind: summary.state === "analysing" ? "analysing" : "queued" };
}

/** Where the viewer's own document is while it waits, beside Queued or Updating; null when the
 * API didn't say (not theirs, or not waiting). */
export function queueText(summary: DocumentSummary): string | null {
  const place = summary.queue;
  if (place === undefined || !isBusy(summary)) return null;
  if (summary.state === "analysing") return "analysing now";
  if (place.starting) return "the analyser is starting, which can take a couple of minutes";
  if (place.ahead === null) return "waiting for the analyser to pick it up";
  if (place.ahead === 0) return "next";
  return `${place.ahead} ${place.ahead === 1 ? "text" : "texts"} ahead of yours`;
}

/** The library's badge for a document, if it needs one. */
export function badge(summary: DocumentSummary): { text: string; failed: boolean } | null {
  if (summary.state === "failed") return { text: "failed", failed: true };
  if (!isBusy(summary)) return null;
  if (summary.reading) return { text: "updating", failed: false };
  return { text: summary.state === "analysing" ? "analysing" : "queued", failed: false };
}
