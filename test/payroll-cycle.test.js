'use strict';
const test=require('node:test'),a=require('node:assert/strict'),C=require('../payroll-cycle'),Link=require('../payroll-trip-link'),fs=require('node:fs'),vm=require('node:vm');
function context(){const src=fs.readFileSync('server.js','utf8'),c={PayrollManualTrips:require('../payroll-manual-trips'),PayrollCycle:C,PayrollTripLink:Link,PayrollEligibility:require('../public/payroll-eligibility'),TripMetrics:require('../public/trip-metrics'),crypto:require('node:crypto'),num:x=>Number(x||0),serverTripLegSummary:(s,t)=>({distance:t.distance||0}),serverTripRate:(state,trip,configured)=>configured>0?configured:.5};vm.createContext(c);for(const [start,end] of [['function workforceEmployees(','function monthPeriod('],['function syncNblDriverPayroll(','function buildNblConsolidatedInvoice(']])vm.runInContext(src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start))),c);return c;}
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


test('Anton is a transport driver even if a stale Shunter payroll profile is present',()=>{
 const s=state(),employee=s.employees[0];employee.name='Anton';s.drivers[0].name='Anton';
 s.trucks=[{id:'trk_ang10',fleetName:'ANG 10',defaultDriverId:'d'}];
 s.payProfiles=[{employeeId:'e',payBasis:'shunter',cutoffDay:20,shunterBonusAmount:8000}];
 s.trips=[{id:'run',truckId:'trk_ang10',driverId:'d',date:'2026-10-07',stage:4,status:'Delivered',distance:200,shunter:true,tripType:'Shunter'}];
 a.equal(C.isShunter(s,s.trips[0]),false,'A stale trip flag must not reclassify an ANG10 journey');
 a.equal(C.shunterDriver(s,s.drivers[0],s.payProfiles[0]),false,'Only ANG4 and ANG5 default drivers are shunters');
 const p=context().calculatePayrollRecord(s,employee,'2026-10');
 a.equal(p.periodStart,'2026-09-21');a.equal(p.periodEnd,'2026-10-20');
 a.equal(p.tripKm,200);a.equal(p.tripPay,100);a.equal(p.shunterBonus,0);
});
test('only drivers assigned to ANG4 or ANG5 receive monthly shunter pay plus worked-day bonus',()=>{
 const s=state(),employee=s.employees[0];s.payProfiles=[{employeeId:'e',payBasis:'transport',shunterBonusAmount:8000,shunterWorkingDays:20}];
 s.trips=[{id:'sh',truckId:'trk_ang4',driverId:'d',date:'2026-10-11',stage:4,status:'Delivered',distance:35}];
 a.equal(C.shunterDriver(s,s.drivers[0],s.payProfiles[0]),true);
 const p=context().calculatePayrollRecord(s,employee,'2026-10');
 a.equal(p.periodStart,'2026-10-01');a.equal(p.periodEnd,'2026-10-31');
 a.equal(p.tripKm,0);a.equal(p.tripPay,0);
 a.equal(p.shunterDays,1);a.equal(p.shunterBonus,400);
});

test('new fixed profile trip-pay rate replaces inherited zero on existing Draft payslip',()=>{
 const state0=state();state0.trucks=[];state0.trips=[{id:'run',driverId:'d',date:'2026-10-12',stage:4,status:'Delivered',distance:200}];
 state0.payProfiles=[{employeeId:'e',baseSalary:3000,tripRatePerKm:0,cutoffDay:20}];
 const c=context(),before=c.calculatePayrollRecord(state0,state0.employees[0],'2026-10');
 a.equal(before.tripRatePerKm,0);a.equal(before.tripKm,200);a.equal(before.tripPay,100);
 state0.payProfiles[0].tripRatePerKm=1.35;
 const after=c.calculatePayrollRecord(state0,state0.employees[0],'2026-10',before);
 a.equal(after.tripRatePerKm,1.35);
 a.equal(after.tripPay,270);
 a.equal(after.tripBreakdown[0].rate,1.35);
 a.equal(after.tripRateOverride,false);
});
test('manual payslip rate wins over employee rate and resetting to zero restores inherited rate',()=>{
 const st=state();st.trucks=[];st.trips=[{id:'run',driverId:'d',date:'2026-10-12',stage:4,status:'Delivered',distance:120}];
 st.payProfiles=[{employeeId:'e',tripRatePerKm:1.2}];
 const c=context();let p=c.calculatePayrollRecord(st,st.employees[0],'2026-10');
 a.equal(p.tripPay,144);
 p={...p,tripRateOverride:true,tripRatePerKm:1.8};
 let next=c.calculatePayrollRecord(st,st.employees[0],'2026-10',p);
 a.equal(next.tripPay,216);a.equal(next.tripRateOverride,true);
 p={...next,tripRateOverride:false,tripRatePerKm:0};
 next=c.calculatePayrollRecord(st,st.employees[0],'2026-10',p);
 a.equal(next.tripRatePerKm,1.2);a.equal(next.tripPay,144);
});
test('approved and paid payroll remain unchanged when a profile rate is updated',()=>{
 const server=fs.readFileSync('server.js','utf8');
 const at=server.indexOf("app.patch('/api/payroll/profiles/:driverId'");
 const end=server.indexOf("app.get('/api/payroll/:id/extra-trips'",at);
 const endpoint=server.slice(at,end);
 a.match(endpoint,/draft.status!=='Draft'/);
 a.match(endpoint,/draft.tripRateOverride===true/);
 a.match(endpoint,/profiles\/:employeeId\/rate-preview/);
});
