import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {beat} from '../../remotion/camera.ts';
import {illustrationAt} from '../../remotion/rebalance-scene.tsx';
const baseline=JSON.parse(readFileSync('remotion/analysis/original-motion-baseline.json','utf8'));
const source=ts.createSourceFile('film.tsx',readFileSync('remotion/index.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const sha=s=>createHash('sha256').update(s).digest('hex');
for(const [name,expected] of Object.entries(baseline.functions)) {
 const node=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node,`Missing original ${name}`);
 assert.equal(sha(node.getText(source)),expected,`Changed original ${name} choreography`);
}
let audio;function visit(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(source)==='Audio')audio=n.getText(source);if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(source)==='Audio')audio=n.getText(source);ts.forEachChild(n,visit);}visit(source);
assert.equal(sha(audio),baseline.audioJsxSha256,'Original music source/gain/fades changed');
assert.equal(sha(readFileSync('remotion/music.ts')),baseline.musicTimingSha256,'Original analyzed beat grid changed');
const initial=illustrationAt(beat(59)),drift=illustrationAt(beat(65)),final=illustrationAt(beat(75));
assert.deepEqual(initial.rows.map(r=>r.actualPct),[40,20,40]);
assert.ok(Math.abs(drift.total-1040)<1e-8);
assert.deepEqual(drift.rows.map(r=>Math.round(r.deltaValue)),[-64,48,16]);
assert.equal(final.restored,1);
assert.deepEqual(final.rows.map(r=>r.actualPct*(1-final.restored)+r.targetPct*final.restored),[40,20,40]);
for(let f=beat(56);f<=beat(81);f++){const m=illustrationAt(f);assert.ok(Number.isFinite(m.total));assert.ok(Math.abs(m.rows.reduce((s,r)=>s+r.actualPct*(1-m.restored)+r.targetPct*m.restored,0)-100)<1e-8);}
console.log(`PASS: ${Object.keys(baseline.functions).length} original motion functions, uploaded-music JSX and beat analysis unchanged; value-based rebalance maintains 100% and restores 40/20/40.`);
