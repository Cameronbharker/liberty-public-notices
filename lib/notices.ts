export interface Notice {
  region?:'NYC'|'NJ'; source?:string; dateLabel?:string; id:string; pin:string; title:string; agency:string; description:string; published:string;
  deadline:string; deadlineLocal:string; method:string; category:string; trades:string[]; url:string;
}
export interface Filters { trade:string; query:string; agency:string; region?:string }
const NY_FORMAT=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export const TRADES:Record<string,RegExp> = {
  'Construction': /\b(construction|roof|sidewalk|renovation|masonry|seawall|concrete|paving|building repair)\b/i,
  'Cleaning': /\b(cleaning|janitorial|custodial|sanitation|window washing)\b/i,
  'Landscaping': /\b(landscap\w*|tree|trees|horticultur\w*|grounds|mowing)\b/i,
  'Mechanical & electrical': /\b(hvac|electrical|plumbing|boiler|steam|elevator|fire alarm|mechanical)\b/i,
  'Professional services': /\b(consult\w*|strategic|design services|appraisal|audit|architect\w*|engineering)\b/i,
  'Technology': /\b(software|cybersecurity|information technology|web design|website|computer|telecommunication\w*)\b/i,
  'Supplies': /\b(supplies|supply|furnish|furniture|purchase|equipment|printed|vehicles)\b/i,
};
export function plain(value:unknown):string {
  if(typeof value!=='string') return '';
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ')
    .replace(/&(?:amp|nbsp|quot|apos|lt|gt);/g,x=>({'&amp;':'&','&nbsp;':' ','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[x]||x))
    .replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'')
    .replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[\u2013\u2014]/g,'-').replace(/\s+/g,' ').trim();
}
export function nyTimestamp(value:string):string {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return '';
  const target=Date.parse(value.slice(0,19)+'Z');
  if(!Number.isFinite(target)) return '';
  if(new Date(target).toISOString().slice(0,19)!==value.slice(0,19)) return '';
  let guess=target;
  for(let i=0;i<2;i++) {
    const parts=NY_FORMAT.format(new Date(guess));
    guess+=target-Date.parse(parts.replace(' ','T')+'Z');
  }
  return new Date(guess).toISOString();
}
export function normalize(rows:unknown[],now=Date.now()):Notice[] {
  const latest=new Map<string,Record<string,unknown>>();
  const nowLocal=NY_FORMAT.format(new Date(now)).replace(' ','T');
  for(const raw of rows) {
    if(!raw||typeof raw!=='object') continue;
    const r=raw as Record<string,unknown>;
    if(r.section_name!=='Procurement'||!r.request_id||!r.short_title) continue;
    const key=plain(r.agency_name)+'|'+plain(r.pin||r.request_id);
    const old=latest.get(key);
    if(!old||String(r.start_date)+String(r.request_id)>String(old.start_date)+String(old.request_id)) latest.set(key,r);
  }
  return [...latest.values()].flatMap(r=>{
    const title=plain(r.short_title);
    if(r.type_of_notice_description!=='Solicitation'||/\b(cancelled|canceled|cancellation|withdrawn)\b/i.test(title)||plain(r.due_date).slice(0,19)<=nowLocal) return [];
    const deadline=nyTimestamp(plain(r.due_date));
    if(!deadline||Date.parse(deadline)<=now) return [];
    const description=plain([r.additional_description_1,r.additional_description_2,r.other_info_1].filter(Boolean).join(' '));
    const tradeText=(title+' '+plain(r.category_description)).replace(/_/g,' ');
    const trades=Object.entries(TRADES).filter(([,p])=>p.test(tradeText)).map(([t])=>t);
    return [{region:'NYC' as const,source:'NYC City Record',dateLabel:'Bid deadline',id:plain(r.request_id),pin:plain(r.pin),title,agency:plain(r.agency_name),description,
      published:plain(r.start_date).slice(0,10),deadline,deadlineLocal:plain(r.due_date).slice(0,19),
      method:plain(r.selection_method_description),category:plain(r.category_description),trades:trades.length?trades:['Other'],
      url:'https://a856-cityrecord.nyc.gov/RequestDetail/'+encodeURIComponent(plain(r.request_id))}];
  }).sort((a,b)=>a.deadline.localeCompare(b.deadline)||a.id.localeCompare(b.id));
}
export function selectNotices(notices:Notice[],f:Filters):Notice[] {
  const words=f.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return notices.filter(n=>(!f.region||(n.region||'NYC')===f.region)&&(!f.trade||n.trades.includes(f.trade))&&(!f.agency||n.agency===f.agency)&&words.every(w=>(n.title+' '+n.description+' '+n.pin).toLowerCase().includes(w)));
}
export function csv(notices:Notice[]):string {
  const cell=(v:string)=>'"'+(/^[\s]*[=+@-]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';
  return [['Title','Location','Agency','PIN','Date type','Date (Eastern time)','Method','Official notice'],...notices.map(n=>[n.title,n.region||'NYC',n.agency,n.pin,n.dateLabel||'Bid deadline',n.deadlineLocal,n.method,n.url])].map(r=>r.map(cell).join(',')).join('\r\n');
}
function icalText(s:string):string {return s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
export function calendar(notices:Notice[]):string {
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Liberty//NYC and NJ//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for(const n of notices) lines.push('BEGIN:VEVENT',`UID:${n.id}@Liberty`,`DTSTAMP:${stamp}`,
    `DTSTART:${n.deadline.replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`SUMMARY:${icalText((n.dateLabel||'Bid deadline')+': '+n.title)}`,
    `DESCRIPTION:${icalText(n.agency+' | PIN '+n.pin+' | Verify deadlines and amendments with the issuing agency. '+n.url)}`,`URL:${n.url}`,'END:VEVENT');
  lines.push('END:VCALENDAR');
  // Fold by UTF-8 bytes per RFC 5545, preserving multibyte characters.
  return lines.map(line=>{let out='',part='';for(const c of line){if(new TextEncoder().encode(part+c).length>73){out+=part+'\r\n ';part='';}part+=c;}return out+part;}).join('\r\n')+'\r\n';
}
