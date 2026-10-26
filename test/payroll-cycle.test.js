'use strict';
const test=require('node:test'),a=require('node:assert/strict'),C=require('../payroll-cycle'),Link=require('../payroll-trip-link'),fs=require('node:fs'),vm=require('node:vm');
function context(){const src=fs.readFileSync('server.js','utf8'),c={PayrollCycle:C,PayrollTripLink:Link,PayrollEligibility:require('../public/payroll-eligibility'),TripMetrics:require('../public/trip-metrics'),crypto:require('node:crypto'),num:x=>Number(x||0),serverTripLegSummary:(s,t)=>({distance:t.distance||0}),serverTripRate:()=>.5};vm.createContext(c);for(const [start,end] of [['function workforceEmployees(','function monthPeriod('],['function syncNblDriverPayroll(','function buildNblConsolidatedInvoice(']])vm.runInContext(src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start))),c);return c;}
const state=()=>({drivers:[{id:'d',name:'Driver'}],employees:[{id:'e',driverId:'d',name:'Driver',jobTitle:'Driver',baseSalary:3000}],trucks:[{id:'trk_ang4',fleetName:'Ang 4',defaultDriverId:'d'}],trips:[],payProfiles:[],payroll:[],loans:[],expenses:[],advances:[]});
test('transport cutoff handles year boundaries and exact invoice date overrides',()=>{
 a.deepEqual(C.bounds('2027-01',{},false),{start:'2026-12-21',end:'2027-01-21',periodEnd:'2027-01-20',basis:'nbl-cycle'});
 a.equal(C.bounds('2026-10',{},true).start,'2026-10-01');
 a.equal(C.bounds('2026-10',{},false,{periodStart:'2026-09-25',periodEnd:'2026-10-24'}).end,'2026-10-25');
});
test('basic plus daily bonus counts one day across multiple loads, excludes planned and other drivers',()=>{
 const s=state();s.trips=[{id:'a',truckId:'trk_ang4',driverId:'d',date:'2026-10-02',stage:4},{id:'b',truckId:'trk_ang4',driverId:'d',date:'2026-10-02',stage:4},{id:'c',truckId:'trk_ang4',driverId:'d',date:'2026-10-03',stage:1},{id:'x',truckId:'trk_ang4',driverId:'other',date:'2026-10-04',stage:4}];s.shunterRecons=[{id:'r',truckId:'trk_ang4',date:'2026-10-05'}];
 const c=context(),p=c.calculatePayrollRecord(s,s.employees[0],'2026-10');a.equal(p.shunterDays,2);a.equal(p.shunterBonus,800);a.equal(p.tripPay,0);a.equal(p.gross,3800);a.equal(p.periodStart,'2026-10-01');
 s.payProfiles[0].shunterBonusAmount=6000;a.equal(c.calculatePayrollRecord(s,s.employees[0],'2026-10').shunterBonus,600);
});
test('invoice auto-creates exact driver period, includes end date, excludes next date and is idempotent',()=>{
 const s=state();s.trucks=[];s.trips=[{id:'a',driverId:'d',date:'2026-09-22',deliveredDate:'2026-09-25',stage:4,distance:100},{id:'b',driverId:'d',date:'2026-10-24',stage:4,distance:200},{id:'c',driverId:'d',date:'2026-10-25',stage:4,distance:1000}];
 const inv={id:'i',periodStart:'2026-09-25',periodEnd:'2026-10-24',lines:[{tripId:'a'},{tripId:'a'},{tripId:'b'}]},c=context();
 c.syncNblDriverPayroll(s,inv);a.equal(s.payroll.length,1);const p=s.payroll[0];a.equal(p.periodStart,inv.periodStart);a.equal(p.periodEnd,inv.periodEnd);a.equal(p.tripKm,300);a.equal(p.tripPay,150);
 c.syncNblDriverPayroll(s,inv);a.equal(s.payroll.length,1);c.generatePayrollPeriod(s,'2026-10');a.equal(p.periodStart,inv.periodStart);
 p.status='Paid';const before=JSON.stringify(p);c.syncNblDriverPayroll(s,inv);a.equal(JSON.stringify(p),before);
});
test('default transport cycle includes 21st of previous month and 20th, excludes 21st of current month',()=>{
 const s=state();s.trucks=[];s.trips=['2026-09-20','2026-09-21','2026-10-20','2026-10-21'].map((date,i)=>({id:String(i),date,driverId:'d',stage:4,distance:100}));const p=context().calculatePayrollRecord(s,s.employees[0],'2026-10');a.equal(p.tripCount,2);a.equal(p.tripPay,100);
});
