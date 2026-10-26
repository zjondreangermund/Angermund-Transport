'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Fuel=require('../truck-fuel-intervals');
test('truck full-to-full spans several trips and partial diesel purchases',()=>{
 const s={trips:[{id:'a',truckId:'truck',distance:400},{id:'b',truckId:'truck',distance:400},{id:'c',truckId:'truck',distance:250}],diesel:[
 {id:'d1',truckId:'truck',tripId:'a',date:'2026-10-01',odometer:150000,litres:300,fullTank:true,total:7500},
 {id:'d2',truckId:'truck',tripId:'b',date:'2026-10-02',odometer:150500,litres:100,total:2500},
 {id:'d3',truckId:'truck',tripId:'c',date:'2026-10-03',odometer:151050,litres:350,fullTank:true,total:8750}
 ]};
 const r=Fuel.truckFuel(s,'truck');assert.equal(r.latest.distance,1050);assert.equal(r.latest.litres,450);
 const a=Fuel.estimateTripFuel(s,s.trips[0]),b=Fuel.estimateTripFuel(s,s.trips[1]);assert.equal(a.distance,400);assert.equal(b.distance,400);assert.equal(a.estimatedCost,b.estimatedCost);
});
test('truck receipts with no confirmed full-tank endpoints remain pending',()=>{
 const s={trips:[],diesel:[{truckId:'ang10',litres:100,odometer:1000},{truckId:'ang10',litres:200,odometer:1500}]};
 assert.equal(Fuel.truckFuel(s,'ang10').latest,null);
});
test('receipts with only old trip IDs still resolve truck without changing trip assignment',()=>{
 const s={trips:[{id:'old',truckId:'ang10'}],diesel:[{tripId:'old',litres:200}]};assert.equal(Fuel.truckFuel(s,'ang10').records,1);
});
