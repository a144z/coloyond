import { Easing, interpolate } from "remotion";
import { MUSIC } from "./music";
export const beat = (n: number) => Math.round((MUSIC.phaseSeconds + n * 60 / MUSIC.fittedBpm) * 30);
const ease = Easing.bezier(0.65, 0, 0.25, 1);
const t = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], {extrapolateLeft:"clamp",extrapolateRight:"clamp",easing:ease});
export const poses = [
  { n: 0, x: 1100, y: 120, s: 0.9 },
  { n: 8, x: 1080, y: 116, s: 0.95 },
  { n: 17, x: 1060, y: 110, s: 1 },
  { n: 20, x: 866, y: -53, s: 1.58 },
  { n: 32, x: 866, y: -53, s: 1.58 },
  { n: 35, x: 1010, y: 94, s: 1.03 },
  { n: 39, x: 980, y: 25, s: 1.14 },
  { n: 44, x: 1020, y: 104, s: 1 },
  { n: 47, x: 330, y: 60, s: 1.05 },
  { n: 50, x: 330, y: -60, s: 1.25 },
  { n: 56, x: 330, y: 110, s: 1 },
  { n: 81, x: 330, y: 110, s: 1 },
  { n: 83, x: 360, y: 110, s: 1 },
  { n: 89, x: 360, y: 110, s: 1 },
  { n: 94, x: -700, y: 110, s: 0.95 },
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
