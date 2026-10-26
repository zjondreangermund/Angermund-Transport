'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Cycle=require('../payroll-cycle'),Assistant=require('../assistant-operations-answers');
const state=()=>({
 employees:[{id:'e',name:'Josef',driverId:'d',jobTitle:'Driver',baseSalary:3000}],
 drivers:[{id:'d',name:'Josef'}],
 trucks:[{id:'trk_ang4',fleetName:'ANG 4',defaultDriverId:'d'}],
 payProfiles:[{employeeId:'e',cutoffDay:15,shunterBonusAmount:6000,shunterWorkingDays:20,payBasis:'transport'}],
 trips:[],payroll:[],diesel:[]
});
test('every configured cutoff day creates consecutive, inclusive monthly periods',()=>{
 const a=Cycle.bounds('2026-10',{id:'d'},false,null,{cutoffDay:15});
 assert.deepEqual(a,{start:'2026-09-16',end:'2026-10-16',periodEnd:'2026-10-15',basis:'configured-cutoff'});
 const b=Cycle.bounds('2026-11',{id:'d'},false,null,{cutoffDay:15});
 assert.equal(a.end,b.start);
 const feb=Cycle.bounds('2027-02',{id:'d'},false,null,{cutoffDay:31});
 assert.equal(feb.start,'2027-02-01');assert.equal(feb.periodEnd,'2027-02-28');assert.equal(feb.end,'2027-03-01');
});
test('invoice dates have priority and recurring drafts reflect cutoff changes',()=>{
 const invoice={periodStart:'2026-09-25',periodEnd:'2026-10-24',payrollBasis:'invoice-cycle'};
 assert.equal(Cycle.bounds('2026-10',{id:'d'},false,invoice,{cutoffDay:15}).periodEnd,'2026-10-24');
 const ordinary={periodStart:'2026-09-21',periodEnd:'2026-10-20',payrollBasis:'nbl-cycle'};
 assert.equal(Cycle.bounds('2026-10',{id:'d'},false,ordinary,{cutoffDay:15}).periodEnd,'2026-10-15');
 assert.equal(Cycle.bounds('2026-10',{id:'d'},true,null,{cutoffDay:15}).periodEnd,'2026-10-31');
});
test('assistant gives grounded cutoff and shunter explanations only to permitted roles',()=>{
 const s=state();
 let r=Assistant.answer('What is Josef cutoff date?',s,{role:'finance'});
 assert.match(r.answer,/cutoff day 15/);assert.equal(r.page,'payroll');
 assert.equal(Assistant.answer('What is Josef salary?',s,{role:'driver'}),null);
 s.payProfiles[0].payBasis='shunter';
 r=Assistant.answer('What is Josef shunter bonus?',s,{role:'finance'});
 assert.match(r.answer,/N\$ 300\.00/);assert.equal(r.page,'shunterBonus');
 assert.equal(Assistant.answer('What is Josef shunter bonus?',s,{role:'dispatcher'}),null);
});
test('assistant finds live saved trips and differentiates missing records',()=>{
 const s=state();s.trips=[{id:'t1',number:'TRIP-22',truckId:'trk_ang4',date:'2026-10-21',status:'Delivered',stage:4,driverId:'d'}];
 const r=Assistant.answer('Where are trips for ANG 4 21 oct 2026?',s,{role:'dispatcher'});
 assert.equal(r.records[0].id,'t1');assert.match(r.answer,/TRIP-22/);
 const absent=Assistant.answer('Why is ANG 4 22 oct 2026 trip not showing?',s,{role:'dispatcher'});
 assert.match(absent.answer,/No matching trip/);
});
test('assistant explains missing pay and does not fabricate payroll results',()=>{
 const s=state();s.payProfiles[0].payBasis='transport';
 const r=Assistant.answer('Why is Josef trip pay missing?',s,{role:'finance'});
 assert.match(r.answer,/No saved payslip/);
});
