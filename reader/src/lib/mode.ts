// Reading or learning. reading: tapping a word only shows it, and the word sheet adds it to
// your cards on request. learning: tapping a word you haven't marked adds it to your cards.
// A text opens in the mode last chosen on this device, or reading.

export type ReaderMode = "reading" | "learning";

const KEY = "readerMode";

/** Storage can be unavailable (private windows, blocked site data): then it's reading. */
export function defaultMode(): ReaderMode {
  try {
    return localStorage.getItem(KEY) === "learning" ? "learning" : "reading";
  } catch {
    return "reading";
  }
}

export function rememberMode(mode: ReaderMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Not remembered; this text still switches
  }
}
