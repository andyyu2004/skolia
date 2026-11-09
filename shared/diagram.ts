// Where to draw a sentence (tree.ts): a box with lines of text for each word, and each
// link as a line of points, for a renderer to turn into shapes. It reads left to right
// ("across"), or top to bottom ("down") on a narrow screen. Positions are worked out
// along the reading axis and across it, then turned into x and y.
import type { Link, Sentence, Word } from "./tree.ts";

export type Shape = "arcs" | "tree";
export type Direction = "across" | "down";
/** What a piece of text is, for its font and colour. */
export type Role = "form" | "detail" | "case";
/** The width of `text` as the renderer draws it. */
export type Measure = (text: string, role: Role) => number;

export interface Point {
  x: number;
  y: number;
}

export interface Run {
  text: string;
  role: Role;
}

export interface Box {
  word: Word;
  /** The rectangle behind the word's lines, for selecting and highlighting it. */
  x: number;
  y: number;
  width: number;
  height: number;
  lines: { runs: Run[]; at: Point }[];
  /** The tree's mark for the word, where its lines meet. */
  dot: Point | null;
  /** Under the form: marks the word causing the selected word's case. */
  underline: [Point, Point];
}

export interface Edge {
  link: Link;
  kind: "dependency" | "case";
  /** A dependency that also carries a case reason being shown. */
  why: boolean;
  points: Point[];
  /** An arrowhead at the last point: into the dependent, or the word with the case. */
  arrow: boolean;
  label: { text: string; at: Point } | null;
}

export interface Diagram {
  width: number;
  height: number;
  /** How text sits on its point: centred under its column across, from its left down. */
  anchor: "middle" | "start";
  /** Corner radius: arcs are rounded, tree lines square. */
  corner: number;
  boxes: Box[];
  edges: Edge[];
  /** The tree read across: the sentence as the text has it under the columns, fused words whole. */
  reading: { text: string; at: Point; words: Word[] }[];
  /** Dotted lines from each column down to the reading row. */
  guides: [Point, Point][];
}

export interface LayoutOptions {
  shape: Shape;
  direction: Direction;
  measure: Measure;
  /** Case reasons to draw (`caseChain`). One a dependency already joins is drawn on it. */
  cases?: Link[];
}

/** Where an arc's end sits among the arcs meeting the same word, in reading order. */
export interface Slot {
  rank: number;
  count: number;
}

export interface Stacked {
  /** 1 for an arc between neighbours; one more than the highest arc it spans or crosses. */
  level: number;
  from: Slot;
  to: Slot;
}

const PAD = 8;
const DOT = 4;
/** Room between nested arcs, most room between arc ends at a word, rounded corners */
const ACROSS = { level: 22, spread: 7, corner: 7, gap: 18 } as const;
const DOWN = { level: 12, spread: 5, corner: 5, row: 40, indent: 18 } as const;
/** Across, a box's lines sit this far below its top; down, this far below its row's top */
const ACROSS_LINES = [19, 35, 48];
const DOWN_LINES = [18, 32];
/** Down, where lines meet a word: the middle of its form, below the row's top */
const DOWN_MIDDLE = 13;

type Along = number;
type Across = number;
type At = [Along, Across];

export function layout(sentence: Sentence, options: LayoutOptions): Diagram {
  const { shape, direction, measure } = options;
  const down = direction === "down";
  const size = down ? DOWN : ACROSS;
  const words = sentence.words;
  const lineWidth = (runs: Run[]): number => runs.reduce((sum, run) => sum + measure(run.text, run.role), 0);

  const lines = words.map((w) => labels(w, shape, direction));
  const wide = lines.map((l) => Math.max(0, ...l.map(lineWidth)));
  const formWide = lines.map((l) => lineWidth(l[0] ?? []));
  // Across, every box is as tall as the most lines any has; down, as wide as its text
  const tall = words.some((w) => w.caseName !== null) ? 50 : 38;
  const thick = (w: Word): number => (down ? (wide[w.order] ?? 0) + 8 : tall);

  // A case reason between two words a dependency joins is drawn on that line
  const pair = (l: Link): string => [l.from.index, l.to.index].sort((a, b) => a - b).join(" ");
  const joined = new Set(sentence.dependencies.map(pair));
  const chain = options.cases ?? [];
  const whyPairs = new Set(chain.filter((l) => joined.has(pair(l))).map(pair));
  const caseLinks = chain.filter((l) => !whyPairs.has(pair(l)));
  const arcs = shape === "arcs" ? stack(sentence.dependencies) : new Map<Link, Stacked>();
  const cases = stack(caseLinks);

  // Along: rows down; across, columns wide enough for each word's lines and for the
  // labels of arcs between neighbours (any case reason's too, so selecting doesn't move them)
  const along: Along[] = [];
  if (down) words.forEach((_, i) => along.push(PAD + i * DOWN.row + DOWN_MIDDLE));
  else {
    const need = words.map(() => 0);
    if (shape === "arcs") {
      for (const link of [...sentence.dependencies, ...sentence.cases]) {
        const left = Math.min(link.from.order, link.to.order);
        if (Math.abs(link.from.order - link.to.order) !== 1) continue;
        need[left] = Math.max(need[left] ?? 0, measure(link.label, "detail") + 14);
      }
    }
    let a = PAD;
    wide.forEach((w, i) => {
      const before = wide[i - 1];
      a += before === undefined ? w / 2 : Math.max(before / 2 + ACROSS.gap + w / 2, need[i - 1] ?? 0);
      along.push(a);
    });
  }
  const alongOf = (w: Word): Along => along[w.order] ?? 0;

  // Across: arcs bend out before 0, on the words' far side from their labels; the tree
  // steps in by depth. Case reasons go out past every box.
  const step = down ? DOWN.indent : tall + 30;
  const dot = (w: Word): Across => (shape === "tree" ? w.depth * step : 0);
  const start = (w: Word): Across => (shape === "tree" ? dot(w) + DOT + 2 : 0);
  const end = (w: Word): Across => start(w) + 2 + thick(w);
  /** Where case reasons leave a word: under its box across, after its form down */
  const caseEnd = (w: Word): Across => (down ? start(w) + 6 + (formWide[w.order] ?? 0) + 4 : end(w) + 4);
  const lane = Math.max(0, ...words.map(end)) + 4;

  /** A line's end at a word, spread from the others meeting it */
  const room = (w: Word): number => (down ? DOWN.row - 18 : (wide[w.order] ?? 0) - 6);
  const endAt = (w: Word, slot: Slot): Along => {
    const gap = slot.count > 1 ? Math.min(size.spread, room(w) / (slot.count - 1)) : 0;
    return alongOf(w) + (slot.rank - (slot.count - 1) / 2) * gap;
  };

  type Draft = Omit<Edge, "points" | "label"> & { points: At[]; label: { text: string; at: At } | null };
  const drafts: Draft[] = [];
  for (const link of sentence.dependencies) {
    const why = whyPairs.has(pair(link));
    const placed = arcs.get(link);
    if (placed) {
      const a = endAt(link.from, placed.from);
      const b = endAt(link.to, placed.to);
      const c = -placed.level * size.level;
      const points: At[] = [
        [a, 0],
        [a, c],
        [b, c],
        [b, 0],
      ];
      // Down, the relation is written by the word, so the arc needs no label
      const label = down ? null : { text: link.label, at: [(a + b) / 2, c] as At };
      drafts.push({ link, kind: "dependency", why, points, arrow: true, label });
    } else if (shape === "tree") {
      drafts.push({ link, kind: "dependency", why, points: elbow(link.from, link.to), arrow: false, label: null });
    }
  }

  /** A tree line. Across, as in an org chart: down from under the head's labels to a bar
   * shared with its other dependents, along it, and down to the dependent. Down, as in a
   * file tree: along from the head's dot, then in to the dependent's. */
  function elbow(head: Word, dependent: Word): At[] {
    const a = alongOf(head);
    const b = alongOf(dependent);
    if (down) {
      return [
        [a, dot(head)],
        [b, dot(head)],
        [b, dot(dependent)],
      ];
    }
    const stem = end(head) + 4;
    const bar = (stem + dot(dependent)) / 2;
    return [
      [a, stem],
      [a, bar],
      [b, bar],
      [b, dot(dependent)],
    ];
  }

  let farthest = lane;
  for (const link of caseLinks) {
    const placed = cases.get(link);
    if (!placed) continue;
    const a = endAt(link.from, placed.from);
    const b = endAt(link.to, placed.to);
    const c = lane + placed.level * size.level;
    farthest = Math.max(farthest, c);
    const points: At[] = [
      [a, caseEnd(link.from)],
      [a, c],
      [b, c],
      [b, caseEnd(link.to)],
    ];
    // Across, the label sits on the line; down, the line runs along the reading axis, so beside it
    const label = { text: link.label, at: [(a + b) / 2, down ? c + 5 : c] as At };
    drafts.push({ link, kind: "case", why: false, points, arrow: true, label });
  }

  // The tree read across has the sentence along the bottom, so the columns read in order
  const reading: { text: string; at: At; words: Word[] }[] = [];
  const guides: [At, At][] = [];
  if (shape === "tree" && !down && words.length >= 3) {
    const bottom = farthest + 34;
    for (const w of words) {
      const a = alongOf(w);
      guides.push([
        [a, end(w) + 4],
        [a, bottom - 14],
      ]);
      const last = reading.at(-1);
      if (last && w.ending) {
        last.text += w.token.text;
        last.at = [(last.at[0] + a) / 2, bottom];
        last.words.push(w);
      } else reading.push({ text: w.token.text, at: [a, bottom], words: [w] });
    }
  }

  const boxDrafts = words.map((w, i) => {
    const a = alongOf(w);
    const s = start(w);
    const textWide = wide[i] ?? 0;
    const form = formWide[i] ?? 0;
    const own = lines[i] ?? [];
    const dotAt: At | null = shape === "tree" ? [a, dot(w)] : null;
    if (down) {
      const top = a - DOWN_MIDDLE;
      return {
        word: w,
        corners: [
          [top, s + 2],
          [top + DOWN.row - 3, s + 2 + textWide + 8],
        ] as [At, At],
        lines: own.map((runs, j) => ({ runs, at: [top + (DOWN_LINES[j] ?? 0), s + 6] as At })),
        dot: dotAt,
        underline: [
          [top + 22, s + 6],
          [top + 22, s + 6 + form],
        ] as [At, At],
      };
    }
    return {
      word: w,
      corners: [
        [a - textWide / 2 - 4, s + 2],
        [a + textWide / 2 + 4, s + 2 + tall],
      ] as [At, At],
      lines: own.map((runs, j) => ({ runs, at: [a, s + (ACROSS_LINES[j] ?? 0)] as At })),
      dot: dotAt,
      underline: [
        [a - form / 2, s + 23],
        [a + form / 2, s + 23],
      ] as [At, At],
    };
  });

  // Turn into x and y, with everything across moved clear of the edge
  const acrossValues = [
    ...drafts.flatMap((d) => d.points.map((p) => p[1])),
    ...boxDrafts.flatMap((b) => [b.corners[0][1], ...(b.dot ? [b.dot[1]] : [])]),
  ];
  const shift = PAD + (down ? DOT : 8) - Math.min(0, ...acrossValues);
  const xy = ([a, c]: At): Point => (down ? { x: c + shift, y: a } : { x: a, y: c + shift });

  const edges: Edge[] = drafts.map((d) => ({
    ...d,
    points: d.points.map(xy),
    label: d.label && { text: d.label.text, at: xy(d.label.at) },
  }));
  const boxes: Box[] = boxDrafts.map((b) => {
    const p = xy(b.corners[0]);
    const q = xy(b.corners[1]);
    return {
      word: b.word,
      x: Math.min(p.x, q.x),
      y: Math.min(p.y, q.y),
      width: Math.abs(q.x - p.x),
      height: Math.abs(q.y - p.y),
      lines: b.lines.map((l) => ({ runs: l.runs, at: xy(l.at) })),
      dot: b.dot && xy(b.dot),
      underline: [xy(b.underline[0]), xy(b.underline[1])],
    };
  });

  // The size: everything drawn, with text measured past its point
  const half = down ? 0 : 0.5;
  const right = (at: Point, text: string, role: Role): number => at.x + measure(text, role) * (1 - half);
  const extents: Point[] = [
    ...boxes.map((b) => ({ x: b.x + b.width, y: b.y + b.height })),
    ...boxes.flatMap((b) => (b.dot ? [{ x: b.dot.x + DOT, y: b.dot.y + DOT }] : [])),
    ...edges.flatMap((e) => e.points),
    ...edges.flatMap((e) => (e.label ? [{ x: right(e.label.at, e.label.text, "detail"), y: e.label.at.y + 7 }] : [])),
    ...reading.map((r) => ({ x: right(xy(r.at), r.text, "form"), y: xy(r.at).y + 6 })),
  ];
  return {
    width: Math.max(0, ...extents.map((p) => p.x)) + PAD,
    height: Math.max(0, ...extents.map((p) => p.y)) + PAD,
    anchor: down ? "start" : "middle",
    corner: shape === "tree" ? 0 : size.corner,
    boxes,
    edges,
    reading: reading.map((r) => ({ text: r.text, at: xy(r.at), words: r.words })),
    guides: guides.map(([a, b]) => [xy(a), xy(b)]),
  };
}

/** A word's lines of text. Across, its form with a line each for its part of speech (with
 * arcs, which carry the relation) or relation (in the tree), and case. Down, the relation
 * and case share a line beside the form. */
export function labels(word: Word, shape: Shape, direction: Direction): Run[][] {
  const form: Run[] = [{ text: word.form, role: "form" }];
  if (direction === "down") {
    const detail: Run[] = [{ text: word.relation, role: "detail" }];
    if (word.caseName) detail.push({ text: " · ", role: "detail" }, { text: word.caseName, role: "case" });
    return [form, detail];
  }
  const detail: Run[] = [{ text: shape === "arcs" ? word.pos : word.relation, role: "detail" }];
  return word.caseName ? [form, detail, [{ text: word.caseName, role: "case" }]] : [form, detail];
}

/** Levels and slots for arcs drawn on one side of the words. An arc goes above every
 * arc it spans or crosses. At each word, arcs to the left leave on its left and arcs to
 * the right on its right, and the shorter an arc the nearer its side it leaves, so the
 * longer, higher arcs pass outside it and no two cross at the word. */
export function stack(links: Link[]): Map<Link, Stacked> {
  const span = (l: Link): [number, number] => [Math.min(l.from.order, l.to.order), Math.max(l.from.order, l.to.order)];
  const length = (l: Link): number => span(l)[1] - span(l)[0];
  const sorted = [...links].sort((a, b) => length(a) - length(b) || span(a)[0] - span(b)[0]);
  const levels = new Map<Link, number>();
  for (const link of sorted) {
    const [left, right] = span(link);
    let below = 0;
    for (const [other, level] of levels) {
      const [l, r] = span(other);
      if (l < right && r > left) below = Math.max(below, level);
    }
    levels.set(link, below + 1);
  }

  const ends = new Map<Word, { link: Link; other: number; leftward: boolean }[]>();
  for (const link of links) {
    for (const [at, other] of [
      [link.from, link.to],
      [link.to, link.from],
    ] as const) {
      const list = ends.get(at) ?? [];
      list.push({ link, other: other.order, leftward: other.order < at.order });
      ends.set(at, list);
    }
  }
  const slot = (at: Word, link: Link): Slot => {
    const list = [...(ends.get(at) ?? [])].sort(
      (a, b) => Number(b.leftward) - Number(a.leftward) || b.other - a.other,
    );
    return { rank: list.findIndex((e) => e.link === link), count: list.length };
  };
  return new Map(links.map((l) => [l, { level: levels.get(l) ?? 1, from: slot(l.from, l), to: slot(l.to, l) }]));
}
