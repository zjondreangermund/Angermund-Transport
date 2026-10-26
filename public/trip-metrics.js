(function(root){
'use strict';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
function gpsReliable(t={}){
 const g=t.gpsProgress||{},first=Date.parse(g.firstAt),last=Date.parse(g.lastAt),
 start=Date.parse(t.startedAt||t.phoneTracking?.startedAt||''),end=Date.parse(t.depotArrival?.at||'');
 // Before adopting GPS for finance, cross-check against an independent
 // odometer/Excel/route baseline when available. A partial path must not
 // replace a 3,000 km journey with 30 km after a GPS restart.
 const a=n(t.startKm),b=n(t.endKm),legs=Array.isArray(t.legs)?t.legs:[],
 baseline=a>0&&b>a?b-a:(legs.length&&legs.every(l=>n(l.distance)>0)?
   legs.reduce((x,l)=>x+n(l.distance),0):n(t.distance));
 const consistent=!baseline||(n(g.observedKm)>=baseline*.65&&n(g.observedKm)<=baseline*1.5);
 return consistent&&n(g.points)>=12&&n(g.observedKm)>=1&&n(g.gaps)===0&&n(g.rejectedJumps)===0
  &&Number.isFinite(start)&&Number.isFinite(first)&&Math.abs(first-start)<=300000
  &&Number.isFinite(end)&&Number.isFinite(last)&&Math.abs(end-last)<=300000;
}
function dieselOdometerDistance(t={},records=[]){
 // A diesel slip is an observation, not proof that the entire trip began or
 // ended there. Never treat a single isolated slip as a full journey distance.
 const start=n(t.startKm),end=n(t.endKm);
 const values=(records||[]).filter(r=>(!t.id||!r.tripId||String(r.tripId)===String(t.id))
   &&(!t.truckId||!r.truckId||String(r.truckId)===String(t.truckId))
   &&(!t.driverId||!r.driverId||String(r.driverId)===String(t.driverId)))
  .map(r=>n(r.odometer)).filter(v=>v>0).sort((a,b)=>a-b);
 const first=values[0]||0,last=values[values.length-1]||0;
 if(!values.length)return null;
 // Inconsistent readings require review; do not manufacture distance.
 if(start>0&&first<start||end>0&&last>end||start>0&&end>0&&end<=start)return null;
 let km=0,source='';
 if(start>0&&last>start){km=last-start;source='Departure to last diesel odometer'}
 else if(end>0&&first>0&&end>first){km=end-first;source='First diesel odometer to trip arrival'}
 else if(values.length>=2&&last>first){km=last-first;source='Between diesel slip odometers'}
 if(!(km>0)||km>20000)return null;
 return{distance:Number(km.toFixed(2)),distanceSource:source+' (confirmed portion only)',estimated:true,partial:true,
   odometerReadings:values.length,firstDieselOdometer:first,lastDieselOdometer:last};
}
function distance(t={},records=[]){
 if(gpsReliable(t))return{distance:n(t.gpsProgress.observedKm),distanceSource:'Verified continuous GPS',estimated:false,partial:false};
 const start=n(t.startKm),end=n(t.endKm);
 if(start>0&&end>start)return{distance:end-start,distanceSource:'Odometer',estimated:false,partial:false};
 const legs=Array.isArray(t.legs)?t.legs:[],complete=legs.length&&legs.every(l=>n(l.distance)>0);
 const km=complete?legs.reduce((s,l)=>s+n(l.distance),0):n(t.distance);
 if(km>0)return{distance:Math.max(0,km),distanceSource:'Saved journey distance (estimate)',estimated:true,partial:false};
 return dieselOdometerDistance(t,records)||{distance:0,distanceSource:'Missing distance',estimated:false,partial:false};
}
function fuel(t,records=[]){
 const d=distance(t,records),litres=records.reduce((s,r)=>s+n(r.litres),0),cost=r=>n(r.printedTotal)||n(r.total)||n(r.litres)*n(r.price),spend=records.reduce((s,r)=>s+cost(r),0),ready=d.distance>0&&litres>0&&!d.partial;
 const reason=!t?.id?'No linked trip':!d.distance?'Enter trip distance or valid start/end odometers':d.partial?'Only a portion of the trip is confirmed by diesel odometers; enter final depot odometer, GPS or complete Excel/route distance':!litres?'No linked diesel litres':'';
 return{...d,litres,spend,ready,reason,kmPerL:ready?d.distance/litres:0,litresPerKm:ready?litres/d.distance:0,litresPer100Km:ready?100*litres/d.distance:0,costPerKm:d.distance>0?spend/d.distance:0,pricePerL:litres>0&&records.every(r=>cost(r)>0)?spend/litres:0};
}

function lastRefillRemainder(t={},records=[],kmPerL=2.2){
 // The last purchase does not end the journey. Depot/return odometer is a
 // separate observation, and the unrefuelled distance must not create a receipt.
 const end=n(t.endKm),start=n(t.startKm),journey=distance(t);
 const estimatedEnd=!end&&start>0&&journey.distance>0&&!journey.partial;
 const closingOdo=end>0?end:(estimatedEnd?start+journey.distance:0);
 const readings=records.filter(r=>!t.id||!r.tripId||String(r.tripId)===String(t.id)).map(r=>n(r.odometer)).filter(v=>v>0).sort((a,b)=>a-b);
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
   distanceSource:estimatedEnd?(gpsReliable(t)?'Trip start + continuous GPS distance (estimated odometer)':'Trip start + saved route/Excel distance (estimate)'):'Depot arrival odometer'};
}
const api={distance,fuel,lastRefillRemainder,gpsReliable,dieselOdometerDistance};if(typeof module==='object'&&module.exports)module.exports=api;else root.TripMetrics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
