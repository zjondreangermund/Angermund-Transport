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

function lastRefillRemainder(t={},records=[],kmPerL=2.2){
 // The last purchase does not end the journey. Depot/return odometer is a
 // separate observation, and the unrefuelled distance must not create a receipt.
 const end=n(t.endKm),start=n(t.startKm),journey=distance(t);
 const estimatedEnd=!end&&start>0&&journey.distance>0;
 const closingOdo=end>0?end:(estimatedEnd?start+journey.distance:0);
 const readings=records.map(r=>n(r.odometer)).filter(v=>v>0).sort((a,b)=>a-b);
 const lastSlipOdometer=readings[readings.length-1]||0;
 const unready=(reason)=>({ready:false,reason,km:0,lastSlipOdometer,closingOdometer:closingOdo||0,estimatedEnd,estimatedLitres:null});
 if(!readings.length)return unready('No diesel slip odometer recorded on this trip');
 if(!closingOdo)return unready('Enter depot arrival odometer, or trip start odometer with a route/Excel distance');
 if(start>0&&closingOdo<=start)return unready('Closing odometer must exceed trip start odometer');
 if(lastSlipOdometer>closingOdo)return unready('Last diesel slip odometer exceeds the closing odometer: check the readings or trip link');
 if(start>0&&lastSlipOdometer<start)return unready('Last diesel slip odometer is before this trip started: check the trip link');
 const km=Number((closingOdo-lastSlipOdometer).toFixed(2));
 const rate=n(kmPerL)>0?n(kmPerL):2.2;
 return{ready:true,reason:'',km,lastSlipOdometer,closingOdometer:closingOdo,estimatedEnd,
   estimatedLitres:Number((km/rate).toFixed(2)),estimateKmPerL:rate,
   distanceSource:estimatedEnd?'Trip start + saved route/Excel distance (estimate)':'Depot arrival odometer'};
}
const api={distance,fuel,lastRefillRemainder};if(typeof module==='object'&&module.exports)module.exports=api;else root.TripMetrics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
