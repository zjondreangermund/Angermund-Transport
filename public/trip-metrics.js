(function(root){
'use strict';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
function distance(t={}){
 const start=n(t.startKm),end=n(t.endKm);
 if(start>0&&end>start)return{distance:end-start,distanceSource:'Odometer',estimated:false};
 const legs=Array.isArray(t.legs)?t.legs:[],complete=legs.length&&legs.every(l=>n(l.distance)>0);
 const km=complete?legs.reduce((s,l)=>s+n(l.distance),0):n(t.distance);
 return{distance:Math.max(0,km),distanceSource:km>0?'Saved journey distance (estimate)':'Missing distance',estimated:km>0};
}
function fuel(t,records=[]){
 const d=distance(t),litres=records.reduce((s,r)=>s+n(r.litres),0),cost=r=>n(r.printedTotal)||n(r.total)||n(r.litres)*n(r.price),spend=records.reduce((s,r)=>s+cost(r),0),ready=d.distance>0&&litres>0;
 const reason=!t?.id?'No linked trip':!d.distance?'Enter trip distance or valid start/end odometers':!litres?'No linked diesel litres':'';
 return{...d,litres,spend,ready,reason,kmPerL:ready?d.distance/litres:0,litresPerKm:ready?litres/d.distance:0,litresPer100Km:ready?100*litres/d.distance:0,costPerKm:d.distance>0?spend/d.distance:0,pricePerL:litres>0&&records.every(r=>cost(r)>0)?spend/litres:0};
}
const api={distance,fuel};if(typeof module==='object'&&module.exports)module.exports=api;else root.TripMetrics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
