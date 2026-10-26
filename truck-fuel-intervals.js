'use strict';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const cost=r=>n(r.printedTotal)||n(r.total)||n(r.litres)*n(r.price);
const date=r=>String(r.date||r.createdAt||'').slice(0,10);
function truckFuel(state,truckId){
 const rows=(state.diesel||[]).filter(r=>{
  const trip=(state.trips||[]).find(t=>t.id===r.tripId);
  return String(r.truckId||trip?.truckId||'')===String(truckId);
 }).sort((a,b)=>date(a).localeCompare(date(b))||n(a.odometer)-n(b.odometer));
 const valid=rows.filter(r=>n(r.odometer)>0&&n(r.litres)>0);
 const full=r=>r.fullTank===true||r.fullTank==='true'||r.fillType==='Full'||r.tankFull===true;
 const fullFills=valid.filter(full),intervals=[];
 for(let i=1;i<fullFills.length;i++){
  const from=fullFills[i-1],to=fullFills[i],distance=n(to.odometer)-n(from.odometer);
  if(distance<=0||distance>10000)continue;
  const fills=valid.filter(r=>n(r.odometer)>n(from.odometer)&&n(r.odometer)<=n(to.odometer));
  const litres=fills.reduce((sum,r)=>sum+n(r.litres),0);
  if(!litres)continue;
  intervals.push({startOdometer:n(from.odometer),endOdometer:n(to.odometer),distance,litres,kmPerL:distance/litres,cost:fills.reduce((sum,r)=>sum+cost(r),0)});
 }
 return{truckId,records:rows.length,intervals,latest:intervals.at(-1)||null,reason:intervals.length?'':'Full-tank odometer readings required at both ends of an interval'};
}
function estimateTripFuel(state,trip){
 const d=require('./public/trip-metrics').distance(trip).distance,m=truckFuel(state,trip.truckId),interval=m.latest;
 return{distance:d,estimatedCost:interval&&d?Number((d*interval.cost/interval.distance).toFixed(2)):null,estimatedLitres:interval&&d?Number((d*interval.litres/interval.distance).toFixed(2)):null,source:interval?'Truck full-to-full interval (estimate)':'Pending verified full-to-full truck fuel interval',interval};
}
module.exports={truckFuel,estimateTripFuel};
