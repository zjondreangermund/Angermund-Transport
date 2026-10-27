'use strict';
const test=require('node:test'),a=require('node:assert/strict'),Q=require('../assistant-record-query');
const now=new Date('2026-10-27T03:35:00Z');
const state=()=>({
 employees:[{id:'e',name:'Victon',driverId:'dv',dateEmployed:'2023-03-15',status:'Active'},{id:'e2',name:'Josef',driverId:'dj',status:'Active'}],
 drivers:[{id:'dv',name:'Victon'},{id:'dj',name:'Josef'}],
 trucks:[{id:'t3',fleetName:'ANG 3'},{id:'t10',fleetName:'ANG 10'}],
 trips:[{id:'a',number:'NBL-1',driverId:'dv',truckId:'t3',date:'2026-09-22',stage:4,status:'Delivered',pod:true},
 {id:'b',number:'NBL-2',driverId:'dv',truckId:'t3',date:'2026-10-04',stage:5,status:'Completed',pod:true},
 {id:'c',number:'NBL-3',driverId:'dv',truckId:'t3',date:'2026-10-24',stage:4,status:'Delivered',pod:false},
 {id:'d',number:'NBL-4',driverId:'dv',truckId:'t3',date:'2026-10-16',stage:1,status:'Planned'},
 {id:'e',number:'NBL-5',driverId:'dj',truckId:'t10',date:'2026-10-16',stage:4,status:'Delivered',pod:false}],
 loans:[{id:'l1',employeeId:'e',date:'2026-09-05',status:'Active',amount:1500,balance:600,monthlyDeduction:200,reference:'L1'},
 {id:'l2',employeeId:'e2',date:'2026-10-03',status:'Active',amount:1000,balance:950,monthlyDeduction:100,reference:'L2'},
 {id:'l3',employeeId:'e',date:'2026-10-06',status:'Paid',amount:500,balance:0,monthlyDeduction:0}],
 diesel:[{id:'f',tripId:'e',date:'2026-10-17',verified:false,litres:250,printedTotal:7000}],
 invoices:[{id:'i',number:'NBL-OCT',status:'Unpaid',balance:7000,amount:7000,date:'2026-10-22'}],
 payroll:[{id:'p',employeeId:'e',period:'2026-10',periodStart:'2026-09-21',periodEnd:'2026-10-20',status:'Draft',tripKm:1200,tripPay:600,tripCount:2,net:6600}]
});
const run=(q,s=state(),role='admin',extra={})=>Q.run(Q.parse(q),q,s,{role},{now,...extra});
test('natural Victon trip questions use actual driver assignments and both date bounds',()=>{
 const r=run('How many trips did victon drive from 20sep to 20oct');
 a.match(r.answer,/2 saved completed/);a.match(r.answer,/2026-09-20 through 2026-10-20/);
 a.match(r.answer,/NBL-1/);a.doesNotMatch(r.answer,/NBL-3/);
 a.match(run('How many trips did Victon drive').answer,/3 saved completed/);
});
test('employment start date, not full-name clarification, drives tenure answer',()=>{
 a.match(run('How long is victon working for us').answer,/started on 2023-03-15/);
 const s=state();delete s.employees[0].dateEmployed;
 a.match(run('How long has victon been working for us',s).answer,/Date Employed/);
});
test('loans this month show active balances and new loans separately',()=>{
 const r=run('Who has loans this month');a.match(r.answer,/2 worker loan/);
 a.match(r.answer,/Victon/);a.match(r.answer,/Josef/);
 a.match(r.answer,/2 loan record\(s\) dated 2026-10/);
});
test('location shows recent coordinates or calls an old fix last-known instead of now',()=>{
 const gps=[{vehicleId:'t10',latitude:-22.6,longitude:17.1,recordedAt:'2026-10-27T03:34:00Z',source:'tracker'}];
 a.match(run('Where is ang10 now',state(),'dispatcher',{gps}).answer,/recent reported GPS fix/);
 a.match(run('Where is ang10 now',state(),'dispatcher',{gps:[{...gps[0],recordedAt:'2026-10-26T03:34:00Z'}]}).answer,/LAST KNOWN/);
 a.match(run('Where is ang10 now',state(),'dispatcher').answer,/no GPS fix/);
});
test('role boundaries, domain data counts and generic read-only aggregate',()=>{
 a.match(run('Who has loans this month',state(),'dispatcher').answer,/do not have permission/);
 a.match(run('How many trucks do we have').answer,/Saved trucks: 2/);
 a.match(run('Which trips missing POD').answer,/2 saved trips/);
 a.match(run('Which invoices are unpaid').answer,/NBL-OCT/);
 const p={mode:'aggregate',collection:'diesel',metric:'sum',field:'litres',truck:'ANG10'};
 a.match(Q.run(p,'diesel litres',state(),{role:'manager'},{now}).answer,/250.00/);
 a.match(Q.run({mode:'aggregate',collection:'loans',metric:'sum',field:'balance'},'loans',state(),{role:'dispatcher'},{now}).answer,/cannot access/);
});
test('read engine never changes the original operations records',()=>{
 const s=state(),snapshot=JSON.stringify(s);
 run('How many trips did victon drive',s);run('Who has loans this month',s);
 a.equal(JSON.stringify(s),snapshot);a.equal(Q.parse('Create trip for ANG10'),null);
});
