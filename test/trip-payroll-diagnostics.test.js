'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../trip-payroll-diagnostics');
test('production report detects saved cargo, manual trips, excluded active work, and no pay without distance',()=>{
 const state={employees:[{id:'staff1',name:'Anton',jobTitle:'Driver'}],drivers:[{id:'drv1',name:'Anton'}],trucks:[{id:'ang10',fleetName:'ANG 10'}],trips:[{id:'t1',number:'AT-99',source:'manual',date:'2026-10-21',truckId:'ang10',driverId:'drv1',stage:2,status:'Driving',legs:[{load:'Charcoal',distance:200},{load:'Furniture',distance:200}]}],payroll:[{employeeId:'staff1',period:'2026-10',status:'Draft',tripKm:0,tripPay:0}]};
 const r=D.inspect(state,'2026-10');assert.equal(r.tripsTotal,1);assert.equal(r.manualTrips.length,1);assert.equal(r.cargoMatches.length,1);assert.equal(r.cargoMatches[0].loads.length,2);assert.equal(r.payroll[0].eligibleTrips.length,0);assert.equal(r.payroll[0].excludedTrips.length,1);assert.match(r.payroll[0].issue,/not completed/);
});
test('no modification is made to database state or paid payslips',()=>{const state={trips:[],drivers:[],employees:[],payroll:[{status:'Paid'}]};const before=JSON.stringify(state);D.inspect(state);assert.equal(JSON.stringify(state),before)});
