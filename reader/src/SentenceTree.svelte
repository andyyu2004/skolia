<script lang="ts">
  import type { Lang } from "@skolia/shared/api";
  import type { Token } from "@skolia/shared/schema";
  import { caseChain, sentenceTree, type Arc, type Slot } from "@skolia/shared/tree";
  import { UPOS_LABEL } from "@skolia/shared/ud";

  let {
    lang,
    tokens,
    selected,
    onselect,
  }: {
    lang: Lang;
    tokens: Token[];
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

  const tree = $derived(sentenceTree(tokens));

  let measure: CanvasRenderingContext2D | null = null;
  function width(text: string, size: number, family: string): number {
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return text.length * size * 0.6;
    measure.font = `${size}px ${family}`;
    return measure.measureText(text).width;
  }

  const layout = $derived.by(() => {
    const style = getComputedStyle(document.documentElement);
    const reading = style.getPropertyValue("--reading") || "serif";
    const ui = style.getPropertyValue("--ui") || "sans-serif";
    const label = (text: string): number => width(text, LABEL_SIZE, ui);

    const sized = tree.words.map((w) => {
      const pos = UPOS_LABEL[w.token.upos];
      const wide = Math.max(width(w.token.text, WORD_SIZE, reading), label(pos), w.caseName ? label(w.caseName) : 0);
      return { ...w, pos, width: wide };
    });
    // An arc between neighbours needs room for its label
    const need = sized.map(() => 0);
    for (const arc of [...tree.arcs, ...tree.cases]) {
      if (arc.right - arc.left === 1) need[arc.left] = Math.max(need[arc.left] ?? 0, label(arc.label) + 14);
    }
    let x = PAD;
    const centre = new Map<number, number>();
    const halfWidth = new Map<number, number>();
    const words = sized.map((w, i) => {
      if (i > 0) {
        const before = sized[i - 1];
        x += Math.max((before?.width ?? 0) / 2 + GAP + w.width / 2, need[i - 1] ?? 0);
      } else x += w.width / 2;
      centre.set(w.index, x);
      halfWidth.set(w.index, w.width / 2);
      return { ...w, cx: x };
    });
    const right = x + (sized.at(-1)?.width ?? 0) / 2 + PAD;

    function end(index: number, slot: Slot): number {
      const half = halfWidth.get(index) ?? 0;
      const step = slot.count > 1 ? Math.min(SPREAD, (2 * half - 6) / (slot.count - 1)) : 0;
      return (centre.get(index) ?? 0) + (slot.rank - (slot.count - 1) / 2) * step;
    }

    /** `down` is +1 for arcs below the words, which curve the other way. */
    function draw(arc: Arc, base: number, down: 1 | -1) {
      const from = end(arc.from, arc.fromSlot);
      const to = end(arc.to, arc.toSlot);
      const turn = base + down * arc.level * LEVEL;
      const r = Math.min(7, Math.abs(to - from) / 2);
      const dir = to > from ? 1 : -1;
      const path = `M ${from} ${base} V ${turn - down * r} Q ${from} ${turn} ${from + dir * r} ${turn} H ${to - dir * r} Q ${to} ${turn} ${to} ${turn - down * r} V ${base}`;
      const arrow = `M ${to - 3.5} ${base - down * 6} L ${to} ${base} L ${to + 3.5} ${base - down * 6}`;
      return { arc, path, arrow, mid: (from + to) / 2, turn };
    }

    const top = tree.levels * LEVEL + PAD + 4;
    const anyCase = tree.words.some((w) => w.caseName !== null);
    const rowHeight = anyCase ? 50 : 38;
    const bottom = top + rowHeight + 4;
    return {
      words,
      arcs: tree.arcs.map((a) => draw(a, top, -1)),
      below: (arc: Arc) => draw(arc, bottom, 1),
      top,
      rowHeight,
      bottom,
      width: right,
    };
  });

  /** Only the selected word's case arcs: drawn for every word they mostly repeat the arcs above. */
  const cases = $derived(caseChain(tree.cases, selected).map((a) => layout.below(a)));
  const height = $derived(layout.bottom + Math.max(0, ...cases.map((c) => c.arc.level)) * LEVEL + PAD);

  /** The words the selection is linked to: its head and its dependents. */
  const linked = $derived(
    new Set(
      tree.arcs.flatMap((a) => (selected.has(a.to) ? [a.from] : selected.has(a.from) ? [a.to] : [])),
    ),
  );
  /** The word causing the selected word's case, as the text marks it. */
  const trigger = $derived(tree.cases.find((a) => selected.has(a.to))?.from ?? null);

  let scroller = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const word = layout.words.find((w) => selected.has(w.index));
    if (scroller && word) scroller.scrollLeft = word.cx - scroller.clientWidth / 2;
  });

  function onkeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onselect(index);
  }
</script>

<div class="tree" bind:this={scroller}>
  <svg
    width={layout.width}
    {height}
    viewBox="0 0 {layout.width} {height}"
    role="group"
    aria-label="Sentence structure"
  >
    {#each layout.arcs as { arc, path, arrow, mid, turn } (arc.to)}
      <g class="arc" class:near={selected.has(arc.from) || selected.has(arc.to)}>
        <title>{arc.raw}</title>
        <path d={path} />
        <path d={arrow} />
        <text x={mid} y={turn + 3.5} font-size={LABEL_SIZE}>{arc.label}</text>
      </g>
    {/each}
    {#each cases as { arc, path, arrow, mid, turn } (arc.to)}
      <g class="arc case">
        <title>{arc.raw}</title>
        <path d={path} />
        <path class="arrow" d={arrow} />
        <text x={mid} y={turn + 3.5} font-size={LABEL_SIZE}>{arc.label}</text>
      </g>
    {/each}
    {#each layout.words as word (word.index)}
      {@const isSelected = selected.has(word.index)}
      <g
        class="word"
        class:selected={isSelected}
        class:linked={linked.has(word.index)}
        class:root={word.root}
        role="button"
        tabindex="0"
        aria-label="{word.token.text}, {word.pos}{word.caseName ? `, ${word.caseName}` : ''}"
        onclick={() => onselect(word.index)}
        onkeydown={(event) => onkeydown(event, word.index)}
      >
        <rect x={word.cx - word.width / 2 - 4} y={layout.top + 2} width={word.width + 8} height={layout.rowHeight} rx="5" />
        <text class="form" {lang} x={word.cx} y={layout.top + 19} font-size={WORD_SIZE}>{word.token.text}</text>
        {#if word.index === trigger}
          <line class="trigger" x1={word.cx - word.width / 2} x2={word.cx + word.width / 2} y1={layout.top + 23} y2={layout.top + 23} />
        {/if}
        <text class="pos" x={word.cx} y={layout.top + 35} font-size={LABEL_SIZE}>{word.pos}</text>
        {#if word.caseName}
          <text class="case-name" class:why={isSelected && cases.length > 0} x={word.cx} y={layout.top + 48} font-size={LABEL_SIZE}
            >{word.caseName}</text
          >
        {/if}
      </g>
    {/each}
  </svg>
</div>
