'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Audit=require('../assistant-business-audit'),Query=require('../assistant-record-query');
const state=()=>({
 employees:[{id:'eV',name:'Victon Kufinya',jobTitle:'Driver',driverId:'dV',status:'Active'},
   {id:'eA',name:'Anton',jobTitle:'Driver',driverId:'dA',status:'Active'}],
 drivers:[{id:'dV',name:'Victon Kufinya'},{id:'dA',name:'Anton'}],
 trucks:[{id:'trk_ang3',fleetName:'ANG 3',defaultDriverId:'dV'},{id:'trk_ang10',fleetName:'ANG 10',defaultDriverId:'dA'}],
 payProfiles:[{employeeId:'eV',cutoffDay:20,tripRatePerKm:0.3}],
 payroll:[{id:'pOCT',employeeId:'eV',period:'2026-10',periodStart:'2026-09-21',periodEnd:'2026-10-20',status:'Draft',tripKm:0,tripPay:0,manualTripIds:[]}],
 trips:[
 {id:'t1',number:'NBL-100',truckId:'trk_ang3',driverId:'dV',date:'2026-09-25',deliveredDate:'2026-09-28',status:'Delivered',stage:4,startKm:1000,endKm:1500,pod:true},
 {id:'t2',number:'NBL-101',truckId:'trk_ang3',driverId:'dV',date:'2026-10-10',deliveredDate:'2026-10-15',status:'Delivered',stage:4,startKm:1600,endKm:1900,pod:true},
 {id:'t3',number:'NBL-102',truckId:'trk_ang3',driverId:'dV',date:'2026-10-18',deliveredDate:'2026-10-21',status:'Delivered',stage:4,startKm:1950,endKm:2200,pod:false},
 {id:'t4',number:'NBL-103',truckId:'trk_ang3',driverId:'dV',date:'2026-10-17',status:'Planned',stage:1,pod:false},
 {id:'t5',number:'NBL-104',truckId:'trk_ang10',driverId:'dA',date:'2026-10-18',status:'Delivered',stage:4,startKm:1000,endKm:1200}],
 diesel:[{id:'f1',tripId:'t1',slip:'DS-A',odometer:1100,litres:80,verified:true}],
 invoices:[],loans:[],expenses:[]
});
test('invoices are not needed for completed transport trips to earn payable kilometres',()=>{
 const s=state(),r=Audit.driverReport(s,s.employees[0],'2026-10');
 assert.equal(s.invoices.length,0);assert.equal(r.expectedKm,800);
 assert.equal(r.eligibleCount,2);assert.equal(r.savedKm,0);
 const answer=Audit.run('Why is Victon Kufinya salary trip pay zero in October 2026?',s,{role:'finance'});
 assert.match(answer.answer,/NBL-100/);
 assert.match(answer.answer,/NBL-101/);
 assert.match(answer.answer,/Invoicing is NOT a prerequisite/);
 assert.match(answer.answer,/Draft differs from verified eligible kilometres/);
});
test('latest saved payroll period and delivery-date cutoff diagnose excluded trips correctly',()=>{
 const s=state(),r=Audit.driverReport(s,s.employees[0],'2026-10');
 const after=r.candidates.find(t=>t.tripId==='t3');
 assert.equal(after.billingDate,'2026-10-21');
 assert.ok(after.issues.some(issue=>/outside 2026-09-21 to 2026-10-20/.test(issue)));
 const planned=r.candidates.find(t=>t.tripId==='t4');
 assert.ok(planned.issues.some(issue=>/not Delivered/.test(issue)));
});
test('one diesel slip cannot be demanded for payroll when full trip readings exist',()=>{
 const s=state();
 const report=Audit.run('Does Victon have diesel slips for all trips?',s,{role:'finance'});
 assert.match(report.answer,/NBL-100.*1 linked diesel slips/);
 assert.match(report.answer,/NBL-101.*0 linked diesel slips/);
 assert.match(report.answer,/does NOT prove no trip occurred/);
 assert.equal(report.page,'payroll');
});
test('if a trip has only slip odometer without end reading the report says no payable distance',()=>{
 const s=state();s.trips[0].startKm=0;s.trips[0].endKm=0;s.trips[0].distance=0;
 const ans=Audit.run('Why does Victon have zero km on payslip?',s,{role:'admin'}).answer;
 assert.match(ans,/No payable full-trip distance/);assert.match(ans,/NBL-100/);
});
test('unlinked driver and missing status are distinguished from invoicing and no diesel',()=>{
 const s=state();s.trips[0].driverId='eV';
 const r=Audit.driverReport(s,s.employees[0],'2026-10');
 assert.equal(r.expectedKm,300);
 assert.ok(r.candidates.find(x=>x.tripId==='t1').issues.some(x=>/not linked to the payroll driver ID/.test(x)));
 assert.equal(s.trips[0].driverId,'eV','audit never changes assignments');
});
test('dispatcher cannot see payroll or salaries through slip audit, while finance can',()=>{
 const s=state();
 assert.match(Audit.run('Why is Victon Kufinya payslip zero km?',s,{role:'dispatcher'}).answer,/Finance payroll records/);
 const ops=Audit.run('Which of Victon trips are missing diesel slips?',s,{role:'dispatcher'});
 assert.ok(ops.answer.includes('NBL-101'));
 assert.equal(ops.answer.includes('N$'),false);
 assert.equal(ops.answer.includes('payslip Draft'),false);
});
test('general checks cover absent links, completed unbilled trips, missing km and duplicates',()=>{
 const s=state();s.trips[0].driverId=null;s.trips[1].startKm=0;s.trips[1].endKm=0;s.diesel.push({...s.diesel[0],id:'f2'});
 assert.match(Audit.run('Find trips without driver assignments',s,{role:'manager'}).answer,/NBL-100/);
 assert.match(Audit.run('Which completed trips are uninvoiced?',s,{role:'finance'}).answer,/NBL-101/);
 assert.match(Audit.run('Which completed trips have missing distance km?',s,{role:'dispatcher'}).answer,/NBL-101/);
 assert.match(Audit.run('Check duplicate diesel slips',s,{role:'finance'}).answer,/ds a: 2 records/);
});
test('route ordinary questions and preserve approved and paid snapshots',()=>{
 const s=state(),before=JSON.stringify(s);
 for(const q of ['Why is Victon salary 0?','Does Victon need an invoice before trip pay?','Which slips are missing for Victon?',
 'List trips without driver assignment','Which trips were not invoiced?','Check fleet data quality','Are trips double paid after cutoff?']){
  const p=Query.parse(q);
  assert.ok(p?.mode,q+' should route to a read-only mode');
  const r=Query.run(p,q,s,{role:'admin'},{now:new Date('2026-10-27')});
  assert.ok(r?.answer,q+' should return grounded content');
 }
 assert.equal(JSON.stringify(s),before);
 assert.equal(Query.parse('Delete diesel slip'),null);
 const code=fs.readFileSync('server.js','utf8');
 assert.match(code,/\/api\/admin\/payroll-investigation/);
 assert.match(code,/const BusinessAudit=require\('\.\/assistant-business-audit'\)/);
});
test('finalized payslips cannot be modified by auditing or be interpreted as Drafts',()=>{
 const s=state();s.payroll[0].status='Paid';
 const ans=Audit.run('Why is Victon payroll 0 km?',s,{role:'finance'}).answer;
 assert.match(ans,/Finalized payslip is locked/);
 assert.equal(s.payroll[0].status,'Paid');assert.equal(s.payroll[0].tripKm,0);
});
