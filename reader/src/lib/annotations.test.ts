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

test("a clip's button goes before the word its range starts in", () => {
  const text = "Ala ma kota.\n\nKot ma Alę.";
  const second = text.indexOf("Kot");
  const laid = pieces(text);
  const places = placeAudio(
    text,
    laid,
    audioAnnotations([annotation(0, second - 2, 1), annotation(second - 2, text.length, 2), annotation(5, 9, 3)]),
  );
  const at = (piece: number) => places.get(piece)?.map((p) => p.annotation.id[0]);
  // Ala; from the gap before Kot, at Kot; from inside ma, at ma
  assert.deepEqual([...places.keys()], [0, 6, 2]);
  assert.deepEqual([at(0), at(6), at(2)], [["1"], ["2"], ["3"]]);
  assert.deepEqual(
    laid.filter((piece) => inRange(places.get(6)?.[0] ?? assert.fail(), piece)).map((p) => p.kind === "word" && p.text),
    ["Kot", "ma", "Alę."],
  );
});

test("a clip with no word in its range has no button", () => {
  const text = "Ala  ma";
  assert.equal(placeAudio(text, pieces(text), audioAnnotations([annotation(3, 5)])).size, 0);
});

test("a range in UTF-16 units finds its word by code points", () => {
  const text = "😀 Ala ma kota";
  const kota = text.indexOf("kota");
  const places = placeAudio(text, pieces(text), audioAnnotations([annotation(kota, text.length)]));
  // 😀, Ala, ma, kota with a gap before each but the first
  assert.deepEqual([...places.keys()], [6]);
  assert.deepEqual(
    places.get(6)?.map(({ start, end }) => [start, end]),
    [[kota - 1, text.length - 1]],
  );
});
