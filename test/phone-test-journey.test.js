const test=require('node:test'),assert=require('node:assert/strict');
const Journey=require('../phone-test-journey');
const origin={id:'depot',name:'Angermund Transport',latitude:0,longitude:0,radiusM:100};
const home={id:'home',name:'Home',latitude:0,longitude:0.02,radiusM:100};
const start=Date.parse('2026-10-23T10:00:00Z');
const at=i=>new Date(start+i*15000).toISOString();
const pos=(lon,i,accuracy=10)=>({latitude:0,longitude:lon,recordedAt:at(i),accuracy,source:'phone-test'});
const move=(s,lon,i,accuracy=10)=>Journey.advance(s,pos(lon,i,accuracy),origin,home,start+i*15000+1000);
test('test phone progresses only after depot exit and through 1km, 300m and two arrival fixes',()=>{
  let s=Journey.newJourney('Personal phone',origin,home,at(0));
  assert.equal(move(s,0.002,1).journey.status,'waiting','cannot mark departed without seeing depot');
  s=move(s,0,2).journey;assert.equal(s.status,'at_origin');
  s=move(s,0.002,3).journey;assert.equal(s.status,'at_origin','one outside fix must not depart');
  let x=move(s,0.002,4);s=x.journey;assert.equal(s.status,'departed');assert.deepEqual(x.events,['departed']);
  x=move(s,0.0125,5);s=x.journey;assert.equal(s.status,'approaching');assert(x.events.includes('approaching'));
  x=move(s,0.0175,6);s=x.journey;assert.equal(s.status,'arriving');assert(x.events.includes('arriving'));
  x=move(s,0.0195,7);s=x.journey;assert.equal(s.status,'arriving','300m warning is not delivery');
  x=move(s,0.0195,8);s=x.journey;assert.equal(s.status,'delivered');assert.deepEqual(x.events,['delivered']);
  assert.equal(move(s,0.01,9).events.length,0,'cannot repeat delivery');
});
test('rejects stale, inaccurate, duplicate, future or pre-start GPS fixes',()=>{
  let s=Journey.newJourney('Test',origin,home,at(0));
  const recent=move(s,0,1);s=recent.journey;
  assert.equal(move(s,0.004,1).journey.status,'at_origin');
  assert.equal(move(s,0.004,2,300).journey.status,'at_origin');
  assert.equal(Journey.advance(s,pos(0.004,3),origin,home,start+3*15000+181000).journey.status,'at_origin');
  assert.equal(Journey.advance(s,pos(0.004,4),origin,home,start+4*15000-70000).journey.status,'at_origin');
  assert.equal(Journey.advance(s,pos(0,-1),origin,home,start).journey.status,'at_origin');
});
test('arrival requires GPS precision and is never inferred from 300m distance alone',()=>{
  let s=Journey.newJourney('Test',origin,home,at(0));
  for(const [lon,i] of [[0,1],[0.002,2],[0.002,3],[0.0175,4]])s=move(s,lon,i).journey;
  assert.equal(s.status,'arriving');
  for(const i of [5,6,7])s=move(s,0.0197,i,80).journey;
  assert.equal(s.status,'arriving');
  s=move(s,0.0197,8,10).journey;
  assert.equal(s.status,'arriving');
  s=move(s,0.0197,9,10).journey;
  assert.equal(s.status,'delivered');
});
test('test creation rejects identical pins and stores no transport trip information',()=>{
  assert.throws(()=>Journey.newJourney('x',origin,origin),/different/);
  const j=Journey.newJourney('x',origin,home,at(0));
  assert.equal(j.tripId,undefined);assert.equal(j.truckId,undefined);
});

test('already-departed phone moves out of waiting after two accurate off-depot readings without returning',()=>{
  let s=Journey.newJourney('Phone already driving',origin,home,at(0));
  let result=move(s,0.009,1);s=result.journey;
  assert.equal(s.status,'waiting');assert.deepEqual(result.events,[]);
  result=move(s,0.010,2);s=result.journey;
  assert.equal(s.status,'departed');assert.deepEqual(result.events,['departed']);
  assert.equal(s.departureSource,'gps-already-away');
  result=move(s,0.0125,3);s=result.journey;
  assert.equal(s.status,'approaching');
  result=move(s,0.0175,4);assert.equal(result.journey.status,'arriving');
});
test('bad GPS or a reading back inside depot resets the pending departed evidence',()=>{
  let s=Journey.newJourney('Back and forth',origin,home,at(0));
  s=move(s,0.003,1).journey;
  assert.equal(s.departureFixes,1);
  s=move(s,0.003,2,300).journey;
  assert.equal(s.departureFixes,1,'poor accuracy is ignored');
  s=move(s,0,3).journey;
  assert.equal(s.departureFixes,0);assert.equal(s.status,'at_origin');
  s=move(s,0.003,4).journey;
  assert.equal(s.status,'at_origin');
  s=move(s,0.003,5).journey;
  assert.equal(s.status,'departed');
});
test('staff manual already-departed confirmation works only on an unfinished test',()=>{
  let s=Journey.newJourney('Test only',origin,home,at(0));
  const result=Journey.markAlreadyDeparted(s,at(2));
  assert.equal(result.journey.status,'departed');assert.deepEqual(result.events,['departed']);
  assert.equal(result.journey.departureSource,'manual-confirmed');
  assert.equal(result.journey.tripId,undefined);assert.equal(result.journey.truckId,undefined);
  assert.equal(Journey.markAlreadyDeparted(result.journey,at(3)).events.length,0);
  let x=move(result.journey,0.0176,4);
  assert.equal(x.journey.status,'arriving');assert(x.events.includes('approaching'));
  assert(x.events.includes('arriving'));
});
