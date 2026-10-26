'use strict';
const test=require('node:test'),a=require('node:assert/strict'),M=require('../public/trip-metrics'),D=require('../assistant-diagnostics'),S=require('../trip-search');
test('fuel uses full trip odometers, not partial distances between receipts',()=>{
 const t={id:'t',startKm:1000,endKm:1600,distance:500,legs:[{distance:200},{distance:300}]};
 const m=M.fuel(t,[{litres:100,total:2500,odometer:1200},{litres:100,total:2500,odometer:1400}]);
 a.equal(m.distance,600);a.equal(m.kmPerL,3);a.equal(m.estimated,false);a.equal(m.costPerKm,5000/600);
});
test('missing values stay missing and saved route distance is explicitly estimated',()=>{
 a.equal(M.fuel({id:'t'},[{litres:100,odometer:1200},{litres:100,odometer:1400}]).ready,false);
 a.match(M.fuel({id:'t'},[{litres:100}]).reason,/distance/);
 a.match(M.fuel({id:'t',distance:200},[]).reason,/diesel litres/);
 a.equal(M.distance({startKm:200,endKm:100,distance:90}).distance,90);
 a.equal(M.distance({legs:[{distance:50},{distance:0}]}).distance,0);
 a.equal(M.distance({legs:[{distance:50},{distance:40}]}).estimated,true);
});
const state={trucks:[{id:'truck',fleetName:'ANG 10'}],drivers:[{id:'d',name:'Anton'}],routes:[],trips:[{id:'t',number:'AT-123',truckId:'truck',driverId:'d',date:'2026-10-20',stage:2,legs:[{load:'Charcoal',distance:300},{load:'Furniture',distance:400}]}],diesel:[],payroll:[]};
test('search finds and displays both cargo legs',()=>{
 a.equal(S.find(state,'find charcoal and furniture trip').length,1);
 const r=S.reply(state,'find furniture trip');a.match(r.answer,/Charcoal/);a.match(r.answer,/Furniture/);
});
test('diagnostics explain evidence and preserve payroll role boundary',()=>{
 const r=D.reply('Why is ANG10 trip missing from payslip 2026-10?',state,'admin');a.match(r.answer,/before stage 3/);a.match(r.answer,/No matching payslip/);a.match(r.answer,/No linked diesel litres/);
 a.equal(D.reply('Why is ANG10 missing from payroll?',state,'dispatcher').source,'record-permission');
 a.equal(D.reply('Why is ANG10 diesel missing?',state,'driver').source,'record-permission');
 a.equal(D.reply('delete trip AT-123',state,'admin'),null);
 a.match(D.reply('Why is ANG11 trip missing?',state,'admin').answer,/cannot confirm/);
});
test('payslip captures immutable per-trip amounts and labels',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),src=fs.readFileSync('server.js','utf8');
 const c={num:v=>Number(v||0),crypto:require('node:crypto'),PayrollEligibility:require('../public/payroll-eligibility'),periodBounds:()=>({start:'2026-10-01',end:'2026-11-01'}),serverTripLegSummary:(s,t)=>M.distance(t),serverTripRate:()=>.4};vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function workforceEmployees('),src.indexOf('function generatePayrollPeriod(')),c);
 const s=structuredClone(state);s.trips[0].stage=4;s.employees=[{id:'d',name:'Anton',jobTitle:'Driver'}];s.payProfiles=[];
 const p=c.calculatePayrollRecord(s,s.employees[0],'2026-10');a.equal(p.tripBreakdown[0].pay,280);a.equal(p.tripPay,280);a.equal(p.tripBreakdown[0].load,'Charcoal / Furniture');s.trips[0].legs[0].load='Changed';a.equal(p.tripBreakdown[0].load,'Charcoal / Furniture');
});
