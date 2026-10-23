const test=require('node:test'),assert=require('node:assert/strict');
const Phone=require('../phone-trip-tracking'),Sites=require('../trip-site-geofences'),Depot=require('../depot-arrival'),Lifecycle=require('../public/trip-lifecycle');
const now=Date.parse('2026-10-23T15:00:00Z');
function state(){return {routes:[{id:'route',loadName:'WINDHOEK DC',offloadName:'DISTELL WHK'}],trips:[{id:'trip',number:'NBL-1',driverId:'driver',routeId:'route',stage:3,legs:[{id:'leg',routeId:'route',status:'In transit'}]}]}}
test('only assigned driver starts tracking; another session is stopped and pause keeps trip stage',()=>{
  const s=state();assert.throws(()=>Phone.setTracking(s,'trip','other',true),/not assigned/);
  s.trips.push({id:'other',driverId:'driver',phoneTracking:{active:true,driverId:'driver'}});
  const t=Phone.setTracking(s,'trip','driver',true,new Date(now).toISOString());assert.equal(s.trips[1].phoneTracking.active,false);
  assert(Phone.permitsPoint(t,{driverId:'driver'},{recordedAt:new Date(now+1000).toISOString(),accuracy:20}));
  assert(!Phone.permitsPoint(t,{driverId:'driver'},{recordedAt:new Date(now-1000).toISOString(),accuracy:20}));
  assert(!Phone.permitsPoint(t,{driverId:'driver'},{recordedAt:new Date(now+1000).toISOString(),accuracy:500}));
  Phone.setTracking(s,'trip','driver',false);assert.equal(t.stage,3);assert(!Phone.permitsPoint(t,{driverId:'driver'},{recordedAt:new Date(now+1000).toISOString(),accuracy:20}));
});
test('saved sites match unique full names, never a shared town or an ambiguous duplicate',()=>{
  const fences=[{id:'dc',name:'Windhoek DC',active:true,latitude:-22.5,longitude:17.1},{id:'town',name:'Route town · Windhoek',active:true},{id:'distell',name:'DISTELL WHK',active:true,latitude:-22.6,longitude:17.2}];
  assert.equal(Sites.exactFence(fences,'WINDHOEK DC').id,'dc');assert.equal(Sites.exactFence(fences,'Windhoek'),null);
  assert.equal(Sites.exactFence([...fences,{...fences[0],id:'duplicate'}],'Windhoek DC'),null);
  const s=state();assert.equal(Sites.reuseSaved(s,fences),2);assert.equal(s.trips[0].legs[0].loadingGeofenceId,'dc');assert.equal(s.routes[0].offloadLat,-22.6);
  assert.equal(Sites.reuseSaved(s,fences),0);assert.throws(()=>Sites.applyFence(s,'route','offloading',fences[1]),/site geofence/);
});
test('phone depot completion needs two fixes for the opted-in trip and current session',()=>{
  const t={id:'trip',driverId:'driver',stage:4,status:'Delivered',arrivedAt:new Date(now-100000).toISOString(),phoneTracking:{active:true,driverId:'driver',startedAt:new Date(now-120000).toISOString()}},depot={name:'Angermund depot',active:true,radiusM:100};
  const point={source:'android-background',driverId:'driver',tripId:'trip',accuracy:10,recordedAt:new Date(now).toISOString()},previous={...point,recordedAt:new Date(now-45000).toISOString()};
  assert(Depot.canConfirmGps(point,previous,depot,t,()=>true,now));
  assert(!Depot.canConfirmGps(point,{...previous,source:'phone-test'},depot,t,()=>true,now));
  assert(!Depot.canConfirmGps(point,previous,depot,{...t,phoneTracking:{...t.phoneTracking,active:false}},()=>true,now));
  assert(!Depot.canConfirmGps(point,{...previous,tripId:'other'},depot,t,()=>true,now));
  Lifecycle.confirmDepot(t,{at:new Date(now).toISOString(),source:'phone-geofence'});assert(Lifecycle.completed(t));
});
test('bulk state cannot fabricate or remove a tracking session',()=>{
  const original=state(),incoming=state();original.trips[0].phoneTracking={active:false,driverId:'driver'};incoming.trips[0].phoneTracking={active:true};
  Depot.protectServerArrival(incoming,original);assert.equal(incoming.trips[0].phoneTracking.active,false);
  Depot.protectServerArrival(incoming,state());assert.equal(incoming.trips[0].phoneTracking,undefined);
});
test('linked trip zones use the saved site radius rather than a town-sized default',()=>{
  const fs=require('fs'),vm=require('vm'),src=fs.readFileSync('server.js','utf8');
  const chunk=src.slice(src.indexOf('function linkedTripZones('),src.indexOf('async function linkTripLegGeofences('));
  const ctx={num:x=>Number(x)||0,routeTripZones:()=>({load:{latitude:1,longitude:2},offload:{latitude:3,longitude:4}})};
  vm.createContext(ctx);vm.runInContext(chunk,ctx);
  const zones=ctx.linkedTripZones({}, {loadingGeofenceId:'load',offloadingGeofenceId:'off'}, {}, [{id:'load',name:'Site A',latitude:1,longitude:2,radiusM:250},{id:'off',name:'Site B',latitude:3,longitude:4,radiusM:500}]);
  assert.equal(zones.loadArrivalM,250);assert.equal(zones.offloadArrivalM,500);assert(zones.loadDepartM>zones.loadArrivalM);
});
