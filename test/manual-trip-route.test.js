'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {manualRoute,MANUAL_ROUTE_ID}=require('../manual-trip-route');
test('manual route supports typed route names and route distance in same trip',()=>{
 const r=manualRoute({manualRouteName:'Windhoek → Tsandi',manualRouteDistance:'710',manualRouteNamibiaKm:'710',manualRouteFrom:'Windhoek',manualRouteTo:'Tsandi',manualRouteRoundTrip:'false'},[],()=> 'rte_new');
 assert.equal(MANUAL_ROUTE_ID,'__manual__');assert.equal(r.id,'rte_new');assert.equal(r.name,'Windhoek → Tsandi');
 assert.equal(r.distance,710);assert.equal(r.namibiaKm,710);assert.equal(r.loadName,'Windhoek');assert.equal(r.offloadName,'Tsandi');
 assert.equal(r.roundTrip,false);
});
test('manual route may be created without measured distance, then completed later',()=>{
 const r=manualRoute({manualRouteName:'Walvis Bay > Oshakati',manualRouteDistance:''},[],()=> 'rte_new');
 assert.equal(r.distance,0);assert.equal(r.namibiaKm,0);
});
test('manual route rejects duplicates, missing names and invalid distances',()=>{
 assert.throws(()=>manualRoute({manualRouteName:'Windhoek Oshakati'},[{name:' WINDHOEK OSHAKATI '}]),/already exists/);
 assert.throws(()=>manualRoute({manualRouteName:''}),/Enter a route name/);
 assert.throws(()=>manualRoute({manualRouteName:'Windhoek → Rehoboth',manualRouteDistance:'-2'}),/between 0/);
 assert.throws(()=>manualRoute({manualRouteName:'Windhoek → Rehoboth',manualRouteDistance:'50',manualRouteNamibiaKm:'85'}),/cannot exceed/);
 assert.throws(()=>manualRoute({manualRouteName:'Windhoek → Rehoboth',manualRouteDistance:'0',manualRouteNamibiaKm:'85'}),/total route/);
});
test('supports round-trip and cross-border selections with an explicit Namibia km value',()=>{
 const r=manualRoute({manualRouteName:'Durban to Windhoek',manualRouteDistance:1700,manualRouteNamibiaKm:950,manualRouteRoundTrip:'true',manualRouteCrossBorder:'true'});
 assert.equal(r.roundTrip,true);assert.equal(r.crossBorder,true);
 assert.equal(r.namibiaKm,950);assert.equal(r.distance,1700);
});
