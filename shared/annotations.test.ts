import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationId, canonicalJson, cutsWord, insideWord, type IdentifiedBy } from "./annotations.ts";
import { NewAnnotation } from "./schemas.ts";

test("an offset is inside a word only strictly within a word-like segment", () => {
  const text = "Idę do starego psa.";
  const inside = Array.from({ length: text.length + 1 }, (_, i) => i).filter((i) => insideWord(text, i, "pl"));
  assert.deepEqual(inside, [1, 2, 5, 8, 9, 10, 11, 12, 13, 16, 17]);
});

test("a range cuts a word when it starts or ends inside one; whitespace and punctuation at its ends are fine", () => {
  const text = "Zażółć gęślą jaźń, proszę… 🐕🐕 Pies.";
  const range = (s: string) => [text.indexOf(s), text.indexOf(s) + s.length] as const;
  const ok = ["Zażółć", "gęślą jaźń", "jaźń,", ", proszę…", " gęślą ", text, "🐕", "🐕 Pies", " 🐕🐕 "];
  for (const s of ok) assert.equal(cutsWord(text, ...range(s), "pl"), null, s);
  assert.equal(cutsWord(text, 2, 6, "pl"), "the annotation starts inside a word, at 2");
  assert.equal(cutsWord(text, 0, 9, "pl"), "the annotation ends inside a word, at 9");
  assert.equal(cutsWord(text, 4, 9, "pl"), "the annotation starts inside a word, at 4");
});

test("a word longer than the window around an offset is still one word", () => {
  const long = "a".repeat(300);
  const text = `x ${long} y`;
  for (const offset of [3, 65, 66, 67, 130, 200, 300]) assert.equal(insideWord(text, offset, "en"), true, String(offset));
  for (const offset of [0, 1, 2, 302, 303, text.length]) assert.equal(insideWord(text, offset, "en"), false, String(offset));
  const words = Array.from({ length: 50 }, (_, i) => `słowo${i}`).join(" ");
  const boundaries = [...new Intl.Segmenter("pl", { granularity: "word" }).segment(words)].map((s) => s.index);
  for (let i = 0; i <= words.length; i++) assert.equal(insideWord(words, i, "pl"), !boundaries.includes(i) && i < words.length, String(i));
});

test("canonical JSON sorts every object's keys and has no whitespace", () => {
  assert.equal(
    canonicalJson({ url: "https://example.org/a.mp3", b: { d: 1, c: [2, null] }, x: undefined }),
    '{"b":{"c":[2,null],"d":1},"url":"https://example.org/a.mp3"}',
  );
});

test("an annotation's id is a hash of what it says, whatever order its fields are in", async () => {
  const audio: IdentifiedBy = {
    start: 0,
    end: 4,
    kind: "audio",
    data: { url: "https://example.org/a.mp3" },
    licence: "cc-by",
    author: null,
    source: null,
  };
  const reordered: IdentifiedBy = {
    source: null,
    author: null,
    licence: "cc-by",
    data: { url: "https://example.org/a.mp3" },
    kind: "audio",
    end: 4,
    start: 0,
  };
  assert.match(await annotationId(audio), /^[0-9a-f]{64}$/u);
  assert.equal(await annotationId(reordered), await annotationId(audio));
  assert.notEqual(await annotationId({ ...audio, end: 5 }), await annotationId(audio));
  assert.notEqual(await annotationId({ ...audio, author: "Helena" }), await annotationId(audio));
  assert.notEqual(await annotationId({ ...audio, kind: "text", data: { text: "Pies" } }), await annotationId(audio));
});

test("a new annotation's data is its kind's, and only that", () => {
  const base = { start: 0, end: 4, licence: "cc0" } as const;
  assert.deepEqual(NewAnnotation.parse({ ...base, kind: "text", data: { text: " Pies. " } }), {
    ...base,
    kind: "text",
    data: { text: "Pies." },
    author: null,
    source: null,
  });
  const refused = [
    { kind: "video", data: { url: "https://example.org/a.mp4" } },
    { kind: "audio", data: { text: "Pies" } },
    { kind: "audio", data: { url: "http://example.org/a.mp3" } },
    { kind: "audio", data: { url: "https://example.org/a.mp3", speed: 2 } },
    { kind: "text", data: { text: " " } },
    { kind: "text", data: { text: "x".repeat(2001) } },
    { kind: "text", data: { url: "https://example.org/a.mp3" } },
  ];
  for (const content of refused) assert.equal(NewAnnotation.safeParse({ ...base, ...content }).success, false, JSON.stringify(content));
});
