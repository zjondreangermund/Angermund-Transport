'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),M=require('../public/trip-metrics');
test('Durban return: final 500km counts without another diesel purchase',()=>{
 const trip={id:'durban',truckId:'ang10',startKm:100000,endKm:103000,distance:2800};
 const diesel=[{id:'s1',tripId:'durban',odometer:101700,litres:400},{id:'s2',tripId:'durban',odometer:102500,litres:250}];
 const snapshot=JSON.stringify(diesel),r=M.lastRefillRemainder(trip,diesel);
 assert.equal(M.distance(trip).distance,3000);
 assert.equal(r.ready,true);assert.equal(r.km,500);assert.equal(r.lastSlipOdometer,102500);
 assert.equal(r.closingOdometer,103000);assert.equal(r.estimatedEnd,false);
 assert.equal(r.estimatedLitres,227.27);
 assert.equal(diesel.length,2);assert.equal(JSON.stringify(diesel),snapshot);
});
test('Excel/route distance may estimate the final refuelling-to-depot leg but never invent odometers',()=>{
 const trip={id:'durban',startKm:100000,legs:[{distance:1700},{distance:1300}]};
 const r=M.lastRefillRemainder(trip,[{odometer:102500,litres:250}]);
 assert.equal(r.ready,true);assert.equal(r.km,500);assert.equal(r.estimatedEnd,true);assert.equal(trip.endKm,undefined);
 assert.equal(M.distance(trip).distance,3000);
});
test('trip-linked slips only: later other-trip refills do not distort the previous return',()=>{
 const a={id:'a',startKm:1000,endKm:2000},aFuel=[{tripId:'a',odometer:1500,litres:200}];
 assert.equal(M.lastRefillRemainder(a,aFuel).km,500);
 assert.equal(M.lastRefillRemainder(a,[...aFuel,{tripId:'b',odometer:2100,litres:100}]).km,500);
});
test('missing depot reading and mismatched diesel odometers get clear diagnostics',()=>{
 assert.match(M.lastRefillRemainder({id:'x'},[{odometer:8000}]).reason,/Enter depot arrival/);
 assert.match(M.lastRefillRemainder({id:'x',startKm:1000,endKm:1500},[{odometer:1600}]).reason,/exceeds/);
 assert.match(M.lastRefillRemainder({id:'x',startKm:1000,endKm:1500},[{litres:300}]).reason,/No diesel slip odometer/);
});
test('server has reverted to per-trip receipts, preserves locked payslips and supports depot closing odo',()=>{
 const src=fs.readFileSync('server.js','utf8');
 assert.match(src,/function serverFuelMetrics\(state,t\)\{return TripMetrics\.fuel\(t,\(state\.diesel\|\|\[\]\)\.filter\(x=>x\.tripId===t\.id\)\)\}/);
 assert.match(src,/const efficiency=serverFuelMetrics\(state,t\)\.kmPerL/);
 assert.doesNotMatch(src,/TruckFuelIntervals/);
 assert.match(src,/app\.patch\('\/api\/admin\/trips\/:tripId\/closing-odometer'/);
 assert.match(src,/if\(existing&&\['Approved','Paid'\]\.includes\(existing\.status\)\)/);
});
