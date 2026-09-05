import { plain,nyTimestamp,TRADES,type Notice } from './notices.ts';
export const NJ_SOURCE='https://www.njstart.gov/bso/view/search/external/advancedSearchBid.xhtml?openBids=true';
export function parseCsv(input:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  const text=input.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('Incomplete NJSTART export.');
  row.push(cell);if(row.some(Boolean))rows.push(row);return rows;
}
export function njDate(value:string):string {
  const m=value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM)$/i);
  if(!m||Number(m[4])<1||Number(m[4])>12)return '';
  const hour=Number(m[4])%12+(m[7].toUpperCase()==='PM'?12:0);
  return `${m[3]}-${m[1]}-${m[2]}T${String(hour).padStart(2,'0')}:${m[5]}:${m[6]||'00'}`;
}
export function normalizeNj(text:string,expected:number,now=Date.now()):Notice[]{
  const rows=parseCsv(text),header=rows.shift()||[];
  const names=['Bid Solicitation #','Organization Name','Description','Bid Opening Date','Status'];
  if(names.some(n=>!header.includes(n))||rows.length!==expected)throw new Error('NJSTART coverage could not be confirmed.');
  const seen=new Set<string>();const notices:Notice[]=[];
  for(const row of rows){
    const get=(name:string)=>plain(row[header.indexOf(name)]);
    const pin=get(names[0]),title=get('Description'),deadlineLocal=njDate(get('Bid Opening Date'));
    if(!/^[A-Za-z0-9-]+$/.test(pin)||seen.has(pin))throw new Error('Invalid or duplicate NJSTART bid.');
    seen.add(pin);const deadline=nyTimestamp(deadlineLocal);
    if(get('Status')!=='Sent'||/\b(cancelled|canceled|withdrawn)\b/i.test(title)||!deadline||Date.parse(deadline)<=now)continue;
    const trades=Object.entries(TRADES).filter(([,re])=>re.test(title.replace(/_/g,' '))).map(([name])=>name);
    notices.push({id:'nj-'+pin,pin,title,agency:'NJ '+get('Organization Name'),region:'NJ',source:'NJSTART',dateLabel:'Bid opening',description:'Review the official NJSTART solicitation and attachments for scope, qualifications, submission instructions, and amendments. The date shown is the published bid opening time; confirm the response deadline in the original documents.',published:'',deadline,deadlineLocal,method:'State bid solicitation',category:'',trades:trades.length?trades:['Other'],url:'https://www.njstart.gov/bso/external/bidDetail.sda?docId='+encodeURIComponent(pin)+'&external=true&parentUrl=close'});
  }
  return notices;
}
export async function fetchNewJersey(fetcher:typeof fetch=fetch){
  const response=await fetcher(NJ_SOURCE,{headers:{Accept:'text/html','User-Agent':'Liberty procurement briefing'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('NJSTART is unavailable (HTTP '+response.status+').');
  const html=await response.text();
  const form=html.match(/<form\b[^>]*id="bidSearchResultsForm"[^>]*>([\s\S]*?)<\/form>/i)?.[1];
  const exportName=html.match(/title="Export to CSV File"[^>]+\{'([^']+)'/)?.[1];
  const total=Number(html.match(/ui-paginator-current[^>]*>\s*\d+-\d+ of (\d+)/)?.[1]);
  if(!form||!exportName||!Number.isInteger(total)||total<1||total>1000)throw new Error('NJSTART page changed.');
  const fields=new URLSearchParams();
  for(const input of form.matchAll(/<input\b[^>]*>/gi)){
    const name=input[0].match(/\bname="([^"]+)"/)?.[1];const value=input[0].match(/\bvalue="([^"]*)"/)?.[1]||'';
    if(name)fields.set(plain(name),plain(value));
  }
  if(!fields.has('javax.faces.ViewState'))throw new Error('NJSTART export session unavailable.');
  fields.set(exportName,exportName);
  const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const csvResponse=await fetcher(NJ_SOURCE,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Liberty procurement briefing',Cookie:cookies},body:fields.toString(),signal:AbortSignal.timeout(20000)});
  if(!csvResponse.ok||!csvResponse.headers.get('content-type')?.includes('text/csv'))throw new Error('NJSTART export unavailable.');
  const notices=normalizeNj(await csvResponse.text(),total);
  return {notices,rows:total,fetchedAt:new Date().toISOString(),sourceDate:new Date().toISOString().slice(0,10),stale:false};
}
