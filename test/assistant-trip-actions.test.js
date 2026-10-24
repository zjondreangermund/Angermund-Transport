'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../assistant-trip-actions');
const make=()=>({trucks:[{id:'a12',fleetName:'Ang 12'},{id:'a10',fleetName:'Ang 10'}],
 drivers:[{id:'d1',name:'Josef'}],
 trips:[{id:'trip1',number:'AT-101',truckId:'a12',driverId:'d1',status:'Planned',stage:1,updatedAt:'a',legs:[{id:'l',sequence:1,status:'Planned'}]},
        {id:'trip2',number:'AT-102',truckId:'a10',driverId:'d1',status:'Planned',stage:1,updatedAt:'b'}]});
test('creates proposed rename without mutating trip',()=>{
 const s=make(),x=p.plan('Change trip AT-101 number to AT-201',s);
 assert.equal(x.kind,'trip_rename');assert.equal(x.next,'AT-201');assert.equal(s.trips[0].number,'AT-101');
 const r=p.apply(s,x,'Admin');assert.equal(r.number,'AT-201');assert.equal(s.trips[0].id,'trip1');
 assert.equal(s.audit[0].linkedId,'trip1');
});
test('blocked duplicate trip number and stale approval',()=>{
 const s=make();assert.match(p.plan('Change trip AT-101 number to AT-102',s).error,/already used/);
 const a=p.plan('Change trip AT-101 number to AT-205',s);s.trips[0].updatedAt='changed';
 assert.throws(()=>p.apply(s,a),/changed since/);
});
test('truck Ang 12 from planned to departing sets trip and its active leg + truck/driver on approval only',()=>{
 const s=make();const x=p.plan('Switch truck ANG 12 from planned to departing',s);
 assert.equal(x.kind,'trip_depart');assert.equal(s.trips[0].status,'Planned');
 const r=p.apply(s,x);assert.equal(r.status,'In transit');assert.equal(r.stage,3);
 assert.equal(s.trips[0].legs[0].status,'In transit');assert.equal(s.trucks[0].status,'On trip');
 assert.equal(s.drivers[0].status,'On trip');
 assert.match(p.plan('Switch truck ANG 12 from planned to departing',s).error,/No single planned/);
});
test('trip reference departure also works with a unique number',()=>{
 const s=make();const x=p.plan('Change trip AT-102 from planned to departed',s);
 assert.equal(x.kind,'trip_depart');assert.equal(x.tripId,'trip2');
});
test('no guesses if fleet/trip is ambiguous or status already delivered',()=>{
 const s=make();s.trips.push({...s.trips[0],id:'trip3',number:'AT-103'});
 assert.match(p.plan('Mark ANG12 as departed',s).error,/Multiple planned trips/);
 assert.equal(p.plan('Check monthly income',s),null);
 s.trips[0].status='Delivered';s.trips[0].stage=4;
 assert.match(p.plan('Mark AT-101 as departed',s).error,/not Planned/);
});
test('requires an assigned driver and denies unknown action',()=>{
 const s=make();delete s.trips[0].driverId;
 assert.match(p.plan('Set AT-101 to departing',s).error,/assigned truck and driver/);
 assert.throws(()=>p.apply(s,{kind:'delete_all',tripId:'trip1',expected:{...s.trips[0]}}));
});
