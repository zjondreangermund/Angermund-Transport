'use strict';
// An isolated phone-only demonstration journey; never touches dispatch/trucks.
const statuses=['waiting','at_origin','departed','approaching','arriving','delivered'];
const latitude=p=>Number(p?.latitude),longitude=p=>Number(p?.longitude);
function metres(a,b){
  const r=6371000,rad=x=>x*Math.PI/180;
  const x=rad(latitude(b)-latitude(a)),y=rad(longitude(b)-longitude(a));
  const q=Math.sin(x/2)**2+Math.cos(rad(latitude(a)))*Math.cos(rad(latitude(b)))*Math.sin(y/2)**2;
  return 2*r*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}
function newJourney(label,origin,destination,at=new Date().toISOString()){
  if(!origin?.id||!destination?.id||String(origin.id)===String(destination.id))throw Error('Choose different departure and home geofences');
  return {id:'test_'+Date.now(),label:String(label||'Phone GPS Test').slice(0,80),
    originGeofenceId:String(origin.id),destinationGeofenceId:String(destination.id),
    originName:origin.name,destinationName:destination.name,status:'waiting',startedAt:at,
    lastPositionAt:null,lastDistanceM:null,departureFixes:0,arrivalFixes:0,events:[]};
}
function advance(state,point,origin,destination,now=Date.now()){
  if(!state||state.status==='delivered'||!origin||!destination)return {journey:state,events:[]};
  const fixTime=Date.parse(point.recordedAt),start=Date.parse(state.startedAt),prior=Date.parse(state.lastPositionAt);
  const accuracy=Number(point.accuracy);
  if(!Number.isFinite(fixTime)||fixTime<start||fixTime>now+60_000||now-fixTime>180_000||
     (Number.isFinite(prior)&&fixTime<=prior)||point.accuracy==null||!Number.isFinite(accuracy)||
     accuracy<0||accuracy>100||!Number.isFinite(latitude(point))||!Number.isFinite(longitude(point))||
     Math.abs(latitude(point))>90||Math.abs(longitude(point))>180)return {journey:state,events:[]};
  const out={...state},events=[];
  const originM=metres(point,origin),homeM=metres(point,destination);
  out.lastPositionAt=point.recordedAt;out.lastDistanceM=Math.round(homeM);out.accuracyM=accuracy;
  const set=(status)=>{
    if(statuses.indexOf(status)<=statuses.indexOf(out.status))return;
    out.status=status;out.statusAt=point.recordedAt;events.push(status);
    if(status==='departed')out.departedAt=point.recordedAt;
    if(status==='delivered')out.deliveredAt=point.recordedAt;
  };
  const originRadius=Math.max(20,Number(origin.radiusM||origin.radius_m)||150);
  if(out.status==='waiting'&&originM<=originRadius&&accuracy<=Math.min(100,originRadius))set('at_origin');
  if(out.status==='at_origin'){
    if(originM>originRadius+Math.max(25,accuracy*1.5))out.departureFixes=(out.departureFixes||0)+1;
    else out.departureFixes=0;
    if(out.departureFixes>=2)set('departed');
  }
  if(['departed','approaching','arriving'].includes(out.status)){
    if(homeM<=1000)set('approaching');
    if(homeM<=300)set('arriving');
    // Delivery is a separate arrival confirmation, not the 300 m warning.
    const deliveryRadius=Math.min(100,Math.max(20,Number(destination.radiusM||destination.radius_m)||100));
    if(homeM<=deliveryRadius&&accuracy<=50)out.arrivalFixes=(out.arrivalFixes||0)+1;
    else out.arrivalFixes=0;
    if(out.arrivalFixes>=2)set('delivered');
  }
  return {journey:out,events};
}
module.exports={statuses,metres,newJourney,advance};
