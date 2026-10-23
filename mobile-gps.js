'use strict';

// Replayed points belong to the trip at capture time, never a newly assigned trip.
function resolveMobileGps(body, user, trips, activeTrip, now=Date.now()) {
  const recordedAt=body.recordedAt?Date.parse(body.recordedAt):now;
  const latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(!Number.isFinite(recordedAt)||recordedAt>now+60000||now-recordedAt>7*86400000
    ||!Number.isFinite(latitude)||latitude < -90||latitude > 90
    ||!Number.isFinite(longitude)||longitude < -180||longitude > 180) {
    const e=Error('Invalid or expired GPS point');e.status=400;throw e;
  }
  const historical=now-recordedAt>120000;
  const requested=String(body.capturedTripId||'');
  const trip=requested?(trips||[]).find(t=>t.id===requested&&t.driverId===user.driverId):(!historical?activeTrip:null);
  return {trip,recordedAt:new Date(recordedAt).toISOString(),historical:historical||Boolean(trip&&trip.id!==activeTrip?.id)};
}
module.exports={resolveMobileGps};
