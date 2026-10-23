'use strict';
const Lifecycle=require('./public/trip-lifecycle');
function setTracking(state,tripId,driverId,active,at=new Date().toISOString()){
  if(!driverId){const e=Error('Link this account to a driver first');e.status=403;throw e}
  const trip=(state.trips||[]).find(t=>t.id===tripId);
  if(!trip||trip.driverId!==driverId){const e=Error('This trip is not assigned to you');e.status=403;throw e}
  if(active&&(Lifecycle.completed(trip)||/cancelled/i.test(trip.status||''))){const e=Error('This journey is already complete or cancelled');e.status=400;throw e}
  if(active)for(const other of state.trips||[])if(other.id!==tripId&&other.phoneTracking?.driverId===driverId&&other.phoneTracking.active)
    other.phoneTracking={...other.phoneTracking,active:false,stoppedAt:at};
  trip.phoneTracking={...trip.phoneTracking,active:Boolean(active),driverId,updatedAt:at,
    ...(active?{startedAt:at}:{stoppedAt:at})};
  return trip;
}
function permitsPoint(trip,user,point){
  const session=trip?.phoneTracking,at=Date.parse(point.recordedAt);
  return Boolean(session?.active&&session.driverId===user.driverId&&trip.driverId===user.driverId
    &&!Lifecycle.completed(trip)&&!/cancelled/i.test(trip.status||'')&&Number.isFinite(at)&&at>=Date.parse(session.startedAt)
    &&Number.isFinite(Number(point.accuracy))&&point.accuracy!=null&&Number(point.accuracy)<=100);
}
module.exports={setTracking,permitsPoint};
