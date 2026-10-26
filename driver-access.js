'use strict';
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
function taskVisible(t,u){
 if(t.assignedUserId)return t.assignedUserId===(u.sub||u.id);
 if(t.assignedDriverId)return Boolean(u.driverId&&t.assignedDriverId===u.driverId);
 return u.role!=='driver'&&String(t.ownerRole||'').toLowerCase()===u.role;
}
function notificationVisible(n,u){
 const uid=n.user_id||n.userId,did=n.driver_id||n.driverId;
 if(uid)return uid===(u.sub||u.id);
 if(did)return Boolean(u.driverId&&did===u.driverId);
 return u.role!=='driver'&&(!n.role||n.role===u.role);
}
function driverState(s,u){
 const out=Object.fromEntries(Object.keys(s).map(k=>[k,Array.isArray(s[k])?[]:{}]));
 const trips=(s.trips||[]).filter(t=>u.driverId&&t.driverId===u.driverId);
 const tripKeys='id number date plannedDropDate driverId truckId trailerId trailerIds routeId clientId load tons pallets status stage pod podUploadId podAt startedAt arrivedAt driverComplete driverAcceptedAt returnJourney depotArrival operationalCompletedAt phoneTracking gpsProgress geo carrierDetails'.split(' ');
 out.trips=trips.map(t=>({...pick(t,tripKeys),carrierDetails:t.carrierDetails?pick(t.carrierDetails,['origin','destination']):undefined,legs:(t.legs||[]).map(l=>pick(l,'id sequence label routeId clientId load tons pallets status pod podUploadId podAt startedAt arrivedAt geo'.split(' ')))}));
 const ids=key=>new Set(trips.flatMap(t=>[t[key],...(t.legs||[]).map(l=>l[key])]));
 out.drivers=(s.drivers||[]).filter(d=>u.driverId&&d.id===u.driverId).map(d=>pick(d,['id','name','status']));
 out.trucks=(s.trucks||[]).filter(x=>ids('truckId').has(x.id)).map(x=>pick(x,['id','fleetName','registration','status']));
 out.trailers=(s.trailers||[]).filter(x=>trips.some(t=>t.trailerId===x.id||t.trailerIds?.includes(x.id))).map(x=>pick(x,['id','registration']));
 out.routes=(s.routes||[]).filter(x=>ids('routeId').has(x.id)).map(x=>pick(x,'id name distance roundTrip loadLat loadLon offloadLat offloadLon loadName offloadName arrivalKm approachKm'.split(' ')));
 out.clients=(s.clients||[]).filter(x=>ids('clientId').has(x.id)).map(x=>pick(x,['id','name']));
 out.tasks=(s.tasks||[]).filter(t=>taskVisible(t,u));
 out.inspections=(s.inspections||[]).filter(x=>u.driverId&&x.driverId===u.driverId);
 out.settings={currentDriver:u.driverId||''};out.driverScoped=true;out.version=s.version;
 return out;
}
module.exports={taskVisible,notificationVisible,driverState};
