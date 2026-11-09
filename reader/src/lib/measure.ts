// Shared by the sentence diagrams: text widths for laying out labels, and fused words.
import type { Token } from "@skolia/shared/schema";

let context: CanvasRenderingContext2D | null = null;

/** The width of `text` in a font family from the page's CSS variables (`--reading`, `--ui`). */
export function textWidth(text: string, size: number, variable: "--reading" | "--ui"): number {
  context ??= document.createElement("canvas").getContext("2d");
  const family = getComputedStyle(document.documentElement).getPropertyValue(variable);
  if (!context) return text.length * size * 0.6;
  context.font = `${size}px ${family || (variable === "--reading" ? "serif" : "sans-serif")}`;
  return context.measureText(text).width;
}

/** A token sharing its characters with the one before is the end of a fused word (-em). */
export function isEnding(tokens: Token[], index: number): boolean {
  const token = tokens[index];
  const before = tokens[index - 1];
  return token !== undefined && before !== undefined && token.start === before.start && token.end === before.end;
}
