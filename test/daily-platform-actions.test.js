const test=require('node:test'),assert=require('node:assert/strict'),D=require('../daily-platform-actions');
const now=Date.parse('2026-10-23T12:00:00Z');
test('one daily group contains every affected trip and remains one on repeated checks',()=>{
 const state={trips:[{id:'a',number:'A',date:'2026-10-23',stage:4},{id:'b',number:'B',date:'2026-10-23',stage:4}]};
 let rows=D.reconcile(state,now);assert.equal(rows.find(x=>x.key==='missing-pod').items.length,2);const id=rows.find(x=>x.key==='missing-pod').id;
 rows=D.reconcile(state,now+1000);assert.equal(rows.filter(x=>x.key==='missing-pod').length,1);assert.equal(rows.find(x=>x.key==='missing-pod').id,id);
 state.trips[0].pod=true;rows=D.reconcile(state,now+2000);assert.equal(rows.find(x=>x.key==='missing-pod').items.filter(x=>x.completed).length,1);
 state.trips[1].pod=true;rows=D.reconcile(state,now+3000);assert.equal(rows.find(x=>x.key==='missing-pod').status,'Completed');
});
test('unresolved groups get exactly one new day identity at Windhoek midnight',()=>{
 const state={permits:[{id:'p',type:'Vehicle licence',expiry:'2026-10-01'}]};
 const a=D.reconcile(state,Date.parse('2026-10-23T21:59:00Z')).find(x=>x.key==='document-renewal');
 const b=D.reconcile(state,Date.parse('2026-10-23T22:01:00Z')).find(x=>x.key==='document-renewal');
 assert.notEqual(a.id,b.id);assert.equal(b.date,'2026-10-24');assert.equal(D.reconcile(state,Date.parse('2026-10-23T22:02:00Z')).filter(x=>x.key==='document-renewal').length,1);
});
test('a resolved condition returning today reuses the same notification identity',()=>{
 const state={permits:[{id:'p',expiry:'2026-10-01'}]};let a=D.reconcile(state,now).find(x=>x.key==='document-renewal');
 state.permits[0].expiry='2028-01-01';assert.equal(D.reconcile(state,now)[0].status,'Completed');
 state.permits[0].expiry='2026-10-01';assert.equal(D.reconcile(state,now)[0].id,a.id);
});
test('role scope and historical/cancelled trip exclusions',()=>{
 const state={trips:[{id:'old',date:'2026-09-01'},{id:'cancelled',date:'2026-10-23',status:'Cancelled'}]};
 assert.equal(D.collect(state,now).length,0);assert.equal(D.allowed({roles:['finance']},'dispatcher'),false);assert.equal(D.allowed({roles:['finance']},'admin'),true);
});
test('no missing POD or diesel tasks for a planned trip; shunters need no trip diesel',()=>{
 const rows=D.collect({trips:[{id:'p',stage:1},{id:'s',stage:4,shunter:true,pod:true}]},now);
 assert.equal(rows.some(x=>x.key==='missing-pod'),false);assert.equal(rows.some(x=>x.key==='trip-diesel'),false);
});
