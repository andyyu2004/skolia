// Turns a diagram's lines of points (shared/diagram.ts) into SVG paths.
import type { Point } from "@skolia/shared/diagram";

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** `length` from `from` towards `to`. */
function toward(from: Point, to: Point, length: number): Point {
  const d = distance(from, to) || 1;
  return { x: from.x + ((to.x - from.x) * length) / d, y: from.y + ((to.y - from.y) * length) / d };
}

/** Straight lines through `points`, each corner rounded by up to `radius`. */
export function rounded(points: Point[], radius: number): string {
  const p = points.filter((pt, i) => {
    const before = points[i - 1];
    return !before || before.x !== pt.x || before.y !== pt.y;
  });
  const first = p[0];
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  p.slice(1).forEach((corner, i) => {
    const before = p[i] ?? first;
    const next = p[i + 2];
    if (!next || radius === 0) {
      d += ` L ${corner.x} ${corner.y}`;
      return;
    }
    const r = Math.min(radius, distance(before, corner) / 2, distance(corner, next) / 2);
    const a = toward(corner, before, r);
    const b = toward(corner, next, r);
    d += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
  });
  return d;
}

/** An open arrowhead at the last point, pointing the way the last line runs. */
export function arrowhead(points: Point[], length = 6, half = 3.5): string {
  const tip = points.at(-1);
  const before = [...points].reverse().find((p) => tip && (p.x !== tip.x || p.y !== tip.y));
  if (!tip || !before) return "";
  const back = toward(tip, before, length);
  const ux = (back.x - tip.x) / length;
  const uy = (back.y - tip.y) / length;
  return `M ${back.x - uy * half} ${back.y + ux * half} L ${tip.x} ${tip.y} L ${back.x + uy * half} ${back.y - ux * half}`;
}
