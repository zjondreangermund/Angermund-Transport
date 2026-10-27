'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Q=require('../assistant-record-query'),P=require('../assistant-trip-profit');
const state=()=>({trucks:[{id:'a',fleetName:'ANG 10'},{id:'b',fleetName:'ANG 3'}],trips:[
{id:'low',number:'NBL-LOW',truckId:'a',date:'2026-10-07',status:'Delivered',income:10000,dieselCost:5000,tolls:100,allowance:1000,other:100},
{id:'high',number:'NBL-HIGH',truckId:'b',date:'2026-10-08',status:'Completed',income:10000,dieselCost:1000},
{id:'missing',number:'NBL-MISSING',truckId:'a',date:'2026-10-09',status:'Delivered',income:10000},
{id:'loss',number:'NBL-LOSS',truckId:'a',date:'2026-09-21',status:'Closed',income:1000,dieselCost:2000},
{id:'planned',number:'NBL-PLANNED',status:'Planned',date:'2026-10-27',income:1000,dieselCost:5000}],
 diesel:[{tripId:'low',litres:200,price:30,printedTotal:6000,verified:true}],expenses:[{tripId:'low',category:'Toll',amount:200},{tripId:'low',category:'Other',amount:2000}]});
const ask=(q,s=state(),role='admin')=>Q.run(Q.parse(q),q,s,{role},{now:new Date('2026-10-27T08:00:00Z')});
test('screenshot question routes to saved trips without requiring a truck or month',()=>{
 const r=ask('What trips have weak profit margin');assert.equal(r.source,'verified-trip-profit');assert.equal(r.figures[0].id,'loss');assert.equal(r.figures[1].id,'low');assert.match(r.answer,/NBL-MISSING.*no positive costs/);assert.doesNotMatch(r.answer,/NBL-PLANNED/);
});
test('linked fuel replaces cached diesel and toll expense replaces legacy toll',()=>{
 const s=state(),f=P.figures(s.trips[0],s);assert.equal(f.costs,9300);assert.equal(f.contribution,700);assert.ok(Math.abs(f.margin-7)<1e-9);
});
test('multi-leg pricing uses current leg rates rather than stale trip income',()=>{
 const f=P.figures({id:'x',income:999,legs:[{pricingMethod:'Per km',unitRate:10,distance:100},{pricingMethod:'Flat trip',unitRate:500}],dieselCost:1200},{});assert.equal(f.income,1500);assert.equal(f.margin,20);
});
test('date, truck, percentage and loss filters use saved data',()=>{
 const r=ask('Which trips have profit margins below 10% for ANG10 in October 2026?');assert.deepEqual(r.figures.map(x=>x.id),['low']);assert.match(r.answer,/2026-10-01 to 2026-10-31/);
 assert.deepEqual(ask('Which trips are losing money?').figures.map(x=>x.id),['loss']);
 assert.deepEqual(ask('Which trips have highest profit margins?').figures.map(x=>x.id),['high','low','loss']);
 assert.match(ask('Which ANG99 trips have weak profit margins?').answer,/No saved truck/);
});
test('ordinary phrasings are deterministic and cannot fall into truck-only comparison',()=>{
 for(const q of ['What trips have weak profit margin','Which loads are least profitable?','Analyse trip profit margins','Show low margin trips','Which trips made a loss?'])assert.equal(Q.parse(q).mode,'trip_profit',q);
 assert.equal(P.detects('Delete low profit trips'),false);
 const s=require('node:fs').readFileSync('assistant-jobs.js','utf8');assert.ok(s.indexOf("RecordQuery.parse(q)?.mode==='trip_profit'")<s.indexOf('res.json(B.profit'));
});
test('finance permission enforced and reports never mutate records',()=>{
 const s=state(),before=JSON.stringify(s);for(const role of ['driver','dispatcher','workshop']){const r=ask('What trips have weak profit margin',s,role);assert.match(r.answer,/permission/);assert.equal(r.figures,undefined)}
 ask('What trips have weak profit margin',s,'finance');assert.equal(JSON.stringify(s),before);
});
test('missing revenue and costs are not ranked as trustworthy profit',()=>{
 const s={trips:[{id:'x',number:'EMPTY',status:'Delivered',income:0,dieselCost:10}]};const r=ask('Which trips have weak profit margins?',s);assert.equal(r.figures.length,0);assert.match(r.answer,/EMPTY.*missing or zero income/);
});
