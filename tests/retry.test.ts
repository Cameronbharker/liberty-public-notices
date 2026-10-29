import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrying } from '../lib/ingest.ts';

const scripted=(steps:(number|'reset')[])=>{
  let calls=0;
  const fetcher:typeof fetch=async()=>{
    const step=steps[Math.min(calls++,steps.length-1)];
    if(step==='reset')throw new TypeError('fetch failed');
    return new Response(String(step),{status:step});
  };
  return {fetcher,calls:()=>calls};
};

test('transient upstream failures are retried until the source answers', async()=>{
  const source=scripted(['reset',503,200]);
  const response=await retrying(source.fetcher,[0,0])('https://example.test');
  assert.equal(response.status,200);
  assert.equal(source.calls(),3);
});

test('a persistent outage still fails after the last attempt', async()=>{
  const source=scripted([503]);
  assert.equal((await retrying(source.fetcher,[0,0])('https://example.test')).status,503);
  assert.equal(source.calls(),3);
  const reset=scripted(['reset']);
  await assert.rejects(retrying(reset.fetcher,[0,0])('https://example.test'));
  assert.equal(reset.calls(),3);
});

test('client errors are not retried', async()=>{
  const source=scripted([404,200]);
  assert.equal((await retrying(source.fetcher,[0,0])('https://example.test')).status,404);
  assert.equal(source.calls(),1);
});
