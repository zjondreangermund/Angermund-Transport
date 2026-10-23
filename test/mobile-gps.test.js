const test=require('node:test'),assert=require('node:assert/strict');
const {resolveMobileGps}=require('../mobile-gps');
const now=Date.parse('2026-10-23T13:00:00Z'),user={driverId:'driver-a'};
const old={id:'old',driverId:'driver-a',truckId:'truck-a'},active={id:'new',driverId:'driver-a',truckId:'truck-b'};
const point={latitude:-22.5,longitude:17.1,recordedAt:new Date(now).toISOString()};
test('live native locations resolve the assigned trip',()=>{
  const r=resolveMobileGps(point,user,[old,active],active,now);assert.equal(r.trip,active);assert.equal(r.historical,false);
});
test('queued locations stay attached to their original trip, not the newly assigned truck',()=>{
  const r=resolveMobileGps({...point,capturedTripId:'old',recordedAt:new Date(now-3600000).toISOString()},user,[old,active],active,now);
  assert.equal(r.trip,old);assert.equal(r.historical,true);
});
test('missing old context and another driver trip cannot be rebound',()=>{
  assert.equal(resolveMobileGps({...point,recordedAt:new Date(now-3600000).toISOString()},user,[old],active,now).trip,null);
  assert.equal(resolveMobileGps({...point,capturedTripId:'other'},user,[{id:'other',driverId:'driver-b'}],active,now).trip,undefined);
});
test('stale test replay is history only and invalid coordinates/timestamps are rejected',()=>{
  assert.equal(resolveMobileGps({...point,recordedAt:new Date(now-180000).toISOString()},user,[],null,now).historical,true);
  for(const data of [{latitude:91},{longitude:-181},{recordedAt:'broken'},{recordedAt:new Date(now+120000).toISOString()},{recordedAt:new Date(now-8*86400000).toISOString()}])
    assert.throws(()=>resolveMobileGps({...point,...data},user,[],null,now),/Invalid or expired/);
});
test('native test active uses actual enabled and mode flags rather than stale web storage',()=>{
  const fs=require('fs'),vm=require('vm'),src=fs.readFileSync('public/app.js','utf8');
  const section=src.slice(src.indexOf('function nativeGpsStatus(){'),src.indexOf('function nativeGpsStatusContent(){'));
  const ctx={window:{AngermundNative:{getGpsStatus:()=>JSON.stringify({enabled:false,testMode:true})}},nativePhoneGpsTestAvailable:()=>true,appLocalStorage:{getItem:()=> '1'}};
  vm.createContext(ctx);vm.runInContext(section,ctx);assert.equal(ctx.phoneGpsTestActive(),false);
  ctx.window.AngermundNative.getGpsStatus=()=>JSON.stringify({enabled:true,testMode:true});assert.equal(ctx.phoneGpsTestActive(),true);
});
