import assert from "node:assert/strict";
import { test } from "node:test";
import type { Piece } from "@skolia/shared/doc";
import type { Token } from "@skolia/shared/schema";
import { audioAnnotations, inRange, placeAudio } from "./annotations.ts";

const fields = {
  licence: "public-domain",
  author: null,
  source: null,
  addedAt: "2026-11-09T10:00:00.000Z",
};

function annotation(start: number, end: number, n = 1) {
  return { ...fields, id: String(n).repeat(64), start, end, kind: "audio", data: { url: `https://audio.test/${n}.mp3` } };
}

test("only audio annotations that parse are kept", () => {
  const audio = annotation(0, 5);
  const kept = audioAnnotations([
    audio,
    { ...annotation(5, 9, 2), kind: "text", data: { text: "a note" } },
    { ...annotation(5, 9, 3), kind: "video", data: { url: "https://video.test/3.mp4" } },
    { ...annotation(5, 9, 4), data: { url: "http://audio.test/4.mp3" } },
    { ...annotation(5, 9, 5), id: "not a hash" },
    null,
  ]);
  assert.deepEqual(kept, [audio]);
});

/** The text's words and the gaps between them, as layout makes them, the tokens' offsets in
 * code points as the analysis counts. */
function pieces(text: string): Piece[] {
  const points = [...text];
  const words = [...text.matchAll(/\S+/gu)].map((match) => {
    const start = [...text.slice(0, match.index)].length;
    return { start, end: start + [...match[0]].length };
  });
  return words.flatMap(({ start, end }, i): Piece[] => {
    const before = words[i - 1]?.end ?? 0;
    const token = { start, end, upos: "NOUN" } as Token;
    const word: Piece = {
      kind: "word",
      id: i,
      text: points.slice(start, end).join(""),
      words: [{ sentence: 0, index: i, token }],
      punct: false,
    };
    return start > before ? [{ kind: "gap", text: points.slice(before, start).join("") }, word] : [word];
  });
}

test("a clip of whole paragraphs has its button before their first word; a shorter one has none", () => {
  const text = "Ala ma kota.\n\nKot ma Alę.\n\nAla ma psa.";
  const second = text.indexOf("Kot");
  const third = text.lastIndexOf("Ala");
  const laid = pieces(text);
  const places = placeAudio(
    text,
    laid,
    audioAnnotations([
      annotation(0, second - 2, 1),
      annotation(second, text.length, 2),
      annotation(4, 6, 3),
      annotation(second - 2, third - 2, 4),
      annotation(second, text.indexOf(".", second), 5),
    ]),
  );
  const at = (piece: number) => places.get(piece)?.map((p) => p.annotation.id[0]);
  // Ala: the first paragraph; Kot: the second and third; not ma, the gap before Kot, or Kot ma Alę without its stop
  assert.deepEqual([...places.keys()], [0, 6]);
  assert.deepEqual([at(0), at(6)], [["1"], ["2"]]);
  assert.deepEqual(
    laid.filter((piece) => inRange(places.get(6)?.[0] ?? assert.fail(), piece)).map((p) => p.kind === "word" && p.text),
    ["Kot", "ma", "Alę.", "Ala", "ma", "psa."],
  );
});

test("a clip with no word in its range has no button", () => {
  const text = "Ala  ma";
  assert.equal(placeAudio(text, pieces(text), audioAnnotations([annotation(3, 5)])).size, 0);
});

test("a range in UTF-16 units finds its word by code points", () => {
  const text = "😀 Ala.\n\nKot ma.";
  const kot = text.indexOf("Kot");
  const places = placeAudio(text, pieces(text), audioAnnotations([annotation(kot, text.length)]));
  // 😀, Ala., Kot, ma. with a gap before each but the first
  assert.deepEqual([...places.keys()], [4]);
  assert.deepEqual(
    places.get(4)?.map(({ start, end }) => [start, end]),
    [[kot - 1, text.length - 1]],
  );
});
