'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Timeline=require('../trip-geofence-timeline'),Display=require('../public/dispatch-geofence-progress');
const iso=i=>new Date(Date.parse('2026-10-26T10:00:00Z')+i*60000).toISOString();
const routes=[
{id:'r1',name:'Windhoek → Otjiwarongo',loadName:'Angermund loading',offloadName:'Otjiwarongo DC',loadLat:-22.5,loadLon:17,offloadLat:-22.5,offloadLon:17.1},
{id:'r2',name:'Otjiwarongo → Walvis',loadName:'Otjiwarongo DC',offloadName:'Walvis DC',loadLat:-22.5,loadLon:17.1,offloadLat:-22.5,offloadLon:17.2}
];
const fences=[{id:'h',name:'Angermund depot',kind:'depot',latitude:-22.5,longitude:17.3,radiusM:100}];
const trip=()=>({id:'t1',number:'ANG-11',status:'In transit',startedAt:iso(0),truckId:'ang11',legs:[
{id:'l1',sequence:1,routeId:'r1',status:'In transit'},
{id:'l2',sequence:2,routeId:'r2',status:'Planned'}],
gpsProgress:{points:1,observedKm:0}});
function point(i,lon){return{recordedAt:iso(i),latitude:-22.5,longitude:lon,accuracy:12}};
test('multi-leg itinerary deduplicates shared offloading/loading geofence and adds home depot',()=>{
 const stops=Timeline.chain(trip(),routes,fences);
 assert.deepEqual(stops.map(x=>x.name),['Angermund loading','Otjiwarongo DC','Walvis DC','Angermund depot']);
});
test('rolling three circles reset when truck leaves the next geofence, while retaining full trip distance',()=>{
 const t=trip(),stops=Timeline.chain(t,routes,fences),before=Display.kmProgress(t,1000);
 assert.equal(before.total,1000);
 const initial=Timeline.update(t,point(0,17.05),stops);
 assert.deepEqual(initial.window.map(x=>x.name),['Angermund loading','Otjiwarongo DC','Walvis DC']);
 assert.equal(initial.window[0].state,'inferred');
 t.gpsProgress.points=2;t.gpsProgress.observedKm=5;
 const arrival=Timeline.update(t,point(1,17.1),stops);
 assert.equal(arrival.window[1].state,'arrived');
 t.gpsProgress.points=3;t.gpsProgress.observedKm=5.7;
 const departure=Timeline.update(t,point(2,17.105),stops);
 assert.deepEqual(departure.window.map(x=>x.name),['Otjiwarongo DC','Walvis DC','Angermund depot']);
 assert.equal(departure.window[0].state,'departed');
 t.gpsProgress.points=4;t.gpsProgress.observedKm=18;
 const progress=Timeline.update(t,point(3,17.15),stops);
 assert.equal(progress.fromLastKm,12.3);
 assert(progress.toNextKm>0);
 const full=Display.kmProgress(t,1000);
 assert.equal(full.travelled,18);assert.equal(full.remaining,982);assert.equal(full.percent,1.8);
});
test('geofence window remains stable while truck is stopped inside fence; no false jumping two stages',()=>{
 const t=trip(),stops=Timeline.chain(t,routes,fences);
 Timeline.update(t,point(0,17.05),stops);
 Timeline.update(t,point(1,17.1),stops);
 const same=Timeline.update(t,point(2,17.1001),stops);
 assert.equal(same.window[1].state,'arrived');
 assert.equal(same.nextIndex,1);
});
test('missing geofence coordinates show unmapped stop rather than fake distance',()=>{
 const t=trip(),unmapped=Timeline.chain(t,[{id:'r1',loadName:'Start',offloadName:'Unknown'},{id:'r2',loadName:'Next',offloadName:'Other'}],[]);
 assert.equal(unmapped[0].locatable,false);
 Timeline.update(t,point(0,17.05),unmapped);
 assert.equal(t.gpsProgress.geofenceTimeline.toNextKm,null);
});
test('dispatch fallback remains a three-stop layout, with separate numeric journey progress',()=>{
 const t=trip();delete t.gpsProgress;
 assert.deepEqual(Display.windowFor(t,routes).map(x=>x.name),['Angermund loading','Otjiwarongo DC','Walvis DC']);
 const no=Display.kmProgress(t,1000);assert.equal(no.ready,false);assert.equal(no.total,1000);
});
test('only server-authorized GPS tracking updates circles; slip accounting stays trip linked',()=>{
 const src=fs.readFileSync('server.js','utf8'),js=fs.readFileSync('public/dispatch-ledger.js','utf8'),
 html=fs.readFileSync('public/index.html','utf8');
 assert.match(src,/TripGeofenceTimeline\.update\(trip,p,chain\)/);
 assert.match(src,/TripGps\.attach\(trip,p\)/);
 assert.match(src,/\.filter\(x=>x\.tripId===t\.id\)/);
 assert.match(js,/ledgerRollingGeofences\(t\)/);
 assert.match(js,/ledgerKilometreProgress\(t\)/);
 assert(html.indexOf('dispatch-geofence-progress.js')<html.indexOf('dispatch-ledger.js'));
});
