'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Audit=require('../assistant-ops-audit'),Operations=require('../assistant-operations'),Jobs=require('../assistant-jobs');
const base=()=>({
 trucks:[{id:'trk_ang10',fleetName:'ANG 10'},{id:'trk_ang4',fleetName:'ANG 4'}],
 drivers:[{id:'d',name:'Josef'}],
 employees:[{id:'e',name:'Josef',driverId:'d',jobTitle:'Driver'}],
 payProfiles:[{employeeId:'e',payBasis:'transport'}],
 trips:[{id:'t',number:'TRIP-204',truckId:'trk_ang10',driverId:'d',date:'2026-10-20',deliveredDate:'2026-10-21',
   status:'Delivered',stage:4,pod:true,load:'Charcoal',startKm:1000,
   legs:[{id:'leg1',load:'Charcoal',pod:true}]}],
 diesel:[{id:'f1',tripId:'t',truckId:'trk_ang10',driverId:'d',date:'2026-10-20',odometer:1100,litres:120,slip:'DS1'},
   {id:'f2',tripId:'t',truckId:'trk_ang10',driverId:'d',date:'2026-10-21',odometer:1300,litres:160,slip:'DS2'}],
 expenses:[],payments:[],invoices:[],payroll:[],tasks:[]
});
test('audit triggers for linked diagnostics, not routine navigation or mutation',()=>{
 assert.equal(Audit.isAuditRequest('Investigate ANG 10 latest trip and payroll'),true);
 assert.equal(Audit.isAuditRequest('Why is ANG 10 diesel not calculating?'),true);
 assert.equal(Audit.isAuditRequest('Create invoice for ANG 10'),false);
 assert.equal(Audit.isAuditRequest('Where is the payroll tab?'),false);
 assert.equal(Audit.wantsTasks('Prepare audit tasks for TRIP-204'),true);
 assert.equal(Audit.wantsTasks('Investigate TRIP-204'),false);
});
test('audit does not guess an ambiguous truck trip',()=>{
 const s=base();s.trips.push({...s.trips[0],id:'t2',number:'TRIP-205',date:'2026-10-22'});
 const r=Audit.run('Investigate ANG 10',s,{role:'manager'});
 assert.match(r.answer,/Specify a trip number, date/);assert.equal(r.records.length,2);
 const specific=Audit.run('Investigate TRIP-204',s,{role:'manager'});
 assert.equal(specific.targets.length,1);assert.equal(specific.targets[0].id,'t');
 const latest=Audit.run('Investigate ANG 10 latest trip',s,{role:'manager'});
 assert.equal(latest.targets[0].id,'t2');
});
test('trip audit finds missing POD, partial diesel distance, fuel and invoice evidence without mutation',()=>{
 const s=base();s.trips[0].pod=false;s.trips[0].legs[0].pod=false;
 const before=JSON.stringify(s);
 const report=Audit.run('Investigate TRIP-204 diesel POD and invoice',s,{role:'manager'});
 const codes=report.issues.map(x=>x.code);
 assert.ok(codes.includes('DISTANCE_PARTIAL'));assert.ok(codes.includes('POD_MISSING'));
 assert.ok(codes.includes('PAYROLL_PERIOD_MISSING'));
 assert.equal(codes.includes('INVOICE_UNBILLED'),false);
 assert.equal(JSON.stringify(s),before);
 assert.match(report.answer,/partial diesel odometer/);
});
test('confirmed delivered trip detects missing bill and mismatched linked payroll cutoff',()=>{
 const s=base();s.trips[0].endKm=1500;
 let report=Audit.run('Audit TRIP-204',s,{role:'finance'});
 assert.ok(report.issues.some(i=>i.code==='INVOICE_UNBILLED'));
 s.invoices=[{id:'i',number:'INV-1002',periodStart:'2026-09-21',periodEnd:'2026-10-20',tripIds:['t']}];
 s.payroll=[{id:'p',employeeId:'e',period:'2026-10',periodStart:'2026-10-01',periodEnd:'2026-10-31',
  status:'Paid',sourceInvoiceIds:['i'],tripBreakdown:[]}];
 report=Audit.run('Audit TRIP-204',s,{role:'finance'});
 assert.ok(report.issues.some(i=>i.code==='INVOICE_PAYROLL_CUTOFF'));
 assert.ok(report.issues.some(i=>i.code==='PAYROLL_TRIP_EXCLUDED'));
 assert.ok(!report.issues.some(i=>i.code==='INVOICE_UNBILLED'));
});
test('dispatch may investigate diesel and POD but cannot access payroll, invoices or staff details',()=>{
 const s=base();s.trips[0].pod=false;s.trips[0].legs[0].pod=false;
 const report=Audit.run('Investigate TRIP-204',s,{role:'dispatcher'});
 assert.equal(report.issues.some(i=>i.code.startsWith('PAYROLL')||i.code.startsWith('INVOICE')),false);
 assert.equal(report.answer.includes('Josef'),false);
 assert.equal(report.answer.includes('invoices'),false);
 assert.equal(Audit.run('Investigate TRIP-204',s,{role:'driver'}).source,'record-permission');
});
test('follow-up task proposals are deduplicated and validated by existing approval system',()=>{
 const s=base();s.trips[0].pod=false;s.trips[0].legs[0].pod=false;
 const report=Audit.run('Prepare audit tasks for TRIP-204',s,{role:'manager'});
 const commands=Audit.taskCommands(report,s);
 assert.ok(commands.length>0&&commands.length<=8);
 assert.ok(commands.every(c=>c.startsWith('Create task to ')));
 const planned=Jobs.planAny({command:commands[0]},structuredClone(s),'manager');
 assert.equal(planned.kind,'task_create');
 assert.ok(planned.values.title.includes('TRIP-204'));
 assert.equal(s.tasks.length,0);
 s.tasks=[{id:'existing',title:planned.values.title,status:'Open'}];
 const other=Audit.taskCommands(report,s);
 assert.ok(!other.some(x=>x.includes(planned.values.title)));
});
test('unlinked or absent trip is reported without inventing operations',()=>{
 const s=base();const out=Audit.run('Investigate TRIP-9999',s,{role:'manager'});
 assert.match(out.answer,/Specify an exact trip number/);
 assert.equal(out.targets,undefined);
});
