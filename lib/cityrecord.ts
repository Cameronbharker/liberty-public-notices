import { normalize, plain, nyTimestamp } from './notices.ts';

const ORIGIN='https://a856-cityrecord.nyc.gov';
type SourceRow=Record<string,unknown>;

function date(value:string):string {
  const m=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s+(AM|PM))?$/i);
  if(!m)return '';
  if(m[4]&&(Number(m[4])<1||Number(m[4])>12))return '';
  const hour=m[4]?Number(m[4])%12+(m[6].toUpperCase()==='PM'?12:0):0;
  const result=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}T${String(hour).padStart(2,'0')}:${m[5]||'00'}:00`;
  return nyTimestamp(result)?result:'';
}

async function html(fetcher:typeof fetch,path:string,body?:URLSearchParams):Promise<string> {
  const response=await fetcher(ORIGIN+path,{method:body?'POST':'GET',body:body?.toString(),
    headers:{Accept:'text/html','User-Agent':'Liberty procurement briefing',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`City Record unavailable (HTTP ${response.status}).`);
  const text=await response.text();
  if(text.length>5000000)throw new Error('City Record response exceeds size limit.');
  return text;
}

function searchPage(text:string,page:number):{rows:SourceRow[];total:number} {
  const total=Number(text.match(/\bitems:\s*(\d+)/)?.[1]);
  const size=Number(text.match(/\bitemsOnPage:\s*(\d+)/)?.[1]);
  const current=Number(text.match(/\bcurrentPage:\s*(\d+)/)?.[1]);
  if(!Number.isInteger(total)||total<1||total>10000||size!==10||current!==page)throw new Error('City Record pagination changed.');
  const rows=text.split('<div class="notice-container">').slice(1).map(block=>{
    const id=block.match(/href="\/RequestDetail\/(\d+)"/)?.[1];
    const agency=plain(block.match(/from\s*<strong>([\s\S]*?)<\/strong>/)?.[1]);
    const published=date(plain(block.match(/fa-calendar"><\/i>\s*([^<]+)/)?.[1]));
    if(!id||!agency||!published)throw new Error('City Record search format changed.');
    return {request_id:id,agency_name:agency,start_date:published};
  });
  if(rows.length!==Math.min(10,total-(page-1)*10))throw new Error('City Record search coverage is incomplete.');
  return {rows,total};
}

export function parseCityRecord(text:string,reference:SourceRow):SourceRow {
  const fields=new Map([...text.matchAll(/<div class="form-control form-control-static">([\s\S]*?)<\/div>\s*<label\b[^>]*>([\s\S]*?)<\/label>/g)].map(m=>[plain(m[2]),plain(m[1])]));
  const title=plain(text.match(/<span class="caption-subject bold">([\s\S]*?)<\/span>/)?.[1]);
  const publication=(fields.get('Publication Date')||'').split(/\s+-\s+/).map(date);
  const published=publication.length<=2&&publication.every(Boolean)?publication[0]:'';
  const type=fields.get('Notice Type');
  if(!title||!published||!type||fields.get('Section')!=='Procurement'||!fields.get('Agency Name'))throw new Error('City Record detail format changed for '+reference.request_id+'.');
  const pinField=fields.get('PIN - Due Date')||fields.get('PIN')||'';
  const parts=pinField.split(/\s+Due:\s*/);
  if(parts.length>2)throw new Error('Multiple City Record deadlines require review for '+reference.request_id+'.');
  const pin=parts[0].split('PIN#').map(value=>value.trim()).filter(Boolean).join('; '),due=parts[1];
  const deadline=due?date(due):'';
  if(due&&!deadline)throw new Error('Invalid City Record deadline for '+reference.request_id+'.');
  const status=fields.get('Status');
  if(status&&!['Current','Archived','Cancelled','Canceled','Withdrawn'].includes(status))throw new Error('Unknown City Record status: '+status);
  if(type==='Solicitation'&&!status)throw new Error('Missing City Record solicitation status.');
  const description=plain(text.match(/caption-subject bold uppercase">\s*Description<\/span>[\s\S]*?<div class="col-md-12">([\s\S]*?)<\/div>/)?.[1]);
  return {...reference,section_name:'Procurement',short_title:title,start_date:published,pin,due_date:deadline,
    type_of_notice_description:status&&status!=='Current'?'Cancellation':type,
    category_description:fields.get('Category')||'',selection_method_description:fields.get('Selection Method')||'',
    additional_description_1:description,additional_description_2:'',other_info_1:''};
}

async function search(fetcher:typeof fetch,start:string,end:string,current:boolean):Promise<Map<string,SourceRow>> {
  const usDate=(value:string)=>value.slice(5,7)+'/'+value.slice(8,10)+'/'+value.slice(0,4);
  const found=new Map<string,SourceRow>();let total:number|undefined;
  for(let page=1;page<=1000;page++){
    const body=new URLSearchParams({SectionId:'6',SectionName:'Procurement',NoticeTypeId:current?'1':'0',OrderBy:'Newest',
      SearchWithinCurrentAds:current?'True':'False',startDate:usDate(start),endDate:usDate(end),PageNumber:String(page)});
    const result=searchPage(await html(fetcher,'/Search/Advanced',body),page);
    if(total!==undefined&&total!==result.total)throw new Error('City Record changed during pagination; retry refresh.');
    total=result.total;
    for(const row of result.rows){
      const id=String(row.request_id),published=String(row.start_date).slice(0,10);
      if(found.has(id)||published<start||published>end)throw new Error('City Record search coverage could not be confirmed.');
      found.set(id,row);
    }
    if(found.size===total)break;
  }
  if(found.size!==total)throw new Error('City Record search exceeded its safety limit.');
  return found;
}

export async function supplementCityRecord(rows:unknown[],sourceDate:string,fetcher:typeof fetch):Promise<unknown[]> {
  const end=new Date().toISOString().slice(0,10),since=new Date(Date.now()-180*86400000).toISOString().slice(0,10);
  // History preserves cancellations and awards. Current search also discovers extensions
  // made in place after an old feed deadline passed, without a new publication date.
  const found=await search(fetcher,sourceDate,end,false);
  const current=await search(fetcher,since,end,true);
  for(const [id,row] of current)if(!found.has(id))found.set(id,row);
  const candidates=new Set(normalize(rows).map(n=>n.id));
  for(const raw of rows){
    const row=raw as SourceRow;
    if(row&&candidates.has(String(row.request_id))&&!found.has(String(row.request_id)))found.set(String(row.request_id),row);
  }
  const references=[...found.values()],updated:SourceRow[]=[];
  // Bound requests to four at a time; one failed or malformed detail aborts publication.
  for(let offset=0;offset<references.length;offset+=4){
    updated.push(...await Promise.all(references.slice(offset,offset+4).map(async row=>parseCityRecord(await html(fetcher,'/RequestDetail/'+row.request_id),row))));
  }
  return [...rows.filter(raw=>!found.has(String((raw as SourceRow)?.request_id))),...updated];
}
