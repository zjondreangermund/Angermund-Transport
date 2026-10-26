'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const GPS=require('../trip-gps-progress'),M=require('../public/trip-metrics'),Protect=require('../depot-arrival');
const time=(i)=>new Date(Date.parse('2026-10-26T09:00:00Z')+i*45000).toISOString();
function trip(){return{id:'trip1',number:'AT-1',truckId:'ang10',startKm:1000,endKm:1011,startedAt:time(0),
  legs:[{id:'l1',routeId:'r1',status:'In transit'}],distance:11}};
function phone(i,override={}){return{tripId:'trip1',vehicleId:'ang10',driverId:'driver',source:'android-background',
 accuracy:15,latitude:-22,longitude:17+i*.007,recordedAt:time(i),...override}}
test('continuous authenticated phone GPS records independent trip kilometres and overrides stale Excel estimate only after depot',()=>{
 const t=trip();for(let i=0;i<15;i++)assert.equal(GPS.attach(t,phone(i),Date.parse(time(i))+1000),true);
 assert.equal(t.gpsProgress.points,15);assert(t.gpsProgress.observedKm>10);assert.equal(M.gpsReliable(t),false);
 assert.equal(M.distance(t).distance,11);t.depotArrival={at:time(14)};
 assert.equal(M.gpsReliable(t),true);
 assert.equal(M.distance(t).distanceSource,'Verified continuous GPS');
 assert.equal(M.distance(t).distance,t.gpsProgress.observedKm);
});
test('other trucks, test mode, untrusted browser, duplicate points and jumps cannot manufacture pay kilometres',()=>{
 const t=trip(),p=phone(0);assert.equal(GPS.attach(t,{...p,vehicleId:'ang11'}),false);
 assert.equal(GPS.attach(t,{...p,source:'phone-test'}),false);
 assert.equal(GPS.attach(t,{...p,source:'driver'}),false);
 assert.equal(GPS.attach(t,p,Date.parse(time(0))+1000),true);
 assert.equal(GPS.attach(t,p,Date.parse(time(0))+1000),false);
 assert.equal(GPS.attach(t,phone(1,{longitude:20}),Date.parse(time(1))+1000),true);
 assert.equal(t.gpsProgress.rejectedJumps,1);
 assert.equal(M.gpsReliable(t),false);
});
test('a superficially continuous but incomplete 30 km GPS recording cannot replace a 3000 km trip',()=>{
 const t=trip();t.startKm=100000;t.endKm=103000;
 for(let i=0;i<15;i++)GPS.attach(t,phone(i),Date.parse(time(i))+1000);
 t.depotArrival={at:time(14)};
 assert.equal(M.gpsReliable(t),false);assert.equal(M.distance(t).distance,3000);
});
test('GPS gaps do not silently count the shortest line as full distance',()=>{
 const t=trip();GPS.attach(t,phone(0),Date.parse(time(0))+1000);
 GPS.attach(t,phone(18),Date.parse(time(18))+1000);
 assert.equal(t.gpsProgress.gaps,1);assert.equal(t.gpsProgress.observedKm,0);
 t.depotArrival={at:time(18)};assert.equal(M.distance(t).distance,11);
});
test('geofence navigation reports straight-line distance TO next and observed track FROM previous',()=>{
 const t=trip(),p=phone(0);GPS.attach(t,p,Date.parse(time(0))+1000);
 const r={loadLat:-22,loadLon:17,loadName:'Windhoek',offloadLat:-22.1,offloadLon:17.2,offloadName:'Walvis warehouse'};
 const n=GPS.navigation(t,r,null,p);assert.equal(n.next,'Walvis warehouse');assert(n.toNextKm>0);
 GPS.attach(t,phone(1),Date.parse(time(1))+1000);const after=GPS.navigation(t,r,null,phone(1));
 assert(after.fromPreviousKm>0);assert.equal(after.unit,'straight-line GPS distance');
 t.returnJourney={startedAt:time(1)};const home=GPS.navigation(t,r,{latitude:-22,longitude:17,name:'Angermund depot'},phone(1));
 assert.equal(home.next,'Angermund depot');assert.equal(home.fromPreviousKm,0);assert.equal(home.previous,'Walvis warehouse');
});
test('offline historical phone fixes can be reconciled in timestamp order without duplicates',()=>{
 const t=trip(),points=[...Array(15)].map((_,i)=>phone(i));t.depotArrival={at:time(14)};
 const g=GPS.rebuild(t,[...points].reverse().concat(points[7]),{offloadLat:-22.1,offloadLon:17.2,offloadName:'Depot'},null);
 assert.equal(g.points,15);t.gpsProgress=g;assert.equal(M.gpsReliable(t),true);
});
test('stale browser state cannot overwrite authoritative trip GPS kilometre evidence',()=>{
 const original={trips:[{id:'trip1',gpsProgress:{points:22,observedKm:300}}]},
 incoming={trips:[{id:'trip1',gpsProgress:{points:1000,observedKm:999999}}]};
 Protect.protectServerArrival(incoming,original);assert.equal(incoming.trips[0].gpsProgress.observedKm,300);
});
test('GPS endpoint authorizes phone/tracker signals, rebuilding and manual closing-distance lock',()=>{
 const s=fs.readFileSync('server.js','utf8'),a=fs.readFileSync('public/app.js','utf8');
 assert.match(s,/TripGps\.valid\(p\)/);assert.match(s,/TripGps\.attach\(trip,p\)/);
 assert.match(s,/TripGps\.rebuild\(trip,rows,r,depot\)/);
 assert.match(s,/if\(TripMetrics\.gpsReliable\(t\)\)/);
 assert.match(s,/!process\.env\.TELEMATICS_WEBHOOK_TOKEN/);
 assert.match(a,/tripGpsStatus\(t\)/);assert.match(a,/reconcileTripGps/);
});
