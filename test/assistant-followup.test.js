'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Followup=require('../assistant-followup'),Audit=require('../assistant-ops-audit');
const state=()=>({
 trucks:[{id:'trk_ang10',fleetName:'ANG 10'},{id:'trk_ang4',fleetName:'ANG 4'}],
 drivers:[{id:'drv',name:'Anton'}],
 employees:[{id:'emp',name:'Anton',driverId:'drv'}],
 payProfiles:[],
 trips:[{id:'t1',number:'AT-102',truckId:'trk_ang10',driverId:'drv',date:'2026-10-21',status:'Delivered',stage:4,pod:true,startKm:1000,endKm:1600},
 {id:'t2',number:'AT-104',truckId:'trk_ang10',driverId:'drv',date:'2026-10-24',status:'Delivered',stage:4,pod:false,startKm:1800},
 {id:'t3',number:'AT-999',truckId:'trk_ang4',driverId:'drv',date:'2026-10-25',status:'Planned',stage:1,pod:false}],
 diesel:[],invoices:[],payroll:[],tasks:[]
});
test('the screenshot first question asks which truck rather than guessing dates',()=>{
 const q='Can you check ang last trip. What is needed';
 assert.equal(Audit.isAuditRequest(q),true);
 const answer=Audit.run(q,state(),{role:'manager'});
 assert.match(answer.answer,/Which ANG truck/);
 assert.equal(answer.targets,undefined);
});
test('ANG10 answer to saved last trip question looks up latest saved truck trip',()=>{
 const session={turns:[{role:'user',content:'Can you check ang last trip. What is needed'},
   {role:'assistant',content:'Which ANG truck?'}]};
 const q=Followup.resolve('ANG10',session,[]);
 assert.match(q,/Investigate ANG 10 latest trip/);
 assert.equal(Audit.isAuditRequest(q),true);
 const report=Audit.run(q,state(),{role:'manager'});
 assert.equal(report.targets[0].number,'AT-104');
 assert.ok(report.issues.some(x=>x.code==='DISTANCE_MISSING'));
 assert.ok(report.issues.some(x=>x.code==='POD_MISSING'));
 assert.ok(report.records.some(x=>x.id==='t2'));
});
test('works with client chat history if server session is unavailable',()=>{
 const history=[{role:'user',content:'Can you check ang last trip. What is needed'},
  {role:'assistant',content:'Please specify which truck.'}];
 assert.match(Followup.resolve('ANG 10',null,history),/Investigate ANG 10/);
});
test('direct latest trip in ordinary language resolves without a date or payroll month',()=>{
 const report=Audit.run('Can you check ANG10 last trip and tell me what is needed?',state(),{role:'manager'});
 assert.equal(report.targets[0].number,'AT-104');
 assert.equal(Audit.isAuditRequest('What is the latest trip for ANG10?'),true);
});
test('repeating ANG10 after the existing unhelpful bot reply still resolves original question',()=>{
 const session={turns:[
  {role:'user',content:'Can you check ang last trip. What is needed'},
  {role:'assistant',content:'Please send the trip number or truck.'},
  {role:'user',content:'ANG10'},
  {role:'assistant',content:'I cannot identify the last trip; send approximate date.'}
 ]};
 const q=Followup.resolve('ANG10',session,[]);
 assert.match(q,/Investigate ANG 10 latest trip/);
 assert.equal(Audit.run(q,state(),{role:'manager'}).targets[0].number,'AT-104');
});
test('no false context carryover after unrelated user message',()=>{
 const session={turns:[{role:'user',content:'Can you check ang last trip. What is needed'},
 {role:'assistant',content:'Which ANG truck?'},
 {role:'user',content:'Show me payments'},{role:'assistant',content:'Go to invoices'}]};
 assert.equal(Followup.resolve('ANG10',session,[]),'ANG10');
 assert.equal(Followup.resolve('ANG10',null,[]),'ANG10');
 assert.equal(Audit.isAuditRequest('Create invoice for last trip'),false);
});
test('last actual trip is not replaced by a future planned dispatch',()=>{
 const s=state();s.trips.push({id:'future',number:'AT-FUTURE',truckId:'trk_ang10',date:'2026-10-30',status:'Planned',stage:1,pod:false});
 const r=Audit.run('Can you check ANG10 last trip?',s,{role:'manager'});
 assert.equal(r.targets[0].number,'AT-104');
 assert.equal(Audit.run('Investigate ANG10 latest planned trip',s,{role:'manager'}).targets[0].number,'AT-FUTURE');
});
test('no guessing when latest date is shared by multiple trips',()=>{
 const s=state();s.trips.push({...s.trips[1],id:'t4',number:'AT-105'});
 const report=Audit.run('Investigate ANG10 latest trip',s,{role:'manager'});
 assert.match(report.answer,/Multiple trips share the latest date/);
});
