import { writeFile, rename } from 'node:fs/promises';
import { fetchAllSources } from '../lib/ingest.ts';
const result=await fetchAllSources();
if(result.stale)throw new Error('Sources are stale; preserving last successful briefing.');
await writeFile(new URL('../data/snapshot.next.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
await rename(new URL('../data/snapshot.next.json',import.meta.url),new URL('../data/snapshot.json',import.meta.url));
process.stdout.write(JSON.stringify({rows:result.rows,open:result.notices.length,fetchedAt:result.fetchedAt,sourceDate:result.sourceDate})+'\n');
