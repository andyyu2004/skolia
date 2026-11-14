// Spans in an inline curated text, marked as Pandoc marks them: [some words]{label}. The
// label names the span's annotations in the file. \[ \] and \\ are a literal [, ] and \;
// spans may nest but not overlap.

/** A span of the text without its markup, in UTF-16 code units, [start, end). */
export type Span = {
  readonly label: string;
  readonly start: number;
  readonly end: number;
};

/** A text without its markup, and its spans in order of where they start. */
export type Marked = {
  readonly text: string;
  readonly spans: readonly Span[];
};

export const LABEL = /^[a-z0-9-]+$/u;

const ESCAPED = new Set(["[", "]", "\\"]);

type Open = { readonly start: number; readonly line: number };

/** The text without its markup, and the spans it marked. Throws, naming the line, at an
 * unclosed [, a ] without a {label} after it, a label that isn't one, an empty span or a
 * label given twice. */
export function parseSpans(marked: string): Marked {
  let text = "";
  let line = 1;
  const open: Open[] = [];
  const spans: Span[] = [];
  const fail = (message: string): never => {
    throw new Error(`line ${line}: ${message}`);
  };
  for (let i = 0; i < marked.length; i++) {
    const c = marked[i] ?? "";
    if (c === "\\" && ESCAPED.has(marked[i + 1] ?? "")) {
      text += marked[++i];
    } else if (c === "[") {
      open.push({ start: text.length, line });
    } else if (c === "]") {
      const span = open.pop() ?? fail("] without a [ before it");
      const braced = /^\{([^}\n]*)\}/u.exec(marked.slice(i + 1));
      if (!braced) return fail("] needs a {label} right after it");
      const label = braced[1] ?? "";
      if (!LABEL.test(label)) fail(`{${label}} isn't a label: lowercase letters, digits and hyphens`);
      if (span.start === text.length) fail(`the span {${label}} is empty`);
      if (spans.some((s) => s.label === label)) fail(`{${label}} labels another span already`);
      spans.push({ label, start: span.start, end: text.length });
      i += braced[0].length;
    } else {
      if (c === "\n") line++;
      text += c;
    }
  }
  const unclosed = open.pop();
  if (unclosed) throw new Error(`line ${unclosed.line}: [ is never closed`);
  return { text, spans: spans.toSorted((a, b) => a.start - b.start || b.end - a.end) };
}

/** The text trimmed, its spans moved with it, and cut to it where they were partly in
 * what was trimmed. */
export function trimSpans<S extends { readonly start: number; readonly end: number }>(
  text: string,
  spans: readonly S[],
): { readonly text: string; readonly spans: readonly S[] } {
  const trimmed = text.trim();
  const lead = text.length - text.trimStart().length;
  const moved = (offset: number) => Math.min(Math.max(offset - lead, 0), trimmed.length);
  return { text: trimmed, spans: spans.map((s) => ({ ...s, start: moved(s.start), end: moved(s.end) })) };
}
