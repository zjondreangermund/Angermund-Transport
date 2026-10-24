'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),O=require('../assistant-operations');
const make=()=>({
 employees:[{id:'j',name:'Josef Manfred',status:'Active'},{id:'e',name:'Elia Hans',status:'Active'}],
 drivers:[{id:'j',name:'Josef Manfred',status:'Available'},{id:'e',name:'Elia Hans',status:'Available'}],
 trucks:[{id:'a12',fleetName:'ANG 12',status:'Available'},{id:'a10',fleetName:'ANG 10',status:'Available'}],
 trips:[{id:'t1',number:'AT-101',truckId:'a12',driverId:'j',stage:1,status:'Planned',updatedAt:'initial'},
        {id:'t2',number:'AT-102',truckId:'a10',driverId:'e',stage:1,status:'Planned',updatedAt:'initial2'}],
 loans:[],tasks:[],expenses:[],audit:[]
});
const preview=(q,s,role='admin')=>{const p=O.plan(q,s,Date.parse('2026-10-24T06:00:00Z'));if(!p||p.error)throw Error(p?.error||'No planned action');p.actorRole=role;return p};
test('loan creation via natural wording is a proposed action; approved loan retains monthly deduction',()=>{
 const s=make(),p=preview('Add loan to Josef Manfred for N$2,000 monthly deduction N$200',s,'finance');
 assert.equal(p.kind,'loan_create');assert.equal(s.loans.length,0);
 const saved=O.apply(s,p,'Manager');assert.equal(saved.recordType,'loan');assert.equal(s.loans[0].balance,2000);
 assert.equal(s.loans[0].monthlyDeduction,200);assert.equal(s.loans[0].startPeriod,'2026-10');
 assert.equal(s.loans[0].status,'Active');
});
test('pause loan and change monthly deduction, stale approval is rejected',()=>{
 const s=make();s.loans.push({id:'loan_1',employeeId:'j',balance:1000,monthlyDeduction:100,status:'Active',updatedAt:'a'});
 const p=preview('Pause Josef Manfred loan',s,'finance');assert.equal(s.loans[0].status,'Active');
 O.apply(s,p,'Finance');assert.equal(s.loans[0].status,'Paused');
 const upd=preview('Change Josef Manfred loan monthly deduction to N$175',s,'finance');
 s.loans[0].balance=900;assert.throws(()=>O.apply(s,upd,'Finance'),/changed since preview/);
 s.loans[0].balance=1000;O.apply(s,upd,'Finance');assert.equal(s.loans[0].monthlyDeduction,175);
});
test('create tasks due tomorrow with high priority, retaining no assigned receipts',()=>{
 const s=make(),p=preview('Create task to inspect ANG 12 tomorrow, high priority',s,'dispatcher');
 assert.equal(p.kind,'task_create');assert.equal(p.values.priority,'High');assert.equal(p.values.due,'2026-10-25');
 const x=O.apply(s,p,'Dispatcher');assert.equal(s.tasks[0].id,x.entityId);assert.equal(s.tasks[0].status,'Open');
});
test('assign driver by full name and exact trip, preserving other trip',()=>{
 const s=make(),p=preview('Assign driver Elia Hans to trip AT-101',s,'dispatcher');
 O.apply(s,p,'Dispatcher');assert.equal(s.trips[0].driverId,'e');assert.equal(s.trips[1].driverId,'e');
});
test('reject an active truck or driver conflict',()=>{
 const s=make();s.trips[1].status='In transit';s.trips[1].stage=3;
 assert.match(O.plan('Assign driver Elia Hans to trip AT-101',s).error,/busy/);
 assert.match(O.plan('Assign truck ANG 10 to trip AT-101',s).error,/busy/);
});
test('truck reassignment works when the truck is free',()=>{
 const s=make(),p=preview('Change truck ANG 10 for trip AT-101',s,'dispatcher');
 O.apply(s,p);assert.equal(s.trips[0].truckId,'a10');
});
test('expense is only Review with receipt missing, not auto approved',()=>{
 const s=make(),p=preview('Record toll expense N$450 for trip AT-101',s,'finance');
 assert.equal(s.expenses.length,0);O.apply(s,p);
 assert.equal(s.expenses[0].amount,450);assert.equal(s.expenses[0].status,'Review');
 assert.equal(s.expenses[0].receiptMissing,true);assert.equal(s.trips[0].stage,1);
});
test('scope prevents finance staff changing trucks and dispatcher changing loans',()=>{
 const s=make();
 const l=preview('Add loan to Josef Manfred for N$1000 monthly deduction N$100',s,'dispatcher');
 assert.throws(()=>O.apply(s,l),/Not allowed/);
 const d=preview('Assign driver Elia Hans to trip AT-101',s,'finance');
 assert.throws(()=>O.apply(s,d),/Not allowed/);
});
test('never guess which employee or trip if ambiguous or incomplete',()=>{
 const s=make();s.employees.push({id:'j2',name:'Josef Manfred',status:'Active'});
 assert.match(O.plan('Add loan to Josef Manfred for N$200 monthly deduction N$50',s).error,/More than one/);
 assert.match(O.plan('Record toll expense N$50',s).error,/trip/);
 assert.equal(O.plan('Where do I see monthly profit?',s),null);
});
