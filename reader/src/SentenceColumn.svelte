<script lang="ts">
  // The sentence diagrams turned on their side for a narrow screen: one word a row, read
  // top to bottom. Arcs bend out to the left of the words; the tree indents each word by
  // its depth. Each word's relation is written under it, so the lines need no labels.
  import { tick } from "svelte";
  import type { Lang } from "@skolia/shared/api";
  import type { Token } from "@skolia/shared/schema";
  import { caseChain, sentenceTree, type Arc, type Slot } from "@skolia/shared/tree";
  import { UPOS_LABEL } from "@skolia/shared/ud";
  import type { SentenceLayout } from "./lib/sheet.svelte.ts";
  import { isEnding, textWidth } from "./lib/measure.ts";

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
    layout: SentenceLayout;
    tokens: Token[];
    keep?: ReadonlySet<number> | undefined;
    cases: boolean;
    partOfWord: (token: Token) => string | null;
    selected: ReadonlySet<number>;
    onselect: (index: number) => void;
  } = $props();

  const WORD_SIZE = 15;
  const LABEL_SIZE = 11;
  const ROW = 40;
  const PAD = 8;
  /** Room between nested arcs, and between tree depths */
  const LEVEL = 12;
  const INDENT = 18;
  const DOT = 4;
  /** Most room between two arc ends meeting at a word */
  const SPREAD = 5;
  const CROWDED = 15;

  const tree = $derived(sentenceTree(tokens, keep));
  const crowded = $derived(tree.words.length > CROWDED);

  /** Where the arcs meet the words, or the tree's top level */
  const left = $derived(shape === "arcs" ? PAD + tree.levels * LEVEL + 2 : PAD + DOT);
  const rows = $derived(
    tree.words.map((w, i) => {
      const form = isEnding(tokens, w.index) ? `-${w.token.text}` : w.token.text;
      const relation = w.root ? "main word" : w.relation;
      const caseName = showCases ? w.caseName : null;
      const x = shape === "arcs" ? left : left + w.depth * INDENT;
      const textX = x + (shape === "arcs" ? 6 : DOT + 6);
      const formWidth = textWidth(form, WORD_SIZE, "--reading");
      const sub = caseName ? `${relation} · ${caseName}` : relation;
      const y = PAD + i * ROW;
      return {
        ...w,
        form,
        relation,
        caseName,
        pos: partOfWord(w.token) ?? UPOS_LABEL[w.token.upos],
        x,
        textX,
        formWidth,
        wide: Math.max(formWidth, textWidth(sub, LABEL_SIZE, "--ui")),
        y,
        mid: y + 13,
      };
    }),
  );
  const at = $derived(new Map(rows.map((r) => [r.index, r])));

  function end(index: number, slot: Slot): number {
    const row = at.get(index);
    if (!row) return 0;
    const step = slot.count > 1 ? Math.min(SPREAD, 16 / (slot.count - 1)) : 0;
    return row.mid + (slot.rank - (slot.count - 1) / 2) * step;
  }

  /** A dependency bending out to the left, its arrow into the dependent. */
  function bracket(arc: Arc) {
    const from = end(arc.from, arc.fromSlot);
    const to = end(arc.to, arc.toSlot);
    const turn = left - arc.level * LEVEL;
    const r = Math.min(5, Math.abs(to - from) / 2);
    const dir = to > from ? 1 : -1;
    const path = `M ${left} ${from} H ${turn + r} Q ${turn} ${from} ${turn} ${from + dir * r} V ${to - dir * r} Q ${turn} ${to} ${turn + r} ${to} H ${left}`;
    const arrow = `M ${left - 6} ${to - 3.5} L ${left} ${to} L ${left - 6} ${to + 3.5}`;
    return { arc, path, arrow };
  }

  /** A tree line, as in a file tree: down (or up) from the head's dot, across to the dependent's. */
  function elbow(arc: Arc) {
    const a = at.get(arc.from);
    const b = at.get(arc.to);
    if (!a || !b) return null;
    return { arc, path: `M ${a.x} ${a.mid} V ${b.mid} H ${b.x - DOT}` };
  }

  const pair = (a: Arc): string => [a.from, a.to].sort((x, y) => x - y).join(" ");
  const chain = $derived(caseChain(tree.cases, selected));
  const joined = $derived(new Set(tree.arcs.map(pair)));
  const whyLines = $derived(new Set(chain.filter((a) => joined.has(pair(a))).map(pair)));
  const isWhy = (arc: Arc): boolean => whyLines.has(pair(arc));

  /** Case reasons no dependency carries bend out to the right of the words. */
  const lane = $derived(Math.max(0, ...rows.map((r) => r.textX + r.wide)) + 10);
  const cases = $derived(
    chain
      .filter((a) => !isWhy(a))
      .flatMap((arc) => {
        const a = at.get(arc.from);
        const b = at.get(arc.to);
        if (!a || !b) return [];
        const turn = lane + (arc.level - 1) * LEVEL;
        const ax = a.textX + a.formWidth + 4;
        const bx = b.textX + b.formWidth + 4;
        const r = Math.min(5, Math.abs(b.mid - a.mid) / 2);
        const dir = b.mid > a.mid ? 1 : -1;
        const path = `M ${ax} ${a.mid} H ${turn - r} Q ${turn} ${a.mid} ${turn} ${a.mid + dir * r} V ${b.mid - dir * r} Q ${turn} ${b.mid} ${turn - r} ${b.mid} H ${bx}`;
        const arrow = `M ${bx + 6} ${b.mid - 3.5} L ${bx} ${b.mid} L ${bx + 6} ${b.mid + 3.5}`;
        return [{ arc, path, arrow, x: turn + 5, y: (a.mid + b.mid) / 2 + 3.5 }];
      }),
  );

  const width = $derived(
    Math.max(
      lane,
      ...cases.map((c) => c.x + textWidth(c.arc.label, LABEL_SIZE, "--ui")),
    ) + PAD,
  );
  const height = $derived(PAD + rows.length * ROW + PAD);

  const near = (arc: Arc): boolean => selected.has(arc.from) || selected.has(arc.to);
  const byNear = (x: { arc: Arc }, y: { arc: Arc }): number => Number(near(x.arc)) - Number(near(y.arc));
  const brackets = $derived(shape === "arcs" ? tree.arcs.map(bracket).sort(byNear) : []);
  const elbows = $derived(shape === "tree" ? tree.arcs.flatMap((a) => elbow(a) ?? []).sort(byNear) : []);

  const linked = $derived(
    new Set(
      tree.arcs
        .flatMap((a) => (selected.has(a.to) ? [a.from] : selected.has(a.from) ? [a.to] : []))
        .filter((i) => !selected.has(i)),
    ),
  );
  const trigger = $derived(tree.cases.find((a) => selected.has(a.to))?.from ?? null);

  function spoken(row: (typeof rows)[number]): string {
    const head = row.token.head === null ? undefined : at.get(row.token.head);
    const role = row.root ? "main word" : head ? `${row.relation} of ${head.token.text}` : row.relation;
    return [row.token.text, row.pos, role, row.caseName].filter(Boolean).join(", ");
  }

  let svg = $state<SVGSVGElement | null>(null);
  let drawn: unknown = null;
  $effect(() => {
    void [...selected];
    const picture = tree;
    const glide = drawn === picture;
    drawn = picture;
    void tick().then(() => {
      const node = svg?.querySelector<SVGGElement>(".word.selected");
      if (node && svg?.contains(document.activeElement)) node.focus({ preventScroll: true });
      node?.scrollIntoView({ block: "nearest", behavior: glide ? "smooth" : "instant" });
    });
  });

  function onkeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onselect(index);
  }
</script>

<div class="tree">
  <svg
    bind:this={svg}
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    class="column"
    class:hanging={shape === "tree"}
    class:crowded
    role="group"
    aria-label="Sentence structure"
  >
    <g aria-hidden="true">
      {#each brackets as { arc, path, arrow } (arc.to)}
        <g class="arc" class:near={near(arc)} class:why={isWhy(arc)}>
          <path d={path} />
          <path d={arrow} />
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
    </g>
    {#each rows as row (row.index)}
      {@const isSelected = selected.has(row.index)}
      <g
        class="word"
        class:selected={isSelected}
        class:linked={linked.has(row.index)}
        class:root={row.root}
        role="button"
        tabindex={isSelected ? 0 : -1}
        aria-current={isSelected ? "true" : undefined}
        aria-label={spoken(row)}
        onclick={() => onselect(row.index)}
        onkeydown={(event) => onkeydown(event, row.index)}
      >
        <rect x={row.textX - 4} y={row.y} width={row.wide + 8} height={ROW - 3} rx="5" />
        {#if shape === "tree"}
          <circle class="dot" cx={row.x} cy={row.mid} r={DOT} />
        {/if}
        <text class="form" {lang} x={row.textX} y={row.y + 18} font-size={WORD_SIZE}>{row.form}</text>
        {#if row.index === trigger}
          <line class="trigger" x1={row.textX} x2={row.textX + row.formWidth} y1={row.y + 22} y2={row.y + 22} />
        {/if}
        <text x={row.textX} y={row.y + 32} font-size={LABEL_SIZE}
          ><tspan class="pos">{row.relation}</tspan
          >{#if row.caseName}<tspan class="pos">{" · "}</tspan><tspan
              class="case-name"
              class:why={isSelected && chain.length > 0}>{row.caseName}</tspan
            >{/if}</text
        >
      </g>
    {/each}
  </svg>
</div>
