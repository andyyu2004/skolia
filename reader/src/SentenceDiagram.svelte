<script lang="ts">
  // Draws a sentence's diagram (shared/diagram.ts) and lets you pick a word in it. The
  // layout is worked out in shared; this only turns it into SVG and handles selection.
  import { tick } from "svelte";
  import type { Lang } from "@skolia/shared/api";
  import { layout, type Direction, type Edge, type Role, type Shape } from "@skolia/shared/diagram";
  import { focusOn, spokenLabel, type Sentence } from "@skolia/shared/tree";
  import { arrowhead, rounded } from "./lib/path.ts";

  let {
    lang,
    sentence,
    shape,
    direction,
    selected,
    onselect,
  }: {
    lang: Lang;
    sentence: Sentence;
    /** Arcs over the words in reading order, or a tree hanging from the main word. */
    shape: Shape;
    /** Left to right, or top to bottom on a narrow screen. */
    direction: Direction;
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
  const diagram = $derived(layout(sentence, { shape, direction, measure, cases: focus.chain }));
  const near = (e: Edge): boolean =>
    e.kind === "dependency" && (selected.has(e.link.from.index) || selected.has(e.link.to.index));
  /** Highlighted lines after the rest, so where lines share a stretch the highlight shows */
  const edges = $derived(
    [...diagram.edges].sort(
      (a, b) => Number(a.kind === "case") - Number(b.kind === "case") || Number(near(a)) - Number(near(b)),
    ),
  );
  const key = (e: Edge): string => `${e.kind} ${e.link.from.index} ${e.link.to.index}`;

  let scroller = $state<HTMLDivElement | null>(null);
  let svg = $state<SVGSVGElement | null>(null);
  /** What the last scroll was for: a new drawing jumps, a new word in the same one glides. */
  let drawn = "";
  $effect(() => {
    const box = diagram.boxes.find((b) => selected.has(b.word.index));
    const view = scroller;
    const picture = `${shape} ${direction} ${sentence.words.map((w) => w.index).join(",")}`;
    if (!view || !box) return;
    const glide = drawn === picture;
    drawn = picture;
    void tick().then(() => {
      const left = Math.max(0, Math.min(box.x + box.width / 2 - view.clientWidth / 2, view.scrollWidth - view.clientWidth));
      view.scrollTo({ left, behavior: glide ? "smooth" : "instant" });
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
    width={diagram.width}
    height={diagram.height}
    viewBox="0 0 {diagram.width} {diagram.height}"
    class:hanging={shape === "tree"}
    class:column={diagram.anchor === "start"}
    class:crowded={sentence.words.length > CROWDED}
    role="group"
    aria-label="Sentence structure"
  >
    <g aria-hidden="true">
      {#each diagram.guides as [from, to], i (i)}
        <line class="projection" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
      {/each}
      {#each edges as edge (key(edge))}
        <g class="arc" class:case={edge.kind === "case"} class:near={near(edge)} class:why={edge.why}>
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
            <text class:selected={span.words.some((w) => selected.has(w.index))} x={span.at.x} y={span.at.y}
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
        class="word"
        class:selected={isSelected}
        class:linked={focus.linked.has(word.index)}
        class:root={word.root}
        role="button"
        tabindex={isSelected ? 0 : -1}
        aria-current={isSelected ? "true" : undefined}
        aria-label={spokenLabel(word)}
        onclick={() => onselect(word.index)}
        onkeydown={(event) => onkeydown(event, word.index)}
      >
        <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="5" />
        {#if box.dot}
          <circle class="dot" cx={box.dot.x} cy={box.dot.y} r="4" />
        {/if}
        {#each box.lines as line, j (j)}
          <text x={line.at.x} y={line.at.y}
            >{#each line.runs as run, k (k)}<tspan
                class={CLASS[run.role]}
                class:why={run.role === "case" && isSelected && focus.chain.length > 0}
                font-size={SIZE[run.role]}
                lang={run.role === "form" ? lang : undefined}>{run.text}</tspan
              >{/each}</text
          >
        {/each}
        {#if word.index === focus.trigger}
          <line
            class="trigger"
            x1={box.underline[0].x}
            y1={box.underline[0].y}
            x2={box.underline[1].x}
            y2={box.underline[1].y}
          />
        {/if}
      </g>
    {/each}
  </svg>
</div>
