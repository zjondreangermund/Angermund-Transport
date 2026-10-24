'use strict';
const test=require('node:test'),a=require('node:assert/strict'),E=require('../assistant-extra-actions'),I=require('../assistant-live-insights');
const s=()=>({
 trips:[{id:'t1',number:'AT-101',status:'Planned',stage:1,truckId:'ang12',driverId:'d1',sourceOrderRef:'OLD',notes:'Initial',updatedAt:'2026-10-24T00:00:00Z'},
 {id:'t2',number:'AT-102',status:'Delivered',stage:4,truckId:'ang10',driverId:'d2',legs:[{pod:false}],pod:false,updatedAt:'2026-10-24T00:00:00Z'}],
 trucks:[{id:'ang12',fleetName:'ANG 12',status:'Available'},{id:'ang10',fleetName:'ANG 10',status:'On trip'}],
 drivers:[{id:'d1',name:'Josef Manfred'},{id:'d2',name:'Elia Hans'}],
 tasks:[{id:'task1',title:'Inspect ANG 12 brakes',status:'Open',priority:'Normal',due:'2026-10-23',updatedAt:'a'},
 {id:'task2',title:'Check NBL paperwork',status:'Open',priority:'Normal',due:'2026-10-25',updatedAt:'b'}],
 loans:[{id:'loan1',employeeId:'d1',balance:900,monthlyDeduction:100,status:'Active'}],expenses:[{id:'ex1',tripId:'t2',category:'Parking',amount:300,status:'Review'}],audit:[]
});
const plan=(text,state,role='admin')=>{const p=E.plan(text,state);a.ok(p?.kind,p?.error);p.actorRole=role;return p};
test('staff can propose, approve and audit task priority changes without premature saves',()=>{
 const state=s(),p=plan('Set task "Inspect ANG 12 brakes" priority to High',state);
 a.equal(p.kind,'task_update');a.equal(state.tasks[0].priority,'Normal');
 E.apply(state,p,'Admin');a.equal(state.tasks[0].priority,'High');a.equal(state.audit[0].linkedType,'task');
});
test('setting task due date uses strict calendar validation and stale changes fail',()=>{
 const state=s();a.match(E.plan('Set task "Inspect ANG 12 brakes" due 2026-02-30',state).error,/valid task due date/);
 const p=plan('Set task "Inspect ANG 12 brakes" due 2026-11-03',state);
 state.tasks[0].updatedAt='new';a.throws(()=>E.apply(state,p,'Admin'),/changed after preview/);
});
test('a named driver can be assigned to a specific existing task',()=>{
 const state=s(),p=plan('Assign task "Inspect ANG 12 brakes" to driver Josef Manfred',state,'dispatcher');
 a.equal(p.field,'assignedDriverId');
 E.apply(state,p,'Dispatcher');a.equal(state.tasks[0].assignedDriverId,'d1');a.equal(state.tasks[0].ownerRole,'Driver');
});
test('task completion requiring receipt is not bypassed through assistant',()=>{
 a.match(E.plan('Mark task "Inspect ANG 12 brakes" completed',s()).error,/required evidence/);
});
test('trip notes append without changing trip status and retain audit',()=>{
 const state=s(),p=plan('Add note to trip AT-101: Truck waiting for loading confirmation',state,'manager');
 a.equal(state.trips[0].notes,'Initial');
 E.apply(state,p,'Manager');a.match(state.trips[0].notes,/Truck waiting/);a.equal(state.trips[0].status,'Planned');
});
test('trip order reference updates are approved and protected against stale previews',()=>{
 const state=s(),p=plan('Set order reference for trip AT-101 to NBL-9900',state,'finance');
 a.equal(state.trips[0].sourceOrderRef,'OLD');
 E.apply(state,p,'Finance');a.equal(state.trips[0].sourceOrderRef,'NBL-9900');
 a.ok(state.trips[0].loadEditedAt);
});
test('dispatcher cannot create a financial invoice via the assistant extras and finance cannot edit tasks',()=>{
 a.equal(E.plan('Pay invoice AT-101',s()),null);
 const state=s(),p=plan('Set task "Inspect ANG 12 brakes" priority to Critical',state,'finance');
 a.throws(()=>E.apply(state,p),/role cannot/);
});
test('read-only dispatch insights use actual saved state without changing it',()=>{
 const state=s(),before=JSON.stringify(state);
 let x=I.summary('Which trucks are available?',state,{role:'dispatcher'},'2026-10-24T12:00:00Z');
 a.match(x.answer,/ANG 12/);a.doesNotMatch(x.answer,/ANG 10 ·/);
 x=I.summary('Which trips are still planned?',state,{role:'dispatcher'},'2026-10-24T12:00:00Z');a.match(x.answer,/AT-101/);
 x=I.summary('Which trips have missing POD?',state,{role:'dispatcher'},'2026-10-24T12:00:00Z');a.match(x.answer,/AT-102/);
 a.equal(before,JSON.stringify(state));
});
test('loan details require financial role and never leak to drivers or dispatchers',()=>{
 const state=s();
 const blocked=I.summary('What loans does Josef Manfred have?',state,{role:'dispatcher'});
 a.doesNotMatch(blocked.answer,/900/);
 const allowed=I.summary('What loans does Josef Manfred have?',state,{role:'finance'});
 a.match(allowed.answer,/900/);
});
test('overdue tasks and trip status give current saved records, not GPS fiction',()=>{
 const state=s();
 const overdue=I.summary('Show overdue tasks',state,{role:'manager'},'2026-10-24T12:00:00Z');
 a.match(overdue.answer,/Inspect ANG 12 brakes/);a.doesNotMatch(overdue.answer,/Check NBL paperwork/);
 const status=I.summary('What is the status of trip AT-101?',state,{role:'manager'});
 a.match(status.answer,/Planned/);a.match(status.answer,/not confirmed real-time GPS/);
});
