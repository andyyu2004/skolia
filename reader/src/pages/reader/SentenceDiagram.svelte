<script lang="ts">
  // Draws a sentence's diagram (shared/diagram.ts) and lets you pick a word in it. The
  // layout is worked out in shared; this only turns it into SVG and handles selection.
  import { tick } from "svelte";
  import type { Lang } from "@skolia/shared/api";
  import { fitted, layout, type Edge, type Role, type Shape } from "@skolia/shared/diagram";
  import { focusOn, spokenLabel, type Sentence } from "@skolia/shared/tree";
  import { arrowhead, rounded } from "../../lib/path.ts";

  let {
    lang,
    sentence,
    shape,
    selected,
    onselect,
  }: {
    lang: Lang;
    sentence: Sentence;
    /** Arcs over the words in reading order, or a tree hanging from the main word. */
    shape: Shape;
    /** Token indices of the selected word: one, or several for a fused word. */
    selected: ReadonlySet<number>;
    onselect: (index: number) => void;
  } = $props();

  const SIZE: Record<Role, number> = { form: 15, detail: 11, case: 11 };
  const CLASS: Record<Role, string> = { form: "form", detail: "pos", case: "case-name" };
  /** More words than this and the lines not touching the selected word are faded */
  const CROWDED = 15;

  let context: CanvasRenderingContext2D | null = null;
  let fonts: { reading: string; ui: string } | null = null;
  function measure(text: string, role: Role): number {
    context ??= document.createElement("canvas").getContext("2d");
    if (!context) return text.length * SIZE[role] * 0.6;
    if (!fonts) {
      const style = getComputedStyle(document.documentElement);
      fonts = {
        reading: style.getPropertyValue("--reading") || "serif",
        ui: style.getPropertyValue("--ui") || "sans-serif",
      };
    }
    context.font = `${SIZE[role]}px ${role === "form" ? fonts.reading : fonts.ui}`;
    return context.measureText(text).width;
  }

  const focus = $derived(focusOn(sentence, selected));
  /** The room the diagram has: it reads left to right if that roughly fits, else top to bottom */
  let available = $state(0);
  const diagram = $derived(
    available > 0
      ? fitted(sentence, { shape, measure, cases: focus.chain, width: available })
      : layout(sentence, { shape, direction: "across", measure, cases: focus.chain }),
  );
  const near = (e: Edge): boolean => e.kind === "dependency" && (selected.has(e.link.from.index) || selected.has(e.link.to.index));
  /** Highlighted lines after the rest, so where lines share a stretch the highlight shows */
  const edges = $derived(
    [...diagram.edges].sort((a, b) => Number(a.kind === "case") - Number(b.kind === "case") || Number(near(a)) - Number(near(b))),
  );
  const key = (e: Edge): string => `${e.kind} ${e.link.from.index} ${e.link.to.index}`;

  let scroller = $state<HTMLDivElement | null>(null);
  let svg = $state<SVGSVGElement | null>(null);
  /** What the last scroll was for: a new drawing jumps, a new word in the same one glides. */
  let drawn = "";
  $effect(() => {
    const box = diagram.boxes.find((b) => selected.has(b.word.index));
    const view = scroller;
    const picture = `${shape} ${diagram.anchor} ${sentence.words.map((w) => w.index).join(",")}`;
    if (!view || !box) return;
    const glide = drawn === picture;
    drawn = picture;
    void tick().then(() => {
      const left = Math.max(0, Math.min(box.x + box.width / 2 - view.clientWidth / 2, view.scrollWidth - view.clientWidth));
      view.scrollTo({ left, behavior: glide ? "smooth" : "instant" });
      const node = svg?.querySelector<SVGGElement>(".word.selected");
      // Arrow keys move the selection; keep focus on it if it was in the diagram
      if (node && svg?.contains(document.activeElement)) {
        moving = true;
        node.focus({ preventScroll: true });
        moving = false;
      }
      if (node) reveal(node, glide ? "smooth" : "instant");
    });
  });

  /**
   * Scrolls a word's box into view. The box, not the word's group: Firefox scrolls a group's
   * scroller back to the start, and doesn't scroll to one that gets focus
   * (https://bugzilla.mozilla.org/show_bug.cgi?id=1589164). The sheet's scroll-padding
   * keeps it below the tabs.
   */
  function reveal(node: Element, behavior: ScrollBehavior): void {
    node.querySelector("rect")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
  }
  /** Set while the selection moves focus, which scrolls on its own */
  let moving = false;

  function onkeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onselect(index);
  }
</script>

<div class="tree" bind:this={scroller} bind:clientWidth={available}>
  <svg
    bind:this={svg}
    width={diagram.width}
    height={diagram.height}
    viewBox="0 0 {diagram.width} {diagram.height}"
    class={{ hanging: shape === "tree", column: diagram.anchor === "start", crowded: sentence.words.length > CROWDED }}
    role="group"
    aria-label="Sentence structure"
  >
    <g aria-hidden="true">
      {#each diagram.guides as [from, to], i (i)}
        <line class="projection" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      {/each}
      {#each edges as edge (key(edge))}
        <g class={["arc", { case: edge.kind === "case", near: near(edge), why: edge.why }]}>
          <path d={rounded(edge.points, diagram.corner)} />
          {#if edge.arrow}
            <path class="arrow" d={arrowhead(edge.points)} />
          {/if}
          {#if edge.label}
            <text x={edge.label.at.x} y={edge.label.at.y} font-size={SIZE.detail}>{edge.label.text}</text>
          {/if}
        </g>
      {/each}
      {#if diagram.reading.length > 0}
        <g class="reading-row" {lang}>
          {#each diagram.reading as span (span.words[0]?.index)}
            {@const first = span.words[0]}
            <!-- The same as tapping the word's node, which is the keyboard and screen reader's way in -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <text
              class={{ selected: span.words.some((w) => selected.has(w.index)) }}
              x={span.at.x}
              y={span.at.y}
              onclick={() => first && onselect(first.index)}
              >{span.text}</text
            >
          {/each}
        </g>
      {/if}
    </g>
    {#each diagram.boxes as box (box.word.index)}
      {@const word = box.word}
      {@const isSelected = selected.has(word.index)}
      <g
        class={["word", { selected: isSelected, linked: focus.linked.has(word.index), root: word.root }]}
        role="button"
        tabindex={isSelected ? 0 : -1}
        aria-current={isSelected ? "true" : undefined}
        aria-label={spokenLabel(word)}
        onclick={() => onselect(word.index)}
        onkeydown={(event) => onkeydown(event, word.index)}
        onfocus={(event) => moving || reveal(event.currentTarget, "instant")}
      >
        <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="5" />
        {#if box.dot}
          <circle class="dot" cx={box.dot.x} cy={box.dot.y} r="4" />
        {/if}
        {#each box.lines as line, j (j)}
          <text x={line.at.x} y={line.at.y}
            >{#each line.runs as run, k (k)}
              <tspan
                class={[CLASS[run.role], { why: run.role === "case" && isSelected && focus.chain.length > 0 }]}
                font-size={SIZE[run.role]}
                lang={run.role === "form" ? lang : undefined}
                >{run.text}</tspan
              >
            {/each}</text
          >
        {/each}
        {#if word.index === focus.trigger}
          <line class="trigger" x1={box.underline[0].x} y1={box.underline[0].y} x2={box.underline[1].x} y2={box.underline[1].y} />
        {/if}
      </g>
    {/each}
  </svg>
</div>

<style>
  .tree {
    overflow-x: auto;
    overscroll-behavior-x: contain;
    margin: 0 calc(-1 * var(--gutter)) 0.5rem;
    padding: 0 var(--gutter);
    /* Lines carry meaning, so about 3:1 against the sheet */
    --tree-line: color-mix(in srgb, var(--muted) 75%, var(--surface));
  }

  svg {
    display: block;
  }

  text {
    text-anchor: middle;
  }

  .column text {
    text-anchor: start;
  }

  .arc path {
    fill: none;
    stroke: var(--tree-line);
    stroke-width: 1.5;
  }

  /* A wide halo, so lines crossing a label stop short of its letters */
  .arc text {
    dominant-baseline: central;
    fill: var(--muted);
    font-family: var(--ui);
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 6px;
    stroke-linejoin: round;
  }

  /* In a long sentence the selected word's lines stand out from the rest */
  .crowded .arc:not(.near):not(.why) {
    opacity: 0.35;
  }

  .arc.near:not(.why) path {
    stroke: var(--head);
  }

  .arc.near:not(.why) text {
    fill: var(--head);
  }

  .hanging .arc.near path {
    stroke-width: 2;
  }

  .arc.why path {
    stroke: var(--trigger);
    stroke-dasharray: 5 3;
  }

  .arc.why text {
    fill: var(--trigger);
  }

  .arc.case path {
    stroke: var(--trigger);
    stroke-dasharray: 4 3;
  }

  .arc.case path.arrow {
    stroke-dasharray: none;
  }

  .arc.case text {
    fill: var(--trigger);
  }

  .projection {
    fill: none;
    stroke: var(--line);
    stroke-width: 1;
    stroke-dasharray: 1 3;
  }

  .reading-row {
    fill: var(--muted);
    font-family: var(--reading);
    font-size: 13px;
  }

  .reading-row text {
    cursor: pointer;
  }

  .reading-row text:hover {
    fill: var(--text);
  }

  .reading-row .selected {
    fill: var(--text);
    font-weight: 700;
  }

  .word {
    cursor: pointer;
  }

  .word rect {
    fill: transparent;
  }

  .word:focus-visible {
    outline: none;
  }

  .word:focus-visible rect {
    stroke: var(--accent);
    stroke-width: 2;
  }

  .word.selected rect {
    fill: var(--select);
  }

  .form {
    fill: var(--text);
    font-family: var(--reading);
  }

  .word.linked .form {
    fill: var(--head);
  }

  .word.root .form {
    font-weight: 700;
  }

  .pos,
  .case-name {
    fill: var(--muted);
    font-family: var(--ui);
  }

  /* Labels on the yellow selection: muted grey and orange are too faint on it */
  .word.selected .pos,
  .word.selected .case-name {
    fill: var(--text);
  }

  .case-name.why {
    font-weight: 700;
  }

  .dot {
    fill: var(--muted);
  }

  .word.linked .dot {
    fill: var(--head);
  }

  .word.selected .dot {
    fill: var(--accent);
  }

  /* Lines to children cross the labels under a word, so the labels get a halo */
  .hanging .word text {
    paint-order: stroke;
    stroke: var(--surface);
    stroke-width: 3px;
    stroke-linejoin: round;
  }

  .hanging .word.selected text {
    stroke: var(--select);
  }

  line.trigger {
    stroke: var(--trigger);
    stroke-width: 2;
    stroke-dasharray: 4 3;
  }
</style>
