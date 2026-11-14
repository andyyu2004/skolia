import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpans, trimSpans } from "./curated-spans.ts";

test("a span is the text between its brackets, without the markup", () => {
  assert.deepEqual(parseSpans("Ala ma [kota]{kot}."), { text: "Ala ma kota.", spans: [{ label: "kot", start: 7, end: 11 }] });
});

test("a text without markup is the same text", () => {
  const text = "Ala ma kota {i psa}.\nA \\ to ukośnik, \\n nie nowa linia.";
  assert.deepEqual(parseSpans(text), { text, spans: [] });
});

test("spans nest, and are in order of where they start", () => {
  assert.deepEqual(parseSpans("[a [b]{x} c]{y} [d]{z-1}"), {
    text: "a b c d",
    spans: [
      { label: "y", start: 0, end: 5 },
      { label: "x", start: 2, end: 3 },
      { label: "z-1", start: 6, end: 7 },
    ],
  });
});

test("\\[, \\] and \\\\ are a literal bracket and backslash, and { not right after a span is text", () => {
  assert.deepEqual(parseSpans("\\[1\\] [a\\\\b]{x} {y} [c]{z}{w}"), {
    text: "[1] a\\b {y} c{w}",
    spans: [
      { label: "x", start: 4, end: 7 },
      { label: "z", start: 12, end: 13 },
    ],
  });
});

test("offsets are UTF-16 code units", () => {
  const { text, spans } = parseSpans("😀 [kot]{k} 😀");
  assert.deepEqual(spans, [{ label: "k", start: 3, end: 6 }]);
  assert.equal(text.slice(3, 6), "kot");
});

test("bad markup is refused, naming the line", () => {
  const refused = (marked: string, message: RegExp) => assert.throws(() => parseSpans(marked), message);
  refused("a\n[b", /^Error: line 2: \[ is never closed$/u);
  refused("a]{x}", /line 1: \] without a \[ before it/u);
  refused("[a] b", /line 1: \] needs a \{label\} right after it/u);
  refused("[a] {x}", /\] needs a \{label\}/u);
  refused("[a]{x", /\] needs a \{label\}/u);
  refused("\n\n[a]{Kot}", /line 3: \{Kot\} isn't a label/u);
  refused("[a]{}", /\{\} isn't a label/u);
  refused("[a]{x y}", /\{x y\} isn't a label/u);
  refused("[]{x}", /the span \{x\} is empty/u);
  refused("[a]{x} [b]{x}", /\{x\} labels another span already/u);
});

test("trimming moves spans with the text, and cuts them to it", () => {
  const { text, spans } = parseSpans("\n  [ a]{x} [b]{y}  \n");
  assert.deepEqual(trimSpans(text, spans), {
    text: "a b",
    spans: [
      { label: "x", start: 0, end: 1 },
      { label: "y", start: 2, end: 3 },
    ],
  });
});
