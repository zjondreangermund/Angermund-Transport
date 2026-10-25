'use strict';
const test=require('node:test'),a=require('node:assert/strict');
const {driverState,taskVisible,notificationVisible}=require('../driver-access');
const u={sub:'u1',role:'driver',driverId:'d1'};
test('driver tasks require personal assignment and explicit user takes precedence',()=>{
 a.equal(taskVisible({ownerRole:'Driver'},u),false);
 a.equal(taskVisible({assignedUserId:'u2',assignedDriverId:'d1'},u),false);
 a.equal(taskVisible({assignedDriverId:'d1'},u),true);
 a.equal(taskVisible({assignedUserId:'u1'},u),true);
 a.equal(taskVisible({assignedDriverId:'d2'},u),false);
});
test('driver alerts reject office, global and role-wide broadcasts on every channel',()=>{
 for(const n of [{},{role:'admin'},{role:'driver'},{driver_id:'d2'},{user_id:'u2',driver_id:'d1'}])a.equal(notificationVisible(n,u),false);
 for(const n of [{driver_id:'d1'},{userId:'u1'},{user_id:'u1'}])a.equal(notificationVisible(n,u),true);
 a.equal(notificationVisible({}, {sub:'office',role:'admin'}),true);
});
test('scoped state excludes other people and financial/admin fields, including nested leg rates',()=>{
 const s={trips:[{id:'t1',driverId:'d1',truckId:'tr1',routeId:'r1',clientId:'c1',income:20000,legs:[{id:'l1',routeId:'r1',income:9000,unitRate:100}]},{id:'t2',driverId:'d2'}],drivers:[{id:'d1',name:'Me',salary:1000},{id:'d2',name:'Other'}],trucks:[{id:'tr1',fleetName:'ANG 10',finance:500},{id:'tr2'}],routes:[{id:'r1',name:'Route',rate:12000}],clients:[{id:'c1',name:'Client',email:'private'}],tasks:[{id:'mine',assignedDriverId:'d1'},{id:'other',assignedDriverId:'d2'},{id:'office',ownerRole:'Dispatcher'}],invoices:[{amount:10000}],settings:{bank:'private'},secret:{key:'private'}};
 const out=driverState(s,u);a.equal(out.trips.length,1);a.equal(out.trips[0].income,undefined);a.equal(out.trips[0].legs[0].income,undefined);a.equal(out.routes[0].rate,undefined);a.equal(out.drivers.length,1);a.equal(out.drivers[0].salary,undefined);a.deepEqual(out.invoices,[]);a.deepEqual(out.secret,{});a.deepEqual(out.settings,{currentDriver:'d1'});a.deepEqual(out.tasks.map(t=>t.id),['mine']);a.equal(driverState(s,{role:'driver'}).trips.length,0);
});
