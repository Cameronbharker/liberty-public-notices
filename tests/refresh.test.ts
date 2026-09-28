import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for(const mode of ['fresh','stale','failed'])test(`refresh ${mode}: publishes only a complete fresh result`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'liberty-refresh-test-'));
  try{
    for(const dir of ['scripts','lib','data'])await mkdir(join(root,dir));
    await writeFile(join(root,'package.json'),'{"type":"module"}');
    await copyFile(new URL('../scripts/refresh.ts',import.meta.url),join(root,'scripts/refresh.ts'));
    const previous='{"previous":"preserve these exact bytes"}\n';
    await writeFile(join(root,'data/snapshot.json'),previous);
    const result={notices:[],rows:0,sourceDate:'2026-09-28',fetchedAt:'2026-09-28T12:00:00Z',stale:mode==='stale'};
    // Stub the immediate fetchAllSources boundary. Exercise the actual CLI and file writes.
    const body=mode==='failed'?"throw new Error('Upstream unavailable');":'return '+JSON.stringify(result)+';';
    await writeFile(join(root,'lib/ingest.ts'),'export async function fetchAllSources(){'+body+'}\n');
    const run=spawnSync(process.execPath,['--experimental-strip-types',join(root,'scripts/refresh.ts')],{encoding:'utf8',cwd:tmpdir()});
    assert.equal(run.status,mode==='fresh'?0:1,run.stderr);
    const saved=await readFile(join(root,'data/snapshot.json'),'utf8');
    if(mode==='fresh')assert.deepEqual(JSON.parse(saved),result);
    else assert.equal(saved,previous);
    assert.deepEqual(await readdir(join(root,'data')),['snapshot.json']);
  }finally{await rm(root,{recursive:true,force:true});}
});
