import assert from "node:assert/strict";
import { test } from "node:test";
import { fitted, labels, layout, stack, type Diagram, type LayoutOptions, type Point } from "./diagram.ts";
import { caseChain, parseSentence, type Sentence } from "./tree.ts";
import { SENTENCE, token } from "./tree.fixtures.ts";

// Every letter 7 wide, whatever it is
const measure = (text: string): number => text.length * 7;
const draw = (sentence: Sentence, options: Partial<LayoutOptions> = {}): Diagram =>
  layout(sentence, { shape: "arcs", direction: "across", measure, ...options });
const box = (d: Diagram, form: string) => d.boxes.find((b) => b.word.form === form);
const edge = (d: Diagram, from: string, to: string) =>
  d.edges.find((e) => e.link.from.form === from && e.link.to.form === to);

test("an arc is one level above the arcs it spans", () => {
  const sentence = parseSentence(SENTENCE);
  const levels = stack(sentence.dependencies);
  const level = (raw: string): number | undefined => levels.find((s) => s.link.raw === raw)?.level;
  assert.equal(level("nsubj"), 1);
  assert.equal(level("amod"), 1);
  assert.equal(level("obj"), 2);
});

test("crossing arcs go on different levels", () => {
  // 0 <- 2, 1 <- 3: the arcs 0–2 and 1–3 cross
  const sentence = parseSentence([
    token("a", "NOUN", 2, "obj"),
    token("b", "NOUN", 3, "obj"),
    token("c", "VERB", null, "root"),
    token("d", "VERB", 2, "conj"),
  ]);
  const levels = stack(sentence.dependencies)
    .filter((s) => s.link.raw === "obj")
    .map((s) => s.level);
  assert.equal(levels.length, 2);
  assert.notEqual(levels[0], levels[1]);
});

test("at a word, shorter arcs leave nearer their side so longer ones pass outside", () => {
  // Dziś piękność twą w całej ozdobie: ozdobie heads w and całej, and piękność heads it
  const sentence = parseSentence([
    token("piękność", "NOUN", null, "root"),
    token("w", "ADP", 3, "case"),
    token("całej", "ADJ", 3, "amod"),
    token("ozdobie", "NOUN", 0, "nmod"),
  ]);
  const placed = stack(sentence.dependencies);
  const rank = (raw: string): number | undefined => {
    const at = placed.find((s) => s.link.raw === raw);
    return at && (at.link.from.form === "ozdobie" ? at.from.rank : at.to.rank);
  };
  // Left to right at ozdobie: całej's arc, w's, then the one from piękność
  assert.deepEqual([rank("amod"), rank("case"), rank("nmod")], [0, 1, 2]);
});

test("across, the words read left to right with the arcs above them", () => {
  const d = draw(parseSentence(SENTENCE));
  const xs = d.boxes.map((b) => b.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  const obj = edge(d, "je", "rybę");
  const top = Math.min(...d.boxes.map((b) => b.y));
  assert.ok(obj && obj.points.every((p) => p.y <= top));
  assert.equal(obj?.label?.text, "object");
  assert.equal(d.anchor, "middle");
});

test("down, the words read top to bottom with the arcs to their left and no labels on them", () => {
  const d = draw(parseSentence(SENTENCE), { direction: "down" });
  const ys = d.boxes.map((b) => b.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  const left = Math.min(...d.boxes.map((b) => b.x));
  for (const e of d.edges) {
    assert.ok(e.points.every((p) => p.x <= left));
    assert.equal(e.label, null);
  }
  assert.equal(d.anchor, "start");
});

test("a tree's lines run from the head to the dependent's dot, without arrows", () => {
  for (const direction of ["across", "down"] as const) {
    const d = draw(parseSentence(SENTENCE), { shape: "tree", direction });
    const line = edge(d, "rybę", "małą");
    const dot = box(d, "małą")?.dot;
    assert.deepEqual(line?.points.at(-1), dot, direction);
    assert.equal(line?.arrow, false);
  }
});

test("down, a tree indents each word by its depth", () => {
  const d = draw(parseSentence(SENTENCE), { shape: "tree", direction: "down" });
  const x = (form: string): number => box(d, form)?.dot?.x ?? NaN;
  assert.ok(x("je") < x("Kot"));
  assert.equal(x("Kot"), x("rybę"));
  assert.ok(x("rybę") < x("małą"));
});

test("a case reason a dependency carries is drawn on it, not as a line of its own", () => {
  const sentence = parseSentence(SENTENCE);
  const d = draw(sentence, { cases: caseChain(sentence, new Set([3])) });
  assert.equal(edge(d, "je", "rybę")?.why, true);
  assert.equal(
    d.edges.filter((e) => e.kind === "case").length,
    0,
  );
});

test("a case reason no dependency carries is drawn past the words, into the word with it", () => {
  // The trigger is not the head: kot's case is said to come from małą
  const sentence = parseSentence([
    token("kot", "NOUN", 1, "nsubj", { Case: "Nom" }, { rule: "subject", trigger: 2 }),
    token("je", "VERB", null, "root"),
    token("rybę", "NOUN", 1, "obj"),
  ]);
  for (const direction of ["across", "down"] as const) {
    const d = draw(sentence, { direction, cases: caseChain(sentence, new Set([0])) });
    const reason = d.edges.find((e) => e.kind === "case");
    assert.ok(reason?.arrow, direction);
    assert.equal(reason?.label?.text, "subject");
    const kot = box(d, "kot");
    const end: Point | undefined = reason?.points.at(-1);
    // Across it comes up from below the box; down, in from the right of the form
    if (direction === "across") assert.ok(kot && end && end.y >= kot.y + kot.height);
    else assert.ok(kot && end && end.x > kot.x);
  }
});

test("the tree read across has the sentence along the bottom, fused words whole", () => {
  const sentence = parseSentence([
    token("Jak", "SCONJ", 1, "mark"),
    { ...token("powróciła", "VERB", null, "root"), start: 4, end: 14 },
    { ...token("ś", "AUX", 1, "aux"), start: 4, end: 14 },
    token("cudem", "NOUN", 1, "obl"),
  ]);
  const d = draw(sentence, { shape: "tree" });
  assert.deepEqual(
    d.reading.map((r) => r.text),
    ["Jak", "powróciłaś", "cudem"],
  );
  const bottom = Math.max(...d.boxes.map((b) => b.y + b.height));
  assert.ok(d.reading.every((r) => r.at.y > bottom));
  assert.equal(draw(sentence, { shape: "tree", direction: "down" }).reading.length, 0);
});

test("the size takes in everything drawn", () => {
  for (const shape of ["arcs", "tree"] as const) {
    for (const direction of ["across", "down"] as const) {
      const sentence = parseSentence(SENTENCE);
      const d = draw(sentence, { shape, direction, cases: caseChain(sentence, new Set([2])) });
      const points = [...d.edges.flatMap((e) => e.points), ...d.boxes.map((b) => ({ x: b.x + b.width, y: b.y + b.height }))];
      for (const p of [...points, ...d.boxes.map((b) => ({ x: b.x, y: b.y }))]) {
        assert.ok(p.x >= 0 && p.x <= d.width && p.y >= 0 && p.y <= d.height, `${shape} ${direction}`);
      }
    }
  }
});

test("a sentence reads across when it roughly fits its space, and down when it's far too wide", () => {
  const sentence = parseSentence(SENTENCE);
  const across = draw(sentence);
  const fit = (width: number): Diagram => fitted(sentence, { shape: "arcs", measure, width });
  assert.equal(fit(across.width).anchor, "middle");
  // A little sideways scrolling is fine
  assert.equal(fit(across.width / 1.4).anchor, "middle");
  assert.equal(fit(across.width / 2).anchor, "start");
});

test("the root has no relation, so it shows its part of speech where others show theirs", () => {
  const je = parseSentence(SENTENCE).words[1]!;
  const texts = (lines: ReturnType<typeof labels>) => lines.map((line) => line.map((run) => run.text).join(""));
  assert.deepEqual(texts(labels(je, "tree", "across")), ["je", "verb"]);
  assert.deepEqual(texts(labels(je, "arcs", "down")), ["je", "verb"]);
});
