'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../assistant-trip-profit'),Q=require('../assistant-record-query');
const date=new Date('2026-10-27T08:00:00Z');
function sample(){
 return{trucks:[{id:'a',fleetName:'ANG 10'},{id:'b',fleetName:'ANG 12'}],trips:[
  {id:'loss',number:'NBL-LOSS',truckId:'a',date:'2026-10-21',status:'Delivered',income:10000,dieselCost:7500,other:2000},
  {id:'fine',number:'NBL-FINE',truckId:'b',date:'2026-10-22',status:'Completed',income:10000,dieselCost:2000,other:1000},
  {id:'empty',number:'NBL-NOCOSTS',truckId:'a',date:'2026-10-23',status:'Closed',income:5000},
  {id:'open',number:'NBL-OPEN',truckId:'a',date:'2026-10-24',status:'In transit',income:7000,dieselCost:6000}
 ],diesel:[],expenses:[]};
}
test('intent recognises margin improvement without requiring word trip',()=>{
 for(const q of ['How can I improve profit margins?','Suggest ways of lifting fleet profit','Recommendations for trip profitability']){
  assert.equal(P.detects(q),true,q);assert.equal(Q.parse(q)?.mode,'trip_profit',q);assert.equal(P.wantsAdvice(q),true,q);
 }
 assert.equal(P.detects('Add a diesel expense to a trip'),false);
 assert.equal(P.detects('Delete low-profit trips'),false);
});
test('readable summary includes revenue, costs, margin, incomplete records and no unfinished trips',()=>{
 const r=Q.run(Q.parse('What trips have weak profit margins?'),'What trips have weak profit margins?',sample(),{role:'admin'},{now:date});
 assert.equal(r.source,'verified-trip-profit');
 for(const term of ['TRIP PROFITABILITY','SUMMARY','TRIPS','NEEDS REVIEW','Recorded costs:','Weighted margin:'])assert.match(r.answer,new RegExp(term));
 assert.match(r.answer,/NBL-NOCOSTS.*no positive costs/);
 assert.doesNotMatch(r.answer,/NBL-OPEN/);
 assert.doesNotMatch(r.answer,/HOW TO IMPROVE MARGINS/);
 assert.ok(r.profitSummary.income>0);
});
test('advice is grounded in costs and clear about hypothetical targets',()=>{
 const q='How can we improve trip profit margins in October 2026?';
 const r=Q.run(Q.parse(q),q,sample(),{role:'finance'},{now:date});
 assert.equal(r.source,'verified-trip-profit');assert.match(r.answer,/HOW TO IMPROVE MARGINS/);
 assert.match(r.answer,/NBL-LOSS/);
 assert.match(r.answer,/20% operating-margin target/);
 assert.match(r.answer,/Purchased litres alone do not prove fuel consumed/);
 assert.match(r.answer,/not an approved quote/);
 assert.ok(r.advice.length>=3);
 assert.deepEqual(r.figures.slice(0,2).map(x=>x.number),['NBL-LOSS','NBL-FINE']);
});
test('results respect scope and finance permissions',()=>{
 const q='Suggest ways to improve ANG 12 trip profit margins in October 2026';
 const r=Q.run(Q.parse(q),q,sample(),{role:'admin'},{now:date});
 assert.deepEqual(r.figures.map(x=>x.number),['NBL-FINE']);
 const blocked=Q.run(Q.parse(q),q,sample(),{role:'driver'},{now:date});
 assert.match(blocked.answer,/permission/);assert.equal(blocked.profitSummary,undefined);
});
test('incomplete records never generate fabricated savings suggestions',()=>{
 const q='How can we improve profit margins?';
 const s={trips:[{id:'bad',number:'BAD',date:'2026-10-20',status:'Delivered',income:0,dieselCost:0}]};
 const r=Q.run(Q.parse(q),q,s,{role:'finance'},{now:date});
 assert.equal(r.figures.length,0);assert.match(r.answer,/NEEDS REVIEW/);
 assert.doesNotMatch(r.answer,/20% operating-margin target/);
});
test('UI uses safe text rendering and mobile report cards',()=>{
 const fs=require('node:fs');
 const ui=fs.readFileSync(require.resolve('../public/ops-assistant.js'),'utf8');
 const css=fs.readFileSync(require.resolve('../public/styles.css'),'utf8');
 assert.match(ui,/function formatReply\(/);
 assert.match(ui,/textContent=line/);
 assert.doesNotMatch(ui,/innerHTML\s*=\s*message/);
 assert.match(css,/\.assistant-trip-result/);
 assert.match(css,/\.assistant-summary-metric/);
 assert.match(ui,/Improve profit margins/);
});
