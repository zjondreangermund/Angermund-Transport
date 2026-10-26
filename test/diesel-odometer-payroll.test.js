'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../public/trip-metrics'),Elig=require('../public/payroll-eligibility'),Link=require('../payroll-trip-link');
test('partial diesel slip odometers provide known kilometres, without inventing missing departure or return',()=>{
 const t={id:'durban',truckId:'ang10',driverId:'driver',stage:4,date:'2026-10-20'};
 const slips=[{tripId:'durban',truckId:'ang10',driverId:'driver',litres:450,odometer:100500},{tripId:'durban',truckId:'ang10',driverId:'driver',litres:200,odometer:101200}];
 const m=M.distance(t,slips);
 a.equal(m.distance,700);a.equal(m.partial,true);a.match(m.distanceSource,/confirmed portion/i);
 a.equal(M.fuel(t,slips).ready,false);a.match(M.fuel(t,slips).reason,/Only a portion/);
 a.equal(M.distance(t,[slips[0]]).distance,0);
 a.equal(M.distance({...t,startKm:100000},slips).distance,1200);
 a.equal(M.distance({...t,startKm:100000,endKm:102000},slips).distance,2000);
 a.equal(M.distance({...t,distance:1800},slips).distance,1800);
 a.equal(M.distance(t,[{...slips[0],tripId:'other'},slips[1]]).distance,0);
 a.equal(M.distance(t,[{...slips[0],truckId:'other'},slips[1]]).distance,0);
 a.equal(M.distance({...t,startKm:101000},slips).distance,0); // first slip before trip start
});
test('separate employee records that match a uniquely named driver are eligible, not an unrelated assistant',()=>{
 const drivers=[{id:'drv_anton',name:'Anton'},{id:'drv_josef',name:'Josef'}];
 a.equal(Elig.isDriver({id:'emp_a',name:'Anton',category:'Employee'},drivers),true);
 a.equal(Elig.isDriver({id:'emp_b',name:'Anton',jobTitle:'Assistant'},drivers),false);
 a.equal(Elig.isDriver({id:'emp_c',name:'Anton',jobTitle:'Mechanic'},drivers),false);
 a.equal(Elig.isDriver({id:'emp_d',name:'Anton',driverId:'drv_josef'},drivers),true);
 a.equal(Elig.isDriver({id:'emp_e',name:'Anton',category:'Employee'},[...drivers,{id:'other',name:'Anton'}]),false);
});
test('October draft payroll uses diesel odometer kilometre evidence for the assigned driver, with a traceable payslip source',()=>{
 const source=fs.readFileSync('server.js','utf8');
 const chunk=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 const ctx={num:x=>Number(x||0),crypto:require('node:crypto'),PayrollCycle:require('../payroll-cycle'),PayrollTripLink:require('../payroll-trip-link'),TripMetrics:require('../public/trip-metrics'),TripMetrics:M,PayrollEligibility:Elig,PayrollTripLink:Link,
  ensureTripLegs:(s,t)=>t.legs?.length?t.legs:[t],calculateLegIncome:x=>Number(x.income||0),
  serverSouthAfricaTrip:()=>false,serverFuelMetrics:(s,t)=>M.fuel(t,(s.diesel||[]).filter(x=>x.tripId===t.id)),
  periodBounds:()=>({start:'2026-10-01',end:'2026-11-01'})};
 vm.createContext(ctx);
 vm.runInContext(chunk('function serverTripLegSummary(','function driverFuelRecordCost('),ctx);
 vm.runInContext(chunk('function serverTripRate(','function serverIncentiveFor('),ctx);
 vm.runInContext(chunk('function workforceEmployees(','function generatePayrollPeriod('),ctx);
 vm.runInContext(chunk('function generatePayrollPeriod(','function monthPeriod('),ctx);
 const state={employees:[{id:'emp_anton',name:'Anton',category:'Employee'}],drivers:[{id:'drv_anton',name:'Anton'}],
  trucks:[{id:'ang10',fleetName:'Ang 10'}],routes:[],payProfiles:[],payroll:[],expenses:[],advances:[],loans:[],
  diesel:[{tripId:'trip1',odometer:100500,litres:200},{tripId:'trip1',odometer:101200,litres:200}],
  trips:[{id:'trip1',number:'AT-123',date:'2026-10-20',truckId:'ang10',driverId:'drv_anton',status:'Completed',stage:5,
    legs:[{id:'leg1',load:'Furniture',distance:0}]}]};
 const rows=ctx.generatePayrollPeriod(state,'2026-10');
 a.equal(rows.length,1);a.equal(rows[0].tripKm,700);a.equal(rows[0].tripPay,210);
 a.equal(rows[0].tripBreakdown.length,1);a.equal(rows[0].tripBreakdown[0].partial,true);
 a.match(rows[0].tripBreakdown[0].distanceSource,/diesel slip odometers/i);
 // With final depot odometer the full trip supersedes the partial sum, not added to it.
 state.trips[0].startKm=100000;state.trips[0].endKm=102000;
 const second=ctx.generatePayrollPeriod(state,'2026-10');
 a.equal(second[0].tripKm,2000);a.equal(second[0].tripBreakdown[0].partial,false);
 a.equal(second[0].tripPay,1000);
 second[0].status='Approved';state.trips[0].endKm=102500;
 const third=ctx.generatePayrollPeriod(state,'2026-10');
 a.equal(third[0].tripKm,2000);a.equal(third[0].tripPay,1000);
});
