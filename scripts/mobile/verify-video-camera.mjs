import assert from 'node:assert/strict';
import {camera,beat} from '../../remotion/camera.ts';
for (const [start,end] of [[20,32],[56,81],[83,89]]) {
  const held=camera(beat(start));
  for(let frame=beat(start);frame<=beat(end);frame++) assert.deepEqual(camera(frame),held,`Camera drift at ${frame}`);
}
let maxStep=0;
for(let frame=1;frame<1860;frame++) {
  const previous=camera(frame-1),current=camera(frame);
  for(const value of Object.values(current)) assert.ok(Number.isFinite(value));
  assert.ok(current.s>=.9&&current.s<=1.58);
  maxStep=Math.max(maxStep,Math.hypot(current.x-previous.x,current.y-previous.y));
}
assert.ok(maxStep<45,`Abrupt translation ${maxStep}`);
console.log(`PASS: original motion with stationary slider/rebalance/system holds; max step ${maxStep.toFixed(2)}px/frame.`);
