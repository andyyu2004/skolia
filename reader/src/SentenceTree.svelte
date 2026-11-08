<script lang="ts">
  import { tick } from "svelte";
  import type { Lang } from "@skolia/shared/api";
  import type { Token } from "@skolia/shared/schema";
  import { caseChain, sentenceTree, type Arc, type Slot } from "@skolia/shared/tree";
  import { UPOS_LABEL } from "@skolia/shared/ud";
  import type { SentenceLayout } from "./lib/sheet.svelte.ts";

  let {
    lang,
    layout: shape,
    tokens,
    keep,
    cases: showCases,
    partOfWord,
    selected,
    onselect,
  }: {
    lang: Lang;
    /** Arcs above the words in reading order, or a tree hanging from the main word. */
    layout: SentenceLayout;
    tokens: Token[];
    /** Only these tokens: the clause around the word in a long sentence */
    keep?: ReadonlySet<number> | undefined;
    /** Show each word's case: for languages where nouns and adjectives have one */
    cases: boolean;
    /** The language's label for a token that is only part of a word (Polish -em) */
    partOfWord: (token: Token) => string | null;
    /** Token indices of the selected word: one, or several for a fused word. */
    selected: ReadonlySet<number>;
    onselect: (index: number) => void;
  } = $props();

  const WORD_SIZE = 15;
  const LABEL_SIZE = 11;
  const GAP = 18;
  const LEVEL = 22;
  const PAD = 8;
  /** Most room between two arc ends meeting at a word */
  const SPREAD = 7;
  /** Tree layout: a word's dot, and room above the main word for a case curve */
  const DOT = 4;
  const BOW = 20;
  /** More words than this and the arcs not touching the selected word are faded */
  const CROWDED = 15;

  const tree = $derived(sentenceTree(tokens, keep));
  const crowded = $derived(tree.words.length > CROWDED);

  let measure: CanvasRenderingContext2D | null = null;
  function width(text: string, size: number, family: string): number {
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return text.length * size * 0.6;
    measure.font = `${size}px ${family}`;
    return measure.measureText(text).width;
  }

  /** A token sharing its characters with the one before is the end of a fused word (-em) */
  function isEnding(index: number): boolean {
    const token = tokens[index];
    const before = tokens[index - 1];
    return token !== undefined && before !== undefined && token.start === before.start && token.end === before.end;
  }

  /** Columns in reading order, wide enough for each word's labels and its arcs' labels. */
  const columns = $derived.by(() => {
    const style = getComputedStyle(document.documentElement);
    const reading = style.getPropertyValue("--reading") || "serif";
    const ui = style.getPropertyValue("--ui") || "sans-serif";
    const label = (text: string): number => width(text, LABEL_SIZE, ui);

    const sized = tree.words.map((w) => {
      const part = partOfWord(w.token);
      const pos = part ?? UPOS_LABEL[w.token.upos];
      // Arcs carry the relation, so the words show their part of speech; the tree the other way round
      const second = shape === "arcs" ? pos : w.root ? "main word" : w.relation;
      const form = isEnding(w.index) ? `-${w.token.text}` : w.token.text;
      const caseName = showCases ? w.caseName : null;
      const wide = Math.max(width(form, WORD_SIZE, reading), label(second), caseName ? label(caseName) : 0);
      return { ...w, pos, second, form, caseName, width: wide };
    });
    const need = sized.map(() => 0);
    if (shape === "arcs") {
      for (const arc of [...tree.arcs, ...tree.cases]) {
        if (arc.right - arc.left === 1) need[arc.left] = Math.max(need[arc.left] ?? 0, label(arc.label) + 14);
      }
    }
    let x = PAD;
    const words = sized.map((w, i) => {
      const before = sized[i - 1];
      x += before ? Math.max(before.width / 2 + GAP + w.width / 2, need[i - 1] ?? 0) : w.width / 2;
      return { ...w, cx: x };
    });
    return { words, width: x + (sized.at(-1)?.width ?? 0) / 2 + PAD };
  });
  const centre = $derived(new Map(columns.words.map((w) => [w.index, w])));
  const anyCase = $derived(columns.words.some((w) => w.caseName !== null));

  /** Height of a word's labels: its form, part of speech or relation, and case */
  const labels = $derived(anyCase ? 50 : 38);
  const top = $derived(shape === "arcs" ? tree.levels * LEVEL + PAD + 4 : PAD + DOT + BOW);
  const row = $derived(labels + 30);
  const depth = $derived(Math.max(0, ...tree.words.map((w) => w.depth)));
  /** Where each word's labels start */
  function labelTop(d: number): number {
    return shape === "arcs" ? top : top + d * row + DOT + 2;
  }
  function dotY(d: number): number {
    return top + d * row;
  }
  /** Tree layout: lines down to a word's children start under its labels, not across them. */
  function underLabels(d: number): number {
    return labelTop(d) + labels + 4;
  }

  function end(index: number, slot: Slot): number {
    const word = centre.get(index);
    if (!word) return 0;
    const step = slot.count > 1 ? Math.min(SPREAD, (word.width - 6) / (slot.count - 1)) : 0;
    return word.cx + (slot.rank - (slot.count - 1) / 2) * step;
  }

  /** An arc above (`down` -1) or below (+1) the row of words, its arrow into the dependent. */
  function bracket(arc: Arc, base: number, down: 1 | -1) {
    const from = end(arc.from, arc.fromSlot);
    const to = end(arc.to, arc.toSlot);
    const turn = base + down * arc.level * LEVEL;
    const r = Math.min(7, Math.abs(to - from) / 2);
    const dir = to > from ? 1 : -1;
    const path = `M ${from} ${base} V ${turn - down * r} Q ${from} ${turn} ${from + dir * r} ${turn} H ${to - dir * r} Q ${to} ${turn} ${to} ${turn - down * r} V ${base}`;
    const arrow = `M ${to - 3.5} ${base + down * 6} L ${to} ${base} L ${to + 3.5} ${base + down * 6}`;
    return { arc, path, arrow, x: (from + to) / 2, y: turn + 3.5 };
  }

  /** A case reason in the tree: a dashed curve from the word causing the case to the word
   * with it, leaving and entering each word on the side facing the other, bowed off the
   * straight line. */
  function bow(arc: Arc) {
    const a = centre.get(arc.from);
    const b = centre.get(arc.to);
    const ad = a?.depth ?? 0;
    const bd = b?.depth ?? 0;
    const ax = a?.cx ?? 0;
    const bx = b?.cx ?? 0;
    const ay = ad < bd ? underLabels(ad) : dotY(ad);
    const by = bd < ad ? underLabels(bd) : dotY(bd);
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const side = bx >= ax ? 1 : -1;
    const cx = (ax + bx) / 2 + (side * (by - ay) * BOW) / length;
    const cy = (ay + by) / 2 - (side * (bx - ax) * BOW) / length;
    const path = `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
    const angle = Math.atan2(by - cy, bx - cx);
    const tip = (t: number): string => `${bx - 7 * Math.cos(angle + t)} ${by - 7 * Math.sin(angle + t)}`;
    const arrow = `M ${tip(0.45)} L ${bx} ${by} L ${tip(-0.45)}`;
    return { arc, path, arrow, x: (ax + 2 * cx + bx) / 4, y: (ay + 2 * cy + by) / 4 + 3.5 };
  }

  /** A tree line, as in an org chart: down from under the head's labels to a bar shared
   * with its other dependents, along it, and down to the dependent's dot. */
  function elbow(arc: Arc) {
    const a = centre.get(arc.from);
    const b = centre.get(arc.to);
    if (!a || !b) return null;
    const from = underLabels(a.depth);
    const bar = from + (dotY(a.depth + 1) - from) / 2;
    return { arc, path: `M ${a.cx} ${from} V ${bar} H ${b.cx} V ${dotY(b.depth)}` };
  }

  const pair = (a: Arc): string => [a.from, a.to].sort((x, y) => x - y).join(" ");
  const chain = $derived(caseChain(tree.cases, selected));
  /** A case reason between two words a dependency already joins is shown on that line,
   * not as a second one beside it. */
  const joined = $derived(new Set(tree.arcs.map(pair)));
  const whyLines = $derived(new Set(chain.filter((a) => joined.has(pair(a))).map(pair)));
  const isWhy = (arc: Arc): boolean => whyLines.has(pair(arc));

  const arcsBottom = $derived(top + labels + 4);
  const cases = $derived(
    chain.filter((a) => !isWhy(a)).map((a) => (shape === "arcs" ? bracket(a, arcsBottom, 1) : bow(a))),
  );

  /** Tree layout: the sentence along the bottom as the text has it (fused words whole),
   * each word under its own column. Too short a sentence to need it has none. */
  const readingRow = $derived(dotY(depth) + DOT + 2 + labels + 34);
  const spans = $derived.by(() => {
    if (shape !== "tree" || columns.words.length < 3) return [];
    const out: { text: string; x: number; selected: boolean; key: number }[] = [];
    for (const word of columns.words) {
      const last = out.at(-1);
      if (last && isEnding(word.index)) {
        last.text += word.token.text;
        last.x = (last.x + word.cx) / 2;
        last.selected ||= selected.has(word.index);
      } else out.push({ text: word.token.text, x: word.cx, selected: selected.has(word.index), key: word.index });
    }
    return out;
  });

  const height = $derived(
    shape === "arcs"
      ? arcsBottom + Math.max(0, ...cases.map((c) => c.arc.level)) * LEVEL + PAD
      : spans.length > 0
        ? readingRow + 6 + PAD
        : dotY(depth) + DOT + 2 + labels + PAD,
  );
  const near = (arc: Arc): boolean => selected.has(arc.from) || selected.has(arc.to);
  /** Highlighted lines last, so where siblings share a stem and bar the highlight shows */
  const byNear = (x: { arc: Arc }, y: { arc: Arc }): number => Number(near(x.arc)) - Number(near(y.arc));
  const brackets = $derived(shape === "arcs" ? tree.arcs.map((a) => bracket(a, top, -1)).sort(byNear) : []);
  const elbows = $derived(shape === "tree" ? tree.arcs.flatMap((a) => elbow(a) ?? []).sort(byNear) : []);

  /** The words the selection is linked to: its head and its dependents. */
  const linked = $derived(
    new Set(tree.arcs.flatMap((a) => (selected.has(a.to) ? [a.from] : selected.has(a.from) ? [a.to] : []))),
  );
  /** The word causing the selected word's case, as the text marks it. */
  const trigger = $derived(tree.cases.find((a) => selected.has(a.to))?.from ?? null);

  function spoken(word: (typeof columns.words)[number]): string {
    const head = word.token.head === null ? undefined : centre.get(word.token.head);
    const role = word.root ? "main word" : head ? `${word.relation} of ${head.token.text}` : word.relation;
    return [word.token.text, word.pos, role, word.caseName].filter(Boolean).join(", ");
  }

  let scroller = $state<HTMLDivElement | null>(null);
  let svg = $state<SVGSVGElement | null>(null);
  /** Where the last scroll was for: a new layout or clause jumps, a new word glides. */
  let drawn: unknown = null;
  $effect(() => {
    const word = columns.words.find((w) => selected.has(w.index));
    const box = scroller;
    const picture = tree;
    if (!box || !word) return;
    const glide = drawn === picture;
    drawn = picture;
    void tick().then(() => {
      const left = Math.max(0, Math.min(word.cx - box.clientWidth / 2, box.scrollWidth - box.clientWidth));
      box.scrollTo({ left, behavior: glide ? "smooth" : "instant" });
      const node = svg?.querySelector<SVGGElement>(".word.selected");
      // Arrow keys move the selection; keep focus on it if it was in the diagram
      if (node && svg?.contains(document.activeElement)) node.focus({ preventScroll: true });
      node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: glide ? "smooth" : "instant" });
    });
  });

  function onkeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onselect(index);
  }
</script>

<div class="tree" bind:this={scroller}>
  <svg
    bind:this={svg}
    width={columns.width}
    {height}
    viewBox="0 0 {columns.width} {height}"
    class:hanging={shape === "tree"}
    class:crowded
    role="group"
    aria-label="Sentence structure"
  >
    <g aria-hidden="true">
      {#if shape === "tree"}
        {#each columns.words as word (word.index)}
          {#if spans.length > 0}
            <path class="projection" d="M {word.cx} {underLabels(word.depth)} V {readingRow - 14}" />
          {/if}
        {/each}
      {/if}
      {#each brackets as { arc, path, arrow, x, y } (arc.to)}
        <g class="arc" class:near={near(arc)} class:why={isWhy(arc)}>
          <path d={path} />
          <path d={arrow} />
          <text {x} {y} font-size={LABEL_SIZE}>{arc.label}</text>
        </g>
      {/each}
      {#each elbows as { arc, path } (arc.to)}
        <g class="arc" class:near={near(arc)} class:why={isWhy(arc)}>
          <path d={path} />
        </g>
      {/each}
      {#each cases as { arc, path, arrow, x, y } (arc.to)}
        <g class="arc case">
          <path d={path} />
          <path class="arrow" d={arrow} />
          <text {x} {y} font-size={LABEL_SIZE}>{arc.label}</text>
        </g>
      {/each}
      {#if spans.length > 0}
        <g class="reading-row" {lang}>
          {#each spans as span (span.key)}
            <text class:selected={span.selected} x={span.x} y={readingRow}>{span.text}</text>
          {/each}
        </g>
      {/if}
    </g>
    {#each columns.words as word (word.index)}
      {@const isSelected = selected.has(word.index)}
      {@const y = labelTop(word.depth)}
      <g
        class="word"
        class:selected={isSelected}
        class:linked={linked.has(word.index)}
        class:root={word.root}
        role="button"
        tabindex={isSelected ? 0 : -1}
        aria-current={isSelected ? "true" : undefined}
        aria-label={spoken(word)}
        onclick={() => onselect(word.index)}
        onkeydown={(event) => onkeydown(event, word.index)}
      >
        <rect x={word.cx - word.width / 2 - 4} y={y + 2} width={word.width + 8} height={labels} rx="5" />
        {#if shape === "tree" && !word.root}
          <circle class="dot" cx={word.cx} cy={dotY(word.depth)} r={DOT} />
        {/if}
        <text class="form" {lang} x={word.cx} y={y + 19} font-size={WORD_SIZE}>{word.form}</text>
        {#if word.index === trigger}
          <line class="trigger" x1={word.cx - word.width / 2} x2={word.cx + word.width / 2} y1={y + 23} y2={y + 23} />
        {/if}
        <text class="pos" x={word.cx} y={y + 35} font-size={LABEL_SIZE}>{word.second}</text>
        {#if word.caseName}
          <text class="case-name" class:why={isSelected && chain.length > 0} x={word.cx} y={y + 48} font-size={LABEL_SIZE}
            >{word.caseName}</text
          >
        {/if}
      </g>
    {/each}
  </svg>
</div>
