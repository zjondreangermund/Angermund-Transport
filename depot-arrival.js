'use strict';
const Lifecycle=require('./public/trip-lifecycle');
function isCompanyDepot(f){return f?.active!==false&&(/angermund|company\s*depot|main\s*depot|home\s*yard/i.test(f.name||'')||f.angermundDepot===true)}
function canConfirmGps(pos,previous,depot,trip,inside,now=Date.now()){
 const phone=String(pos?.source||'').toLowerCase()==='android-background';
 if(phone&&(!trip?.phoneTracking?.active||trip.phoneTracking.driverId!==pos.driverId||pos.tripId!==trip.id||Date.parse(pos.recordedAt)<Date.parse(trip.phoneTracking.startedAt)))return false;
 if(!['telematics','truck-device','tracker','vehicle-tracker','android-background'].includes(String(pos?.source||'').toLowerCase())||!isCompanyDepot(depot)||Lifecycle.completed(trip)||!Lifecycle.delivered(trip))return false;
 const at=Date.parse(pos.recordedAt),prior=Date.parse(previous?.recordedAt);if(!Number.isFinite(at)||!Number.isFinite(prior)||at>now+60000||now-at>15*60000||at<=prior||at-prior>5*60000)return false;
 if(pos.accuracy!=null&&Number(pos.accuracy)>Math.min(100,Math.max(5,Number(depot.radiusM||depot.radius_m)||500)))return false;
 const deliveredAt=Date.parse(trip.returnJourney?.startedAt||trip.arrivedAt||Lifecycle.legs(trip).at(-1)?.arrivedAt||trip.geo?.offloadArrivedAt||trip.startedAt||trip.date);if(Number.isFinite(deliveredAt)&&at<deliveredAt)return false;
 if(phone&&(previous.source!=='android-background'||previous.accuracy==null||Number(previous.accuracy)>100||previous.tripId!==trip.id||previous.driverId!==pos.driverId||prior<Date.parse(trip.phoneTracking.startedAt)))return false;
 return inside(pos,depot)&&inside(previous,depot);
}
function releaseVehicle(state,t){
 const other=(state.trips||[]).some(x=>x.id!==t.id&&x.truckId===t.truckId&&!Lifecycle.completed(x)&&!/cancelled/i.test(x.status||'')&&(x.startedAt||Number(x.stage)>=2));
 if(!other){const tr=(state.trucks||[]).find(x=>x.id===t.truckId);if(tr&&!/workshop|maintenance|repair|out of service/i.test(tr.status||''))tr.status='Available'}
 const dr=(state.drivers||[]).find(x=>x.id===t.driverId);if(dr&&!(state.trips||[]).some(x=>x.id!==t.id&&x.driverId===t.driverId&&!Lifecycle.completed(x)&&(x.startedAt||Number(x.stage)>=2)))dr.status='Available';
}
function protectServerArrival(incoming,current){for(const t of incoming.trips||[]){const old=(current.trips||[]).find(x=>x.id===t.id);for(const key of ['depotArrival','operationalCompletedAt','returnJourney','phoneTracking','gpsProgress']){if(old?.[key])t[key]=structuredClone(old[key]);else delete t[key]}if(!Lifecycle.completed(t)){t.driverComplete=false;delete t.driverCompletedAt}}}
module.exports={isCompanyDepot,canConfirmGps,releaseVehicle,protectServerArrival};
