import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSource } from '../lib/ingest.ts';
import { parseCityRecord } from '../lib/cityrecord.ts';
import { normalize } from '../lib/notices.ts';

const row = {request_id:'20260910001',pin:'P1',agency_name:'Parks and Recreation',section_name:'Procurement',type_of_notice_description:'Solicitation',short_title:'Roof repair',start_date:'2026-09-16T00:00:00',due_date:'2026-11-01T14:00:00'};
// The fixtures follow CROL's server-rendered search and labelled detail responses.
const listing = (id:string,title:string,date='9/28/2026') => `<div class="notice-container"><h1><a href="/RequestDetail/${id}">${title}</a></h1><small>from <strong>Parks and Recreation</strong></small><i class="fa fa-tag"></i> Solicitation &nbsp;&nbsp;<i class="fa fa-calendar"></i> ${date}</small><p class="short-description">Notice</p></div>`;
const page = (list:string,total=1,current=1) => `${list}<script>pagination({items: ${total}, itemsOnPage: 10, currentPage: ${current}})</script>`;
const detail = (title:string,pin:string,date:string,due='11/1/2026 2:00 PM') => {
  const fields = {'Section':'Procurement','Agency Name':'Parks and Recreation (DPR)','Status':'Current','Category':'Construction','Selection Method':'Competitive Sealed Bids','Publication Date':date,'Notice Type':'Solicitation','PIN - Due Date':`<p>PIN#${pin} Due: <label>${due}</label></p>`};
  return `<span class="caption-subject bold">${title}</span>` + Object.entries(fields).map(([label,value])=>`<div class="form-control form-control-static">${value}</div><label>${label}</label>`).join('') + '<span class="caption-subject bold uppercase"> Description</span><div class="col-md-12"><p>Official description.</p></div>';
};

function sourceFixture(options:{brokenDetail?:boolean;cancel?:boolean;staleFallback?:boolean;duplicatePage?:boolean;extended?:boolean}={}) {
  const calls:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));calls.push(url.href);
    if(url.hostname==='data.cityofnewyork.us')return Response.json([{...row,due_date:options.extended?'2026-09-17T14:00:00':row.due_date}]);
    if(url.pathname==='/Search/Advanced'){
      const fields=new URLSearchParams(String(init?.body));
      assert.equal(init?.method,'POST');
      if(fields.get('SearchWithinCurrentAds')==='True'){
        assert.equal(fields.get('NoticeTypeId'),'1');assert.equal(fields.get('startDate'),'04/01/2026');
        return new Response(page(listing('20260910001','Roof repair','9/16/2026')));
      }
      assert.equal(fields.get('SearchWithinCurrentAds'),'False');assert.equal(fields.get('NoticeTypeId'),'0');assert.equal(fields.get('startDate'),'09/16/2026');
      const date=options.staleFallback?'9/16/2026':'9/28/2026';
      const title=options.cancel?'CANCELLED Roof repair':'New construction';
      if(options.duplicatePage){
        const current=Number(fields.get('PageNumber'));
        const list=Array.from({length:current===1?10:1},(_,i)=>listing('20260922'+String(i+1).padStart(3,'0'),title,date)).join('');
        return new Response(page(list,11,current));
      }
      return new Response(page(listing('20260922001',title,date)));
    }
    if(options.brokenDetail)return new Response('<html>temporarily unavailable</html>');
    if(url.pathname==='/RequestDetail/20260910001')return new Response(detail('Roof repair','P1','9/16/2026','10/1/2026 2:00 PM'));
    if(url.pathname==='/RequestDetail/20260922001')return new Response(detail(options.cancel?'CANCELLED Roof repair':'New construction',options.cancel?'P1':'P2',options.staleFallback?'9/16/2026':'9/28/2026'));
    throw new Error('Unexpected source request: '+url.href);
  };
  return {fetcher,calls};
}

test('stalled Open Data is supplemented by complete official history and open bids are rechecked',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-28T12:00:00Z')});
  const {fetcher,calls}=sourceFixture();
  const result=await fetchSource(fetcher);
  assert.equal(result.stale,false);assert.equal(result.sourceDate,'2026-09-28');
  assert.equal(result.rows,2);assert.equal(result.notices.length,2);
  assert.equal(result.notices.find(n=>n.pin==='P1')?.deadline,'2026-10-01T18:00:00.000Z');
  assert.ok(calls.some(url=>url.endsWith('/RequestDetail/20260910001')));
});
test('a newer official cancellation suppresses an old future deadline',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-28T12:00:00Z')});
  const result=await fetchSource(sourceFixture({cancel:true}).fetcher);
  assert.equal(result.stale,false);assert.equal(result.notices.length,0);
});
test('fallback refuses malformed details and incomplete or repeated pagination',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-28T12:00:00Z')});
  await assert.rejects(fetchSource(sourceFixture({brokenDetail:true}).fetcher));
  await assert.rejects(fetchSource(sourceFixture({duplicatePage:true}).fetcher));
});
test('a stale official fallback cannot mark old notices fresh',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-28T12:00:00Z')});
  assert.equal((await fetchSource(sourceFixture({staleFallback:true}).fetcher)).stale,true);
});
test('fresh Open Data keeps pagination and upstream failures fail closed',async()=>{
  let calls=0;
  const fresh={...row,start_date:new Date().toISOString().slice(0,10)+'T00:00:00',due_date:'2099-11-01T14:00:00'};
  const result=await fetchSource(async()=>Response.json(++calls===1?Array(1000).fill(fresh):[]));
  assert.equal(calls,2);assert.equal(result.stale,false);assert.equal(result.notices.length,1);
  await assert.rejects(fetchSource(async()=>new Response('Unavailable',{status:503})));
  await assert.rejects(fetchSource(async()=>Response.json({error:'invalid'})));
  await assert.rejects(fetchSource(async()=>Response.json([])));
});
test('multiple PINs retain their shared official deadline and ambiguous dates fail closed',()=>{
  const text=detail('Multiple sites','523131 Adams Houses','9/28/2026').replace('<p>PIN#523131 Adams Houses Due: <label>11/1/2026 2:00 PM</label></p>','<p>PIN#523131 Adams Houses</p><p>PIN#523132 Melrose Houses</p><label>Due: 11/1/2026 2:00 PM</label>');
  const parsed=parseCityRecord(text,row);
  assert.equal(parsed.pin,'523131 Adams Houses; 523132 Melrose Houses');
  assert.equal(parsed.due_date,'2026-11-01T14:00:00');
  assert.throws(()=>parseCityRecord(text.replace('PIN#523132','Due: 10/1/2026 2:00 PM PIN#523132'),row));
});
test('archived or withdrawn official details cannot preserve an old future solicitation',()=>{
  for(const status of ['Archived','Cancelled','Withdrawn']){
    const text=detail('Roof repair','P1','9/16/2026').replace('>Current<','>'+status+'<');
    assert.equal(normalize([parseCityRecord(text,row)],Date.parse('2026-09-28')).length,0);
  }
  assert.throws(()=>parseCityRecord(detail('Roof repair','P1','9/16/2026').replace('>Status<','>Missing status<'),row));
});
test('official publication ranges preserve their first publication date',()=>{
  const parsed=parseCityRecord(detail('Roof repair','P1','8/27/2026 - 8/28/2026'),row);
  assert.equal(parsed.start_date,'2026-08-27T00:00:00');
});
test('current official search recovers extensions whose old feed deadlines have expired',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-09-28T12:00:00Z')});
  const result=await fetchSource(sourceFixture({extended:true}).fetcher);
  assert.equal(result.notices.find(n=>n.pin==='P1')?.deadline,'2026-10-01T18:00:00.000Z');
});
