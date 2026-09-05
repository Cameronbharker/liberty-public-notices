import { fetchNewJersey } from './newjersey.ts';
import { normalize } from './notices.ts';
import type { Brief } from './brief.ts';
export async function fetchSource(fetcher:typeof fetch=fetch):Promise<Brief> {
  const since=new Date(Date.now()-180*86400000).toISOString().slice(0,10);
  const rows:unknown[]=[];
  for(let offset=0;offset<10000;offset+=1000) {
    const url=new URL('https://data.cityofnewyork.us/resource/dg92-zbpx.json');
    url.searchParams.set('$where',`section_name='Procurement' AND start_date >= '${since}T00:00:00'`);
    url.searchParams.set('$order','start_date DESC,request_id DESC');
    url.searchParams.set('$limit','1000');url.searchParams.set('$offset',String(offset));
    const response=await fetcher(url,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    if(!response.ok) throw new Error('The city data feed is temporarily unavailable.');
    const batch:unknown=await response.json();
    if(!Array.isArray(batch)) throw new Error('Unexpected source format.');
    rows.push(...batch);
    if(batch.length<1000) {
      const sourceDate=String((rows[0] as Record<string,unknown>)?.start_date||'').slice(0,10);
      if(!rows.length||!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) throw new Error('Source has no dated records.');
      return {notices:normalize(rows),fetchedAt:new Date().toISOString(),sourceDate,stale:Date.now()-Date.parse(sourceDate)>7*86400000,rows:rows.length};
    }
  }
  throw new Error('Source exceeded the safety limit. Coverage must be reviewed.');
}
export async function fetchAllSources():Promise<Brief> {
  const [nyc,nj]=await Promise.all([fetchSource(),fetchNewJersey()]);
  return {notices:[...nyc.notices,...nj.notices].sort((a,b)=>a.deadline.localeCompare(b.deadline)),rows:nyc.rows+nj.rows,fetchedAt:new Date().toISOString(),sourceDate:nyc.sourceDate,stale:nyc.stale||nj.stale};
}
