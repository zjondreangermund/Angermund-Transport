'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Doctor=require('../payroll-km-diagnostics'),Cycle=require('../payroll-cycle'),Metrics=require('../public/trip-metrics');
const fixture=()=>({
 employees:[{id:'e',name:'Rudolph',driverId:'d',jobTitle:'Driver',category:'Driver',baseSalary:3000}],
 drivers:[{id:'d',name:'Rudolph'}],trucks:[{id:'ang10',fleetName:'ANG 10'}],
 payProfiles:[{employeeId:'e',payBasis:'transport',cutoffDay:20}],loans:[],expenses:[],advances:[],
 trips:[{id:'t',number:'NBL-66029039',truckId:'ang10',driverId:'d',date:'2026-10-17',deliveredDate:'2026-10-18',stage:4,status:'Delivered',startKm:0,endKm:0}],
 diesel:[{id:'f',tripId:'t',truckId:'ang10',driverId:'d',odometer:1927018,litres:381.76,printedTotal:10822.85,verified:false}],
 payroll:[{id:'p',employeeId:'e',period:'2026-10',periodStart:'2026-09-21',periodEnd:'2026-10-20',payrollBasis:'invoice-cycle',status:'Draft',tripKm:0,tripPay:0}]
});
test('generic salary missing km query is recognized without asking for trip reference',()=>{
 assert.equal(Doctor.broadRequest('Can you check why driver salaries dont display km readings'),true);
 assert.equal(Doctor.broadRequest('Can you check why driver salaries display no km readings'),true);
 assert.equal(Doctor.broadRequest('Where are invoices?'),false);
 assert.equal(Doctor.broadRequest('Why is ANG10 fuel wrong?'),false);
});
test('single saved slip odometer is not treated as kilometres travelled',()=>{
 const state=fixture(),out=Doctor.diagnose(state);
 assert.equal(out.rows[0].expectedKm,0);
 assert.equal(out.rows[0].eligibleTrips[0].odometerReadings,1);
 assert.match(out.rows[0].eligibleTrips[0].reasons[0],/1927018/);
 const reply=Doctor.reply('Why no driver salary km?',state);
 assert.match(reply.answer,/NBL-66029039/);
 assert.match(reply.answer,/reading/);
 assert.equal(reply.page,'payroll');
});
test('two linked odometers produce partial trip kilometres and an explicit warning',()=>{
 const s=fixture();
 s.diesel.push({...s.diesel[0],id:'f2',odometer:1927618,verified:true});
 const result=Doctor.diagnose(s).rows[0];
 assert.equal(result.expectedKm,600);
 assert.equal(result.eligibleTrips[0].partial,true);
 assert.ok(result.issues.some(x=>/partial kilometres/.test(x)));
});
test('complete independently verified start/end odometers allow full payroll kilometres',()=>{
 const s=fixture();s.trips[0].startKm=1926800;s.trips[0].endKm=1928000;
 const out=Doctor.diagnose(s).rows[0];
 assert.equal(out.expectedKm,1200);
 assert.equal(out.eligibleTrips[0].partial,false);
 assert.ok(out.issues.some(x=>/outdated zero kilometres/.test(x)));
});
test('finalized payslip must be reviewed instead of rewritten and shunters are excluded',()=>{
 const s=fixture();s.trips[0].startKm=1926800;s.trips[0].endKm=1928000;s.payroll[0].status='Paid';
 assert.match(Doctor.diagnose(s).rows[0].issues.join(' '),/finalized/);
 s.payProfiles[0].payBasis='shunter';
 assert.equal(Doctor.diagnose(s).rows.length,0);
});
function refreshContext(){
 const s=fs.readFileSync('server.js','utf8');
 const code=s.slice(s.indexOf('function refreshDraftPayrollAfterTripEvidence('),s.indexOf('function generatePayrollPeriod(',s.indexOf('function refreshDraftPayrollAfterTripEvidence(')));
 const ctx={num:v=>Number(v||0),PayrollCycle:Cycle,workforceEmployees:state=>state.employees,
  workforceDriver:(state,employee)=>state.drivers.find(x=>x.id===employee.driverId),
  payrollProfile:(state,employeeId)=>state.payProfiles.find(x=>x.employeeId===employeeId),
  calculatePayrollRecord:(state,employee,period,existing)=>{
   const eligible=state.trips.filter(t=>t.driverId===employee.driverId&&t.deliveredDate<=existing.periodEnd);
   const km=eligible.reduce((sum,t)=>sum+Metrics.distance(t,state.diesel.filter(d=>d.tripId===t.id)).distance,0);
   return{...existing,tripKm:km,tripPay:km*.3};
  }};
 vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;
}
test('diesel or depot evidence refreshes matching Draft payroll, but never paid or approved',()=>{
 const s=fixture(),ctx=refreshContext();
 s.trips[0].startKm=1926800;s.trips[0].endKm=1928000;
 assert.equal(ctx.refreshDraftPayrollAfterTripEvidence(s,s.trips[0]).length,1);
 assert.equal(s.payroll[0].tripKm,1200);
 assert.equal(s.payroll[0].tripPay,360);
 const snapshot=JSON.stringify(s.payroll[0]);
 s.payroll[0].status='Paid';s.trips[0].endKm=1928500;
 assert.equal(ctx.refreshDraftPayrollAfterTripEvidence(s,s.trips[0]).length,0);
 assert.equal(s.payroll[0].tripKm,1200);
 s.payroll[0].status='Approved';
 assert.equal(ctx.refreshDraftPayrollAfterTripEvidence(s,s.trips[0]).length,0);
 assert.equal(s.payroll[0].tripKm,1200);
});
test('refresh never modifies unrelated driver Draft payroll',()=>{
 const s=fixture(),ctx=refreshContext();
 s.employees.push({id:'e2',name:'Other driver',driverId:'d2'});s.drivers.push({id:'d2',name:'Other driver'});
 s.payProfiles.push({employeeId:'e2',payBasis:'transport'});s.payroll.push({...s.payroll[0],id:'p2',employeeId:'e2',tripKm:77,tripPay:23.1});
 s.trips[0].startKm=1926800;s.trips[0].endKm=1928000;
 ctx.refreshDraftPayrollAfterTripEvidence(s,s.trips[0]);
 assert.equal(s.payroll[1].tripKm,77);
});
