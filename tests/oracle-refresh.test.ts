import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchSignedUpdates} from '../src/keeper/refreshOracles.js';
test('Hermes fetch asks for bounded signed payloads for exactly the admitted feeds',async()=>{
  const fake=async(input:unknown)=>{const url=new URL(String(input));assert.equal(url.origin,'https://hermes.pyth.network');assert.equal(url.searchParams.getAll('ids[]').length,2);assert.equal(url.searchParams.get('encoding'),'base64');return new Response(JSON.stringify({binary:{encoding:'base64',data:['UE5BVQ==']}}),{status:200});};
  assert.deepEqual(await fetchSignedUpdates(fake as typeof fetch),['UE5BVQ==']);
});
test('parsed HTTP prices, oversized payloads, bad encodings and endpoint errors cannot substitute for signed updates',async()=>{
  for(const data of [{parsed:[{price:150}]},{binary:{encoding:'hex',data:['abcdef']}},{binary:{encoding:'base64',data:['A'.repeat(65537)]}},{binary:{encoding:'base64',data:[]}}])await assert.rejects(()=>fetchSignedUpdates((async()=>new Response(JSON.stringify(data))) as typeof fetch));
  await assert.rejects(()=>fetchSignedUpdates((async()=>new Response('',{status:503})) as typeof fetch),/HTTP 503/);
});
