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
  readonly x: number;
  readonly y: number;
}

export interface Run {
  readonly text: string;
  readonly role: Role;
}

/** A word's lines of text: its form, then its details. */
export type Lines = readonly [readonly Run[], ...(readonly Run[])[]];

export interface Box {
  readonly word: Word;
  /** The rectangle behind the word's lines, for selecting and highlighting it. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly { readonly runs: readonly Run[]; readonly at: Point }[];
  /** The tree's mark for the word, where its lines meet. */
  readonly dot: Point | null;
  /** Under the form: marks the word causing the selected word's case. */
  readonly underline: readonly [Point, Point];
}

export interface Label {
  readonly text: string;
  readonly at: Point;
}

export interface Edge {
  readonly link: Link;
  readonly kind: "dependency" | "case";
  /** A dependency that also carries a case reason being shown. */
  readonly why: boolean;
  readonly points: readonly Point[];
  /** An arrowhead at the last point: into the dependent, or the word with the case. */
  readonly arrow: boolean;
  readonly label: Label | null;
}

export interface Reading {
  readonly text: string;
  readonly at: Point;
  readonly words: readonly Word[];
}

export interface Diagram {
  readonly width: number;
  readonly height: number;
  /** How text sits on its point: centred under its column across, from its left down. */
  readonly anchor: "middle" | "start";
  /** Corner radius: arcs are rounded, tree lines square. */
  readonly corner: number;
  readonly boxes: readonly Box[];
  readonly edges: readonly Edge[];
  /** The tree read across: the sentence as the text has it under the columns, fused words whole. */
  readonly reading: readonly Reading[];
  /** Dotted lines from each column down to the reading row. */
  readonly guides: readonly (readonly [Point, Point])[];
}

export interface LayoutOptions {
  readonly shape: Shape;
  readonly direction: Direction;
  readonly measure: Measure;
  /** Case reasons to draw (`caseChain`). One a dependency already joins is drawn on it. */
  readonly cases?: readonly Link[];
}

/** Where an arc's end sits among the arcs meeting the same word, in reading order. */
export interface Slot {
  readonly rank: number;
  readonly count: number;
}

export interface Stacked {
  readonly link: Link;
  /** 1 for an arc between neighbours; one more than the highest arc it spans or crosses. */
  readonly level: number;
  readonly from: Slot;
  readonly to: Slot;
}

const PAD = 8;
const DOT = 4;
/** Room between nested arcs, most room between arc ends at a word, rounded corners */
const ACROSS = { level: 22, spread: 7, corner: 7, gap: 18 } as const;
const DOWN = { level: 12, spread: 5, corner: 5, row: 40, indent: 18 } as const;
/** Baselines of a box's lines below its top (across) or its row's top (down): the form's, then each after */
const ACROSS_LINES = { first: 19, step: 14.5 } as const;
const DOWN_LINES = { first: 18, step: 14 } as const;
/** Down, where lines meet a word: the middle of its form, below the row's top */
const DOWN_MIDDLE = 13;

type Along = number;
type Across = number;
/** A position along the reading axis and across it. */
type At = readonly [Along, Across];

interface Draft {
  readonly link: Link;
  readonly kind: Edge["kind"];
  readonly why: boolean;
  readonly points: readonly At[];
  readonly arrow: boolean;
  readonly label: { readonly text: string; readonly at: At } | null;
}

export function layout(sentence: Sentence, options: LayoutOptions): Diagram {
  const { shape, direction, measure } = options;
  const down = direction === "down";
  const size = down ? DOWN : ACROSS;
  const { words } = sentence;
  const lineWidth = (runs: readonly Run[]): number => sum(runs.map((run) => measure(run.text, run.role)));
  // Across, every box is as tall as the most lines any has; down, as wide as its text
  const tall = words.some((w) => w.caseName !== null) ? 50 : 38;

  // A case reason between two words a dependency joins is drawn on that line
  const pair = (l: Link): string => [l.from.index, l.to.index].sort((a, b) => a - b).join(" ");
  const joined = new Set(sentence.dependencies.map(pair));
  const chain = options.cases ?? [];
  const whyPairs = new Set(chain.filter((l) => joined.has(pair(l))).map(pair));
  const caseLinks = chain.filter((l) => !whyPairs.has(pair(l)));

  // Each word's lines and their widths
  const sizeOf = remember((word: Word) => {
    const lines = labels(word, shape, direction);
    return { lines, wide: Math.max(...lines.map(lineWidth)), formWide: lineWidth(lines[0]) };
  });

  /** Across, how far a word's column is from the one before: room for both words' lines,
   * and for the labels of arcs between them (any case reason's too, so selecting a word
   * doesn't move the columns). */
  const gaps = neighbours(words).map(([before, after]) => {
    const labelled = [...sentence.dependencies, ...sentence.cases].filter(
      (l) => (l.from === before && l.to === after) || (l.from === after && l.to === before),
    );
    const room = shape === "arcs" ? labelled.map((l) => measure(l.label, "detail") + 14) : [];
    return { before, after, gap: Math.max(sizeOf(before).wide / 2 + ACROSS.gap + sizeOf(after).wide / 2, ...room) };
  });
  /** Where a word sits along the reading axis: rows down, columns across. */
  const alongOf = remember((word: Word): Along => {
    if (down) return PAD + word.order * DOWN.row + DOWN_MIDDLE;
    const left = gaps.find((g) => g.after === word);
    return left ? alongOf(left.before) + left.gap : PAD + sizeOf(word).wide / 2;
  });

  // Across: arcs bend out before 0, on the words' far side from their labels; the tree
  // steps in by depth. Case reasons go out past every box.
  const step = down ? DOWN.indent : tall + 30;
  const dot = (w: Word): Across => (shape === "tree" ? w.depth * step : 0);
  const start = (w: Word): Across => (shape === "tree" ? dot(w) + DOT + 2 : 0);
  const end = (w: Word): Across => start(w) + 2 + (down ? sizeOf(w).wide + 8 : tall);
  /** Where case reasons leave a word: under its box across, after its form down */
  const caseEnd = (w: Word): Across => (down ? start(w) + 6 + sizeOf(w).formWide + 4 : end(w) + 4);
  const lane = Math.max(0, ...words.map(end)) + 4;

  /** A line's end at a word, spread from the others meeting it */
  const endAt = (w: Word, slot: Slot): Along => {
    const room = down ? DOWN.row - 18 : sizeOf(w).wide - 6;
    const gap = slot.count > 1 ? Math.min(size.spread, room / (slot.count - 1)) : 0;
    return alongOf(w) + (slot.rank - (slot.count - 1) / 2) * gap;
  };

  /** A tree line. Across, as in an org chart: down from under the head's labels to a bar
   * shared with its other dependents, along it, and down to the dependent. Down, as in a
   * file tree: along from the head's dot, then in to the dependent's. */
  const elbow = (head: Word, dependent: Word): readonly At[] => {
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
  };

  const dependencies: readonly Draft[] =
    shape === "arcs"
      ? stack(sentence.dependencies).map(({ link, level, from, to }) => {
          const a = endAt(link.from, from);
          const b = endAt(link.to, to);
          const c = -level * size.level;
          return {
            link,
            kind: "dependency",
            why: whyPairs.has(pair(link)),
            points: [
              [a, 0],
              [a, c],
              [b, c],
              [b, 0],
            ],
            arrow: true,
            // Down, the relation is written by the word, so the arc needs no label
            label: down ? null : { text: link.label, at: [(a + b) / 2, c] },
          };
        })
      : sentence.dependencies.map((link) => ({
          link,
          kind: "dependency",
          why: whyPairs.has(pair(link)),
          points: elbow(link.from, link.to),
          arrow: false,
          label: null,
        }));

  const stackedCases = stack(caseLinks);
  const farthest = Math.max(lane, ...stackedCases.map((s) => lane + s.level * size.level));
  const cases: readonly Draft[] = stackedCases.map(({ link, level, from, to }) => {
    const a = endAt(link.from, from);
    const b = endAt(link.to, to);
    const c = lane + level * size.level;
    return {
      link,
      kind: "case",
      why: false,
      points: [
        [a, caseEnd(link.from)],
        [a, c],
        [b, c],
        [b, caseEnd(link.to)],
      ],
      arrow: true,
      // Across, the label sits on the line; down, the line runs along the reading axis, so beside it
      label: { text: link.label, at: [(a + b) / 2, down ? c + 5 : c] },
    };
  });
  const drafts = [...dependencies, ...cases];

  // The tree read across has the sentence along the bottom, so the columns read in order
  const withReading = shape === "tree" && !down && words.length >= 3;
  const bottom = farthest + 34;
  const reading = withReading
    ? fused(words).map((group) => ({
        text: group.map((w) => w.token.text).join(""),
        at: [mean(group.map(alongOf)), bottom] as At,
        words: group,
      }))
    : [];
  const guides: readonly (readonly [At, At])[] = withReading
    ? words.map((w) => [
        [alongOf(w), end(w) + 4],
        [alongOf(w), bottom - 14],
      ])
    : [];

  const boxDrafts = words.map((word) => {
    const a = alongOf(word);
    const s = start(word);
    const { wide, formWide, lines } = sizeOf(word);
    const dotAt: At | null = shape === "tree" ? [a, dot(word)] : null;
    if (down) {
      const top = a - DOWN_MIDDLE;
      return {
        word,
        corners: [
          [top, s + 2],
          [top + DOWN.row - 3, s + 2 + wide + 8],
        ] as const,
        lines: lines.map((runs, j) => ({ runs, at: [top + DOWN_LINES.first + j * DOWN_LINES.step, s + 6] as At })),
        dot: dotAt,
        underline: [
          [top + 22, s + 6],
          [top + 22, s + 6 + formWide],
        ] as const,
      };
    }
    return {
      word,
      corners: [
        [a - wide / 2 - 4, s + 2],
        [a + wide / 2 + 4, s + 2 + tall],
      ] as const,
      lines: lines.map((runs, j) => ({ runs, at: [a, s + ACROSS_LINES.first + j * ACROSS_LINES.step] as At })),
      dot: dotAt,
      underline: [
        [a - formWide / 2, s + 23],
        [a + formWide / 2, s + 23],
      ] as const,
    };
  });

  // Turn into x and y, with everything across moved clear of the edge
  const acrossValues = [
    ...drafts.flatMap((d) => d.points.map((p) => p[1])),
    ...boxDrafts.flatMap((b) => [b.corners[0][1], ...(b.dot ? [b.dot[1]] : [])]),
  ];
  const shift = PAD + (down ? DOT : 8) - Math.min(0, ...acrossValues);
  const xy = ([a, c]: At): Point => (down ? { x: c + shift, y: a } : { x: a, y: c + shift });

  const edges: readonly Edge[] = drafts.map((d) => ({
    ...d,
    points: d.points.map(xy),
    label: d.label && { text: d.label.text, at: xy(d.label.at) },
  }));
  const boxes: readonly Box[] = boxDrafts.map((b) => {
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
  const placedReading: readonly Reading[] = reading.map((r) => ({ ...r, at: xy(r.at) }));

  // The size: everything drawn, with text measured past its point
  const right = (at: Point, text: string, role: Role): number => at.x + measure(text, role) * (down ? 1 : 0.5);
  const extents: readonly Point[] = [
    ...boxes.map((b) => ({ x: b.x + b.width, y: b.y + b.height })),
    ...boxes.flatMap((b) => (b.dot ? [{ x: b.dot.x + DOT, y: b.dot.y + DOT }] : [])),
    ...edges.flatMap((e) => e.points),
    ...edges.flatMap((e) => (e.label ? [{ x: right(e.label.at, e.label.text, "detail"), y: e.label.at.y + 7 }] : [])),
    ...placedReading.map((r) => ({ x: right(r.at, r.text, "form"), y: r.at.y + 6 })),
  ];
  return {
    width: Math.max(0, ...extents.map((p) => p.x)) + PAD,
    height: Math.max(0, ...extents.map((p) => p.y)) + PAD,
    anchor: down ? "start" : "middle",
    corner: shape === "tree" ? 0 : size.corner,
    boxes,
    edges,
    reading: placedReading,
    guides: guides.map(([a, b]) => [xy(a), xy(b)] as const),
  };
}

/** A word's lines of text. Across, its form with a line each for its part of speech (with
 * arcs, which carry the relation) or relation (in the tree), and case. Down, the relation
 * and case share a line beside the form. */
export function labels(word: Word, shape: Shape, direction: Direction): Lines {
  const form: readonly Run[] = [{ text: word.form, role: "form" }];
  const caseRun: readonly Run[] = word.caseName ? [{ text: word.caseName, role: "case" }] : [];
  if (direction === "down") {
    const between: readonly Run[] = word.caseName ? [{ text: " · ", role: "detail" }] : [];
    return [form, [{ text: word.relation, role: "detail" }, ...between, ...caseRun]];
  }
  const detail: readonly Run[] = [{ text: shape === "arcs" ? word.pos : word.relation, role: "detail" }];
  return caseRun.length > 0 ? [form, detail, caseRun] : [form, detail];
}

/** Levels and slots for arcs drawn on one side of the words, shortest first. An arc goes
 * above every arc it spans or crosses. At each word, arcs to the left leave on its left
 * and arcs to the right on its right, and the shorter an arc the nearer its side it
 * leaves, so the longer, higher arcs pass outside it and no two cross at the word. */
export function stack(links: readonly Link[]): readonly Stacked[] {
  const span = (l: Link): readonly [number, number] => [
    Math.min(l.from.order, l.to.order),
    Math.max(l.from.order, l.to.order),
  ];
  const length = (l: Link): number => span(l)[1] - span(l)[0];
  const sorted = [...links].sort((a, b) => length(a) - length(b) || span(a)[0] - span(b)[0]);
  const levelled = sorted.reduce<readonly { readonly link: Link; readonly level: number }[]>((done, link) => {
    const [left, right] = span(link);
    const crossed = done.filter((o) => span(o.link)[0] < right && span(o.link)[1] > left);
    return [...done, { link, level: Math.max(0, ...crossed.map((o) => o.level)) + 1 }];
  }, []);

  /** The arcs meeting a word, ordered by where they leave it. */
  const meeting = (at: Word): readonly Link[] => {
    const other = (l: Link): number => (l.from === at ? l.to : l.from).order;
    return links
      .filter((l) => l.from === at || l.to === at)
      .sort((a, b) => Number(other(b) < at.order) - Number(other(a) < at.order) || other(b) - other(a));
  };
  const slot = (at: Word, link: Link): Slot => {
    const order = meeting(at);
    return { rank: order.indexOf(link), count: order.length };
  };
  return levelled.map(({ link, level }) => ({ link, level, from: slot(link.from, link), to: slot(link.to, link) }));
}

/** Each item with the one after it. */
function neighbours<T>(items: readonly T[]): readonly (readonly [T, T])[] {
  return items.flatMap((item, i) => {
    const next = items[i + 1];
    return next === undefined ? [] : [[item, next] as const];
  });
}

/** Words grouped as the text writes them: an ending joins the word before it. */
function fused(words: readonly Word[]): readonly (readonly Word[])[] {
  return words.reduce<readonly (readonly Word[])[]>((groups, word) => {
    const last = groups.at(-1);
    return last && word.ending ? [...groups.slice(0, -1), [...last, word]] : [...groups, [word]];
  }, []);
}

/** `compute`, worked out once per word. */
function remember<V>(compute: (word: Word) => V): (word: Word) => V {
  const known = new WeakMap<Word, { readonly value: V }>();
  return (word) => {
    const hit = known.get(word);
    if (hit) return hit.value;
    const value = compute(word);
    known.set(word, { value });
    return value;
  };
}

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);
const mean = (values: readonly number[]): number => sum(values) / values.length;
