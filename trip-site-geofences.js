'use strict';
const key=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const isTown=f=>/^Route town\s*[·:]/i.test(f?.name||'');
function exactFence(fences,name){
  const matches=(fences||[]).filter(f=>f.active!==false&&!isTown(f)&&key(f.name)===key(name));
  return matches.length===1?matches[0]:null;
}
function sites(state){
  const rows=new Map();
  for(const trip of state.trips||[]) {
    if(trip.depotArrival?.at||/cancelled/i.test(trip.status||''))continue;
    const legs=trip.legs?.length?trip.legs:[{routeId:trip.routeId,id:''}];
    for(const leg of legs){
      if(leg.cancelled||/cancelled/i.test(leg.status||''))continue;
      const route=(state.routes||[]).find(r=>r.id===leg.routeId)||{},carrier=trip.carrierDetails||{};
      for(const kind of ['loading','offloading']){
        const prefix=kind==='loading'?'load':'offload',source=kind==='loading'?carrier.origin:carrier.destination;
        const name=String(route[prefix+'Name']||source?.name||'').trim();if(!name)continue;
        const id=route.id+':'+kind;
        if(!rows.has(id))rows.set(id,{id,routeId:route.id,kind,name,city:key(source?.name)===key(name)?source?.city||'':'',country:key(source?.name)===key(name)?source?.country||'':'',address:key(source?.name)===key(name)?source?.address||'':'',trips:[],fenceId:leg[kind+'GeofenceId']||trip[kind+'GeofenceId']||''});
        const row=rows.get(id);if(!row.trips.includes(trip.number))row.trips.push(trip.number);
      }
    }
  }
  return [...rows.values()];
}
function applyFence(state,routeId,kind,fence){
  if(!['loading','offloading'].includes(kind)||!fence||fence.active===false||isTown(fence))throw Error('Choose an active loading/offloading site geofence');
  const route=(state.routes||[]).find(r=>r.id===routeId);if(!route)throw Error('Route not found');
  const prefix=kind==='loading'?'load':'offload';
  route[prefix+'Lat']=Number(fence.latitude);route[prefix+'Lon']=Number(fence.longitude);
  route[kind+'GeofenceId']=fence.id;
  for(const t of state.trips||[]){
    if(t.depotArrival?.at)continue;
    if(t.routeId===routeId){t[kind+'GeofenceId']=fence.id;t[kind+'GeofenceName']=fence.name}
    for(const leg of t.legs||[])if(leg.routeId===routeId){leg[kind+'GeofenceId']=fence.id;leg[kind+'GeofenceName']=fence.name}
  }
}
function reuseSaved(state,fences){
  let linked=0;
  for(const s of sites(state)){
    const r=(state.routes||[]).find(r=>r.id===s.routeId);if(!r)continue;
    const explicit=(fences||[]).find(f=>f.id===(r[s.kind+'GeofenceId']||s.fenceId)&&f.active!==false&&!isTown(f));
    const prefix=s.kind==='loading'?'load':'offload',lat=Number(r[prefix+'Lat']),lon=Number(r[prefix+'Lon']),hasPoint=Number.isFinite(lat)&&Number.isFinite(lon)&&!(lat===0&&lon===0);
    const exact=exactFence(fences,s.name);
    const match=explicit||(!hasPoint?exact:(exact&&Math.abs(Number(exact.latitude)-lat)<.002&&Math.abs(Number(exact.longitude)-lon)<.002?exact:null));if(!match)continue;
    if(s.fenceId===match.id&&Number(r[prefix+'Lat'])===Number(match.latitude)&&Number(r[prefix+'Lon'])===Number(match.longitude))continue;
    applyFence(state,s.routeId,s.kind,match);linked++;
  }
  return linked;
}
module.exports={key,isTown,exactFence,sites,applyFence,reuseSaved};
