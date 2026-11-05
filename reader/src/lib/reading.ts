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

/** The line above the text (or instead of it, when there's nothing to show). */
export type Notice =
  | { kind: "none" }
  | { kind: "waiting"; text: "Loading…" | "Queued…" | "Analysing…" }
  | { kind: "updating" }
  | { kind: "failed"; error: string; previous: boolean }
  | { kind: "unreachable"; error: string };

/** showing: a reading is on screen. error: the last request failed with this message. */
export function notice(summary: DocumentSummary | null, showing: boolean, error: string | null): Notice {
  if (error !== null) return { kind: "unreachable", error };
  if (summary === null) return { kind: "waiting", text: "Loading…" };
  if (summary.state === "failed") {
    return { kind: "failed", error: summary.error ?? "unknown error", previous: showing };
  }
  if (!isBusy(summary)) return { kind: "none" };
  if (showing) return { kind: "updating" };
  return { kind: "waiting", text: summary.state === "analysing" ? "Analysing…" : "Queued…" };
}

/** The library's badge for a document, if it needs one. */
export function badge(summary: DocumentSummary): { text: string; failed: boolean } | null {
  if (summary.state === "failed") return { text: "failed", failed: true };
  if (!isBusy(summary)) return null;
  if (summary.reading) return { text: "updating…", failed: false };
  return { text: summary.state === "analysing" ? "analysing…" : "queued", failed: false };
}
