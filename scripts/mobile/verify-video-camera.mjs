import assert from 'node:assert/strict';
import {camera,beat} from '../../remotion/camera.ts';
// User-visible stability contract: no drift during gestures, bounded continuous camera rails.
for (const [start,end] of [[20,34],[37,44],[47,54],[67,89]]) {
  const held=camera(beat(start));
  for(let frame=beat(start);frame<=beat(end);frame++) assert.deepEqual(camera(frame),held,`Camera drifted at frame ${frame}`);
}
let maxStep=0;
for(let frame=1;frame<1860;frame++) {
  const previous=camera(frame-1),current=camera(frame);
  for(const value of Object.values(current)) assert.ok(Number.isFinite(value));
  assert.ok(current.s>=1&&current.s<=1.58);
  maxStep=Math.max(maxStep,Math.hypot(current.x-previous.x,current.y-previous.y));
}
assert.ok(maxStep<30,`Abrupt camera translation: ${maxStep}px/frame`);
console.log(`PASS: stationary interaction holds; bounded zoom; largest translation ${maxStep.toFixed(2)}px/frame.`);
