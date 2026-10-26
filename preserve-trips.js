'use strict';
// Bulk browser saves cannot delete a trip created on another tab/device.
// Intentional deletions use the dedicated record endpoint and deletion version.
function preserveTrips(incoming,current){
 if(!Array.isArray(incoming.trips))return;
 const ids=new Set(incoming.trips.map(t=>t.id)),retained=(current.trips||[]).filter(t=>!ids.has(t.id)&&(t.source==='manual'||t.createdBy&&/^trip_/.test(t.id)));
 incoming.trips.push(...structuredClone(retained));
 for(const key of ['routes','clients','trucks','drivers','trailers']){
  if(!Array.isArray(incoming[key]))continue;
  const have=new Set(incoming[key].map(x=>x.id));
  const field={routes:'routeId',clients:'clientId',trucks:'truckId',drivers:'driverId',trailers:'trailerId'}[key];
  const needed=new Set(retained.flatMap(t=>[t[field],...(t.legs||[]).map(l=>l[field]),...(key==='trailers'?t.trailerIds||[]:[])]));
  incoming[key].push(...structuredClone((current[key]||[]).filter(x=>needed.has(x.id)&&!have.has(x.id))));
 }
}
module.exports={preserveTrips};
