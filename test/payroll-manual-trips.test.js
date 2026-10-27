'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Manual=require('../payroll-manual-trips');
const Cycle=require('../payroll-cycle');
const state=()=>({
 trucks:[{id:'trk_ang10',fleetName:'ANG 10'},{id:'trk_ang4',fleetName:'ANG 4'}],
 drivers:[{id:'d1',name:'Anton'},{id:'d2',name:'Other driver'}],
 employees:[{id:'emp1',name:'Anton',driverId:'d1'},{id:'emp2',name:'Other driver',driverId:'d2'}],
 payProfiles:[{employeeId:'emp1',payBasis:'transport',cutoffDay:20}],
 trips:[{id:'before',number:'AT-100',driverId:'d1',truckId:'trk_ang10',date:'2026-10-17',deliveredDate:'2026-10-19',stage:4,status:'Delivered'},
 {id:'carry',number:'AT-101',driverId:'d1',truckId:'trk_ang10',date:'2026-10-23',deliveredDate:'2026-10-24',stage:4,status:'Delivered'},
 {id:'later',number:'AT-102',driverId:'d1',truckId:'trk_ang10',date:'2026-10-25',deliveredDate:'2026-10-26',stage:4,status:'Delivered'},
 {id:'other',number:'AT-200',driverId:'d2',truckId:'trk_ang10',date:'2026-10-23',deliveredDate:'2026-10-24',stage:4,status:'Delivered'},
 {id:'planned',number:'AT-201',driverId:'d1',truckId:'trk_ang10',date:'2026-10-24',stage:1,status:'Planned'},
 {id:'shunter',number:'AT-202',driverId:'d1',truckId:'trk_ang4',date:'2026-10-24',stage:4,status:'Delivered'}],
 payroll:[
 {id:'oct',employeeId:'emp1',period:'2026-10',periodStart:'2026-09-21',periodEnd:'2026-10-20',payrollBasis:'invoice-cycle',status:'Draft',manualTripIds:[]},
 {id:'nov',employeeId:'emp1',period:'2026-11',periodStart:'2026-10-21',periodEnd:'2026-11-20',payrollBasis:'invoice-cycle',status:'Draft'}]
});
const selected=(s,p)=>Manual.selectedTrips(s,'emp1',s.drivers[0],p,p.periodStart,Cycle.dayAfter(p.periodEnd)).map(t=>t.id);
test('one completed trip after NBL cutoff can be paid early exactly once and remains on target after draft refresh',()=>{
 const s=state(),[oct,nov]=s.payroll;
 assert.deepEqual(selected(s,oct),['before']);
 assert.deepEqual(selected(s,nov),['carry','later']);
 assert.ok(Manual.candidateTrips(s,oct,s.drivers[0]).some(t=>t.id==='carry'));
 Manual.assign(s,oct,s.drivers[0],'carry','finance-user');
 assert.deepEqual(selected(s,oct),['before','carry']);
 assert.deepEqual(selected(s,nov),['later']);
 assert.equal(oct.manualTripIds[0],'carry');
 assert.equal(oct.manualTripLog[0].action,'included-early');
 // Simulate the automatic NBL re-generation next month: selection stays excluded.
 const reloaded=structuredClone(s);
 assert.deepEqual(selected(reloaded,reloaded.payroll[1]),['later']);
 assert.deepEqual(selected(reloaded,reloaded.payroll[0]),['before','carry']);
});
test('two after-cutoff trips can be assigned and leave zero duplicate kilometres in future payroll',()=>{
 const s=state(),oct=s.payroll[0],nov=s.payroll[1];
 Manual.assign(s,oct,s.drivers[0],'carry');
 Manual.assign(s,oct,s.drivers[0],'later');
 assert.deepEqual(selected(s,oct),['before','carry','later']);
 assert.deepEqual(selected(s,nov),[]);
 assert.equal(Manual.candidateTrips(s,oct,s.drivers[0]).length,0);
});
test('removing early trip from draft restores ordinary next cycle eligibility',()=>{
 const s=state(),[oct,nov]=s.payroll;
 Manual.assign(s,oct,s.drivers[0],'carry');
 Manual.remove(s,oct,s.drivers[0],'carry');
 assert.deepEqual(selected(s,oct),['before']);
 assert.deepEqual(selected(s,nov),['carry','later']);
 assert.equal(oct.manualTripLog.at(-1).action,'removed');
});
test('completed trip may not be reassigned to a different driver, be planned, or be a shunter trip',()=>{
 const s=state(),p=s.payroll[0],d=s.drivers[0];
 for(const id of ['other','planned','shunter'])assert.throws(()=>Manual.assign(s,p,d,id),/different driver|Only delivered|Shunter trips/);
 assert.throws(()=>Manual.assign(s,p,d,'before'),/not after this payslip cutoff/);
 assert.deepEqual(p.manualTripIds,[]);
});
test('prevent allocation to two payslips, prevent double payment after approval and ignore later cycles',()=>{
 const s=state(),[oct,nov]=s.payroll;
 Manual.assign(s,oct,s.drivers[0],'carry');
 assert.throws(()=>Manual.assign(s,nov,s.drivers[0],'carry'),/not after this payslip cutoff|manually allocated/);
 oct.status='Approved';
 assert.throws(()=>Manual.remove(s,oct,s.drivers[0],'carry'),/locked/);
 assert.throws(()=>Manual.assign(s,oct,s.drivers[0],'later'),/locked/);
 assert.deepEqual(selected(s,nov),['later']);
 const following={...nov,id:'dec',period:'2026-12',periodStart:'2026-11-21',periodEnd:'2026-12-20'};
 assert.deepEqual(selected(s,following),[]);
});
test('reject known finalized trip duplication and legacy finalized period without detail snapshot',()=>{
 const s=state(),p=s.payroll[0],d=s.drivers[0];
 s.payroll[1].status='Paid';s.payroll[1].tripBreakdown=[{tripId:'carry'}];
 assert.throws(()=>Manual.assign(s,p,d,'carry'),/finalized/);
 s.payroll[1].tripBreakdown=undefined;
 assert.throws(()=>Manual.assign(s,p,d,'carry'),/legacy payslip review/);
});
test('target selection shows only this driver completed after cutoff and excludes already claimed',()=>{
 const s=state(),p=s.payroll[0],d=s.drivers[0];
 const options=Manual.candidateTrips(s,p,d);
 assert.deepEqual(options.map(x=>x.id),['carry','later']);
 Manual.assign(s,p,d,'carry');
 assert.deepEqual(Manual.candidateTrips(s,p,d).map(x=>x.id),['later']);
});
test('invoice-cycle payroll bounds are unchanged by early payment allocation',()=>{
 const s=state(),p=s.payroll[0],d=s.drivers[0];
 Manual.assign(s,p,d,'carry');
 const bounds=Cycle.bounds('2026-10',d,false,p,{cutoffDay:20});
 assert.equal(bounds.start,'2026-09-21');
 assert.equal(bounds.periodEnd,'2026-10-20');
 assert.equal(p.periodStart,'2026-09-21');
 assert.equal(p.periodEnd,'2026-10-20');
});
