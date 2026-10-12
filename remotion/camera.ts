import { Easing, interpolate } from "remotion";
import { MUSIC } from "./music";
export const beat = (n: number) =>
  Math.round((MUSIC.phaseSeconds + (n * 60) / MUSIC.fittedBpm) * 30);
const t = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.42, 0, 0.58, 1),
  });
// Non-overshooting camera rails with sustained, exactly stationary interaction holds.
export const poses = [
  { n: 0, x: 1060, y: 110, s: 1 },
  { n: 18, x: 1060, y: 110, s: 1 },
  { n: 20, x: 866, y: -53, s: 1.58 },
  { n: 34, x: 866, y: -53, s: 1.58 },
  { n: 37, x: 1060, y: 110, s: 1 },
  { n: 44, x: 1060, y: 110, s: 1 },
  { n: 47, x: 330, y: 100, s: 1.02 },
  { n: 54, x: 330, y: 100, s: 1.02 },
  { n: 57, x: 1060, y: 110, s: 1 },
  { n: 60, x: 1060, y: 110, s: 1 },
  { n: 62, x: 1020, y: 40, s: 1.1 },
  { n: 64, x: 1020, y: 40, s: 1.1 },
  { n: 67, x: 260, y: 110, s: 1 },
  { n: 89, x: 260, y: 110, s: 1 },
  { n: 94, x: -700, y: 110, s: 1 },
];
export function camera(f: number) {
  let a = poses[0],
    z = poses[poses.length - 1];
  for (let j = 0; j < poses.length - 1; j++) {
    if (f >= beat(poses[j].n) && f < beat(poses[j + 1].n)) {
      a = poses[j];
      z = poses[j + 1];
      break;
    }
  }
  const p = t(f, beat(a.n), beat(z.n));
  return {
    x: a.x + (z.x - a.x) * p,
    y: a.y + (z.y - a.y) * p,
    s: a.s + (z.s - a.s) * p,
  };
}
