// Turns a diagram's lines of points (shared/diagram.ts) into SVG paths.
import type { Point } from "@skolia/shared/diagram";

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

/** `length` from `from` towards `to`. */
function toward(from: Point, to: Point, length: number): Point {
  const d = distance(from, to) || 1;
  return { x: from.x + ((to.x - from.x) * length) / d, y: from.y + ((to.y - from.y) * length) / d };
}

/** Straight lines through `points`, each corner rounded by up to `radius`. */
export function rounded(points: readonly Point[], radius: number): string {
  const distinct = points.filter((p, i) => {
    const before = points[i - 1];
    return !before || before.x !== p.x || before.y !== p.y;
  });
  const steps = distinct.flatMap((corner, i) => {
    const before = distinct[i - 1];
    const next = distinct[i + 1];
    if (!before) return [`M ${corner.x} ${corner.y}`];
    if (!next || radius === 0) return [`L ${corner.x} ${corner.y}`];
    const r = Math.min(radius, distance(before, corner) / 2, distance(corner, next) / 2);
    const a = toward(corner, before, r);
    const b = toward(corner, next, r);
    return [`L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`];
  });
  return steps.join(" ");
}

/** An open arrowhead at the last point, pointing the way the last line runs. */
export function arrowhead(points: readonly Point[], length = 6, half = 3.5): string {
  const tip = points.at(-1);
  const before = tip && points.findLast((p) => p.x !== tip.x || p.y !== tip.y);
  if (!tip || !before) return "";
  const back = toward(tip, before, length);
  const ux = (back.x - tip.x) / length;
  const uy = (back.y - tip.y) / length;
  return `M ${back.x - uy * half} ${back.y + ux * half} L ${tip.x} ${tip.y} L ${back.x + uy * half} ${back.y - ux * half}`;
}
