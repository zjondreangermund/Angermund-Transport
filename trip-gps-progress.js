'use strict';
// Only server-authorized, assigned trip fixes contribute to the GPS travel ledger.
// Cumulative GPS distance is point-to-point (not a routing engine estimate).
const metres=(a,b)=>{
 const lat=x=>Number(x.latitude)*Math.PI/180,lon=x=>Number(x.longitude)*Math.PI/180;
 const dLat=lat(b)-lat(a),dLon=lon(b)-lon(a);
 const h=Math.sin(dLat/2)**2+Math.cos(lat(a))*Math.cos(lat(b))*Math.sin(dLon/2)**2;
 return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
};
function valid(p,now=Date.now()){
 const lat=Number(p?.latitude),lon=Number(p?.longitude),at=Date.parse(p?.recordedAt);
 const phone=p?.source==='android-background',goodSource=['android-background','driver','telematics','truck-device','tracker','vehicle-tracker'].includes(String(p?.source||''));
 const accuracy=p?.accuracy==null?(!phone?35:Infinity):Number(p.accuracy);
 return goodSource&&Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lon)&&Math.abs(lon)<=180
  &&!(lat===0&&lon===0)&&Number.isFinite(at)&&at<=now+60000&&now-at<7*86400000&&accuracy>=0&&accuracy<=75;
}
function attach(trip,p,now=Date.now()){
 if(!trip||String(trip.truckId||'')!==String(p.vehicleId||'')||!valid(p,now))return false;
 const gps=trip.gpsProgress||{},at=Date.parse(p.recordedAt),old=gps.lastFix,prior=Date.parse(old?.recordedAt||'');
 if(old&&at<=prior)return false; // idempotent and out-of-order replay safe
 const fresh={latitude:Number(p.latitude),longitude:Number(p.longitude),recordedAt:p.recordedAt,accuracy:p.accuracy==null?null:Number(p.accuracy),source:p.source};
 const start=Date.parse(trip.startedAt||trip.phoneTracking?.startedAt||''),startKnown=Number.isFinite(start);
 if(startKnown&&at<start-300000)return false;
 const progress={...gps,points:Number(gps.points||0)+1,observedKm:Number(gps.observedKm||0),gaps:Number(gps.gaps||0),
   rejectedJumps:Number(gps.rejectedJumps||0),firstAt:gps.firstAt||p.recordedAt,lastAt:p.recordedAt,lastFix:fresh};
 if(!gps.firstAt&&startKnown&&at-start>5*60000)progress.gaps+=1;
 if(old){
  const delta=(at-prior)/1000,move=metres(old,fresh),speed=delta>0?move/delta*3.6:Infinity;
  if(delta>600)progress.gaps+=1;
  else if(delta>0&&move>=20&&speed>150){progress.rejectedJumps+=1;progress.gaps+=1}
  else if(delta>0&&move<5000&&speed<=150)progress.observedKm=Number((progress.observedKm+move/1000).toFixed(3));
 }
 // Needs uninterrupted tracking from start until depot arrival, never just a single
 // good fix. A weak/partial trail is visible but cannot override trip odometers.
 trip.gpsProgress=progress;return true;
}
function reliable(trip,now=Date.now()){
 const g=trip?.gpsProgress||{},first=Date.parse(g.firstAt),last=Date.parse(g.lastAt),start=Date.parse(trip?.startedAt||trip?.phoneTracking?.startedAt||''),
   end=Date.parse(trip?.depotArrival?.at||'');
 const startOk=Number.isFinite(start)&&Number.isFinite(first)&&Math.abs(first-start)<=5*60000;
 const endOk=Number.isFinite(end)&&Number.isFinite(last)&&Math.abs(end-last)<=5*60000;
 return Number(g.points)>=12&&Number(g.observedKm)>=1&&Number(g.gaps||0)===0&&Number(g.rejectedJumps||0)===0&&startOk&&endOk;
}
function target(trip,route,depot,point){
 if(!point)return null;
 const legs=trip?.legs?.length?trip.legs:[],leg=legs.find(l=>!['Delivered','Invoiced','Closed'].includes(l.status))||legs.at(-1)||trip;
 const returning=Boolean(trip?.returnJourney?.startedAt)||/return/i.test(String(trip?.status||''));
 const coords=(lat,lon,name,kind)=>{
  const latitude=Number(lat),longitude=Number(lon);
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&!(latitude===0&&longitude===0)?{latitude,longitude,name,kind}:null;
 };
 const home=depot?coords(depot.latitude,depot.longitude,depot.name||'Angermund depot','depot'):null;
 let dest=null;
 if(returning||/delivered/i.test(String(trip?.status||'')))dest=home;
 else if(!trip?.startedAt&&!/in transit|at offloading/i.test(String(trip?.status||'')))
  dest=coords(route?.loadLat,route?.loadLon,route?.loadName||'Loading geofence','loading');
 else dest=coords(route?.offloadLat,route?.offloadLon,route?.offloadName||'Offloading geofence','offloading');
 return dest?{next:dest.name,kind:dest.kind,toNextKm:Number((metres(point,dest)/1000).toFixed(2)),unit:'straight-line GPS distance',legId:leg?.id||null}:null;
}
function navigation(trip,route,depot,p){
 const g=trip?.gpsProgress;if(!g)return null;
 const next=target(trip,route,depot,p);if(!next)return null;
 const previous=g.navigation;
 const changed=previous?.next!==next.next||previous?.legId!==next.legId||previous?.kind!==next.kind;
 // Distances already covered inside a leg remain; reset at a new geofence segment.
 const fromKm=changed?0:Number(g.observedKm||0)-Number(previous?.segmentStartKm||0);
 const item={...next,fromPreviousKm:Number(Math.max(0,fromKm).toFixed(2)),
   previous:changed?(previous?.next||'Trip departure'):previous?.previous||'Trip departure',
   segmentStartKm:changed?Number(g.observedKm||0):Number(previous?.segmentStartKm||0),
   updatedAt:p.recordedAt};
 g.navigation=item;return item;
}
function rebuild(trip,points,route=null,depot=null){
 const ordered=[...(points||[])].sort((a,b)=>Date.parse(a.recordedAt)-Date.parse(b.recordedAt));
 const copy={...trip};delete copy.gpsProgress;
 for(const p of ordered){
  if(String(p.tripId||'')!==String(trip.id)||String(p.vehicleId||trip.truckId)!==String(trip.truckId))continue;
  attach(copy,p,Date.parse(p.recordedAt)+1000);
 }
 if(copy.gpsProgress?.lastFix)navigation(copy,route,depot,copy.gpsProgress.lastFix);
 return copy.gpsProgress||null;
}
module.exports={metres,valid,attach,reliable,target,navigation,rebuild};
