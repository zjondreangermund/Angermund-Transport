'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const AI=require('../assistant-intelligence');
const data=()=>({
 trucks:[{id:'trk_ang10',fleetName:'ANG 10'}],
 drivers:[{id:'d',name:'Josef'}],
 employees:[{id:'e',name:'Josef',driverId:'d',jobTitle:'Driver'}],
 payProfiles:[{employeeId:'e',payBasis:'transport',cutoffDay:19}],
 payroll:[{id:'p',employeeId:'e',period:'2026-10',periodStart:'2026-09-20',periodEnd:'2026-10-19',status:'Draft',tripKm:300,tripPay:150}],
 trips:[{id:'t',number:'TRIP-204',truckId:'trk_ang10',driverId:'d',date:'2026-10-20',status:'Delivered',stage:4,load:'Charcoal',distance:300,pod:true}],
 diesel:[{id:'fuel',tripId:'t',date:'2026-10-20',litres:200,odometer:100400,slip:'D-102'}],
 expenses:[{id:'exp',tripId:'t',amount:100,status:'Approved'}],
 invoices:[{id:'inv',number:'INV-1002',tripIds:['t'],periodStart:'2026-09-20',periodEnd:'2026-10-19',amount:6000,status:'Unpaid'}]
});
test('advanced requests are identified; routine navigation is cheap',()=>{
 assert.equal(AI.isAdvancedQuestion('Where is payroll?'),false);
 assert.equal(AI.isAdvancedQuestion('Why is ANG 10 diesel not calculating?'),true);
 assert.equal(AI.isAdvancedQuestion('Investigate the profit mismatch'),true);
 assert.equal(AI.chooseModel('classification'),'gpt-6-luna');
 assert.equal(AI.chooseModel('answer','Where are invoices?'),'gpt-6-luna');
 assert.equal(AI.chooseModel('answer','Why is ANG 10 diesel wrong?'),'gpt-6.1-sol');
});
test('model token cost uses cached input and actual response usage',()=>{
 const cost=AI.computeCost('gpt-6.1-sol',{input_tokens:10000,output_tokens:1000,input_tokens_details:{cached_tokens:5000}});
 assert.equal(cost,0.0205);
 const track=AI.createUsageTracker();
 track.record('gpt-6.1-sol',{input_tokens:10000,output_tokens:1000,input_tokens_details:{cached_tokens:5000}},'test');
 const a=track.report();assert.equal(a.calls,1);assert.equal(a.trackedUsd,0.0205);
 assert.equal(track.advancedAllowed(0.02),false);
 assert.equal(track.advancedAllowed(1),true);
 assert.equal(AI.computeCost('unknown-model',{input_tokens:2000}),null);
 assert.equal(track.record('gpt-6-luna',{},'empty'),null);
});
test('saved-trip evidence includes direct links, fuel source and missing pieces',()=>{
 const e=AI.buildEvidence('Why did TRIP-204 on ANG 10 have wrong diesel consumption?',data(),'manager');
 assert.equal(e.trips.length,1);assert.equal(e.trips[0].number,'TRIP-204');
 assert.equal(e.trips[0].truck,'ANG 10');assert.equal(e.trips[0].dieselSlipCount,1);
 assert.equal(e.trips[0].diesel.slips[0].odometer,100400);
 assert.equal(e.trips[0].podPresent,true);
 assert.equal(e.payroll,undefined);
});
test('dispatcher never receives payroll or invoice data, even when requested',()=>{
 const e=AI.buildEvidence('Why is Josef payroll and invoice INV-1002 wrong for ANG 10?',data(),'dispatcher');
 assert.equal(e.payroll,undefined);assert.equal(e.invoices,undefined);
 const unauthorized=AI.buildEvidence('Investigate all driver payroll',data(),'driver');
 assert.equal(unauthorized.trips,undefined);
});
test('finance can investigate pay and invoice using uniquely named person',()=>{
 const e=AI.buildEvidence('Why is Josef payslip for INV-1002 missing trip pay?',data(),'finance');
 assert.equal(e.payroll[0].employee,'Josef');assert.equal(e.payroll[0].payslips[0].tripPay,150);
 assert.equal(e.invoices[0].number,'INV-1002');
});
test('ambiguous questions never dump all fleet data',()=>{
 const e=AI.buildEvidence('Why did a truck trip fail?',data(),'manager');
 assert.equal(e.trips.length,0);assert.match(e.note,/No unambiguous/);
});
