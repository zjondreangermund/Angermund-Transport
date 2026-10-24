'use strict';
const crypto=require('node:crypto');
const MANUAL_ROUTE_ID='__manual__';
function validationError(message){const error=new Error(message);error.status=400;throw error}
function manualRoute(body,existingRoutes=[],idFactory=()=>('rte_'+crypto.randomUUID())){
  const name=String(body.manualRouteName||'').trim().replace(/\s+/g,' ');
  if(name.length<3||name.length>120)validationError('Enter a route name between 3 and 120 characters (example: Windhoek → Oshakati).');
  if(/\p{Cc}/u.test(name))validationError('Route name contains unsupported characters.');
  if((existingRoutes||[]).some(r=>String(r.name||'').trim().toLowerCase()===name.toLowerCase()))
    validationError('This route already exists. Select it from the saved route list rather than making a duplicate.');
  const numeric=(value,label)=>{
    const raw=String(value??'').trim();
    if(!raw)return 0;
    const n=Number(raw.replace(/,/g,''));
    if(!Number.isFinite(n)||n<0||n>100000)validationError(label+' must be between 0 and 100,000 km.');
    return Number(n.toFixed(2));
  };
  const distance=numeric(body.manualRouteDistance,'Route distance');
  const namibiaKm=numeric(body.manualRouteNamibiaKm,'Namibia road distance');
  if(distance>0&&namibiaKm>distance)validationError('Namibia road kilometres cannot exceed the total route kilometres.');
  if(!distance&&namibiaKm)validationError('Enter the total route distance before adding Namibia road kilometres.');
  const loadName=String(body.manualRouteFrom||'').trim().slice(0,100);
  const offloadName=String(body.manualRouteTo||'').trim().slice(0,100);
  const roundTrip=body.manualRouteRoundTrip===true||body.manualRouteRoundTrip==='true';
  const crossBorder=body.manualRouteCrossBorder===true||body.manualRouteCrossBorder==='true';
  return {id:idFactory(),name,distance,namibiaKm,mdcRule:'Auto',rate:0,
    crossBorder,roundTrip,loadName,offloadName,notes:'Created when entering a trip manually. Add verified GPS geofences and rates in Clients & Routes if needed.'};
}
module.exports={MANUAL_ROUTE_ID,manualRoute};
