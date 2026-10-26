'use strict';
// Rolling two upcoming site geofences plus last departed site.
// Only trusted, server-attributed GPS points update this state; diesel slips do not.
const metres=(a,b)=>{
 const lat=x=>Number(x.latitude)*Math.PI/180,lon=x=>Number(x.longitude)*Math.PI/180;
 const dlat=lat(b)-lat(a),dlon=lon(b)-lon(a);
 const x=Math.sin(dlat/2)**2+Math.cos(lat(a))*Math.cos(lat(b))*Math.sin(dlon/2)**2;
 return 12742000*Math.asin(Math.min(1,Math.sqrt(x)));
};
const validCoord=(lat,lon)=>lat!==null&&lat!==undefined&&lon!==null&&lon!==undefined&&
 Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&!(Number(lat)===0&&Number(lon)===0);
const normalize=x=>String(x||'').trim().toLowerCase().replace(/\s+/g,' ');
function chain(trip,routes=[],fences=[]){
 const active=(fences||[]).filter(f=>f.active!==false);
 const legs=Array.isArray(trip.legs)&&trip.legs.length?
 [...trip.legs].filter(l=>!l.cancelled&&!/cancelled/i.test(l.status||'')).sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0)):
 [{id:'legacy',routeId:trip.routeId}];
 const stops=[];
 const findFence=id=>id?active.find(x=>String(x.id)===String(id)):null;
 const append=(kind,leg,route)=>{
  const loading=kind==='loading',prefix=loading?'load':'offload',fld=loading?'loading':'offloading';
  const fence=findFence(leg[fld+'GeofenceId']||trip[fld+'GeofenceId']||route[fld+'GeofenceId']);
  const name=String(fence?.name||leg[fld+'GeofenceName']||route[prefix+'Name']||
   (loading?'Loading':'Offloading')+' · '+(route.name||trip.number||'Site')).trim();
  const latitude=fence?.latitude??route[prefix+'Lat'],longitude=fence?.longitude??route[prefix+'Lon'];
  const radiusM=Math.max(50,Math.min(2000,Number(fence?.radiusM||fence?.radius_m||route[fld+'RadiusM']||250)));
  const stop={id:String(fence?.id||leg.id+':'+fld),kind,name,legId:leg.id||'',latitude:Number(latitude),longitude:Number(longitude),radiusM,
   locatable:validCoord(latitude,longitude)};
  const prev=stops[stops.length-1];
  if(prev&&((prev.id===stop.id&&stop.id)||prev.locatable&&stop.locatable&&metres(prev,stop)<75))return;
  stops.push(stop);
 };
 for(const leg of legs){
  const route=routes.find(r=>String(r.id)===String(leg.routeId))||{};
  append('loading',leg,route);append('offloading',leg,route);
 }
 const depots=active.filter(f=>f.angermundDepot===true||f.kind==='depot'||/angermund|company depot|home yard/i.test(f.name||''));
 const depot=depots.find(f=>f.angermundDepot===true)||depots.find(f=>f.kind==='depot')||depots[0];
 if(depot&&validCoord(depot.latitude,depot.longitude)){
  const stop={id:String(depot.id),kind:'depot',name:String(depot.name||'Angermund depot'),legId:'',latitude:Number(depot.latitude),longitude:Number(depot.longitude),
   radiusM:Math.max(30,Math.min(1000,Number(depot.radiusM||depot.radius_m||100))),locatable:true};
  const prev=stops.at(-1);
  if(!prev||!prev.locatable||metres(prev,stop)>=75)stops.push(stop);
 }
 return stops;
}
function update(trip,point,stops){
 const gps=trip.gpsProgress;
 if(!gps||!Array.isArray(stops)||!stops.length)return null;
 const keys=stops.map(s=>s.id).join('|');
 let progress=gps.geofenceTimeline||{};
 if(progress.sequence!==keys)progress={sequence:keys,nextIndex:0,lastLeftIndex:-1,arrivalIndex:-1,enteredAt:null,leftAt:null,lastLeftGpsKm:0};
 const at=Date.parse(point.recordedAt),prior=Date.parse(progress.lastAt);
 if(!Number.isFinite(at)||Number.isFinite(prior)&&at<=prior)return gps.geofenceTimeline||null;
 progress.lastAt=point.recordedAt;
 let i=Math.max(0,Math.min(stops.length,Number(progress.nextIndex)||0));
 // Trips already in transit when the first GPS fix arrives: use the loading
 // geofence as a clearly marked inferred starting point, not a fake GPS event.
 if(i===0&&progress.lastLeftIndex<0&&gps.points<=1&&
   (trip.startedAt||Number(trip.stage)>=3||/in transit|return/i.test(trip.status||''))&&stops.length>1){
   progress.lastLeftIndex=0;progress.nextIndex=1;progress.leftAt=null;progress.lastLeftGpsKm=Number(gps.observedKm||0);
   progress.inferredDeparture=true;i=1;
 }
 const next=stops[i];
 if(next?.locatable){
  const dist=metres(point,next);
  const inside=dist<=next.radiusM;
  const exit=dist>next.radiusM+Math.max(50,Number(point.accuracy||0)*1.5);
  if(inside&&progress.arrivalIndex!==i){
   progress.arrivalIndex=i;progress.enteredAt=point.recordedAt;
  }else if(progress.arrivalIndex===i&&exit){
   progress.lastLeftIndex=i;progress.nextIndex=i+1;progress.arrivalIndex=-1;
   progress.enteredAt=null;progress.leftAt=point.recordedAt;
   progress.lastLeftGpsKm=Number(gps.observedKm||0);
   progress.inferredDeparture=false;
  }
 }
 const nextStop=stops[Math.max(0,Number(progress.nextIndex)||0)];
 progress.toNextKm=nextStop?.locatable?Number((metres(point,nextStop)/1000).toFixed(2)):null;
 progress.fromLastKm=Number(Math.max(0,Number(gps.observedKm||0)-Number(progress.lastLeftGpsKm||0)).toFixed(2));
 const left=progress.lastLeftIndex>=0?stops[progress.lastLeftIndex]:null;
 const start=left||stops[0],after=stops[progress.nextIndex]||(left?null:stops[1]),after2=stops[progress.nextIndex+1]||null;
 progress.window=[
   {name:start?.name||'Departure',kind:start?.kind||'loading',state:left?(progress.inferredDeparture?'inferred':'departed'):'starting'},
   {name:after?.name||'Journey complete',kind:after?.kind||'complete',state:progress.arrivalIndex===progress.nextIndex?'arrived':after?.locatable?'next':after?'unmapped':'done'},
   {name:after2?.name||'Depot / complete',kind:after2?.kind||'complete',state:after2?.locatable?'upcoming':after2?'unmapped':'done'}
 ];
 gps.geofenceTimeline=progress;
 return progress;
}
module.exports={chain,update,metres};
