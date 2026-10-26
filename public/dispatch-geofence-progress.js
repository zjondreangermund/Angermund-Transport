(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.AngermundDispatchGeofences=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const n=v=>Number.isFinite(Number(v))?Number(v):0;
 const label=x=>String(x||'').trim();
 function stops(trip,routes=[]){
  const legs=Array.isArray(trip?.legs)&&trip.legs.length?
   [...trip.legs].filter(l=>!l.cancelled&&!/cancelled/i.test(l.status||'')).sort((a,b)=>n(a.sequence)-n(b.sequence)):
   [{routeId:trip?.routeId}];
  const out=[];
  for(const leg of legs){
   const r=routes.find(x=>String(x.id)===String(leg.routeId))||{};
   const endpoints=String(r.name||'').split(/→|↔|->|–/).map(label).filter(Boolean);
   const load=label(leg.loadingGeofenceName||r.loadName||endpoints[0]||'Loading point');
   const off=label(leg.offloadingGeofenceName||r.offloadName||endpoints.at(-1)||'Offloading point');
   for(const [name,kind] of [[load,'loading'],[off,'offloading']]){
    if(out.at(-1)?.name?.toLowerCase()!==name.toLowerCase())out.push({name,kind,state:'upcoming'});
   }
  }
  out.push({name:'Angermund depot',kind:'depot',state:'upcoming'});
  return out;
 }
 function windowFor(trip,routes=[]){
  const live=trip?.gpsProgress?.geofenceTimeline?.window;
  if(Array.isArray(live)&&live.length===3)return live.map(x=>({name:label(x.name),kind:label(x.kind),state:label(x.state)}));
  const stopsList=stops(trip,routes);
  const first=stopsList[0]||{name:'Departure',kind:'loading'};
  const second=stopsList[1]||{name:'Next geofence',kind:'offloading'};
  const third=stopsList[2]||{name:'Depot / complete',kind:'depot'};
  return [{...first,state:'starting'},{...second,state:'next'},{...third,state:'upcoming'}];
 }
 function kmProgress(trip,totalKm){
  const g=trip?.gpsProgress,observed=n(g?.observedKm),total=Math.max(0,n(totalKm));
  const completed=Boolean(trip?.depotArrival?.at),verified=Boolean(g?.points>=12&&!g?.gaps&&!g?.rejectedJumps&&completed);
  if(total<=0)return{ready:false,travelled:observed,remaining:null,percent:0,verified:false};
  const hasGps=Number(g?.points)>0;
  const travelled=completed&&!hasGps?total:Math.min(total,observed);
  return{ready:hasGps||completed,total,travelled:Number(travelled.toFixed(1)),remaining:Number(Math.max(0,total-travelled).toFixed(1)),
   percent:Number(Math.min(100,Math.max(0,travelled/total*100)).toFixed(1)),verified,source:hasGps?'GPS':'Trip distance'};
 }
 return{windowFor,stops,kmProgress};
});
