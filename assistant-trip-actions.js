'use strict';
// Whitelisted action planning only. AI text is never run as code or saved as
// a direct mutation. Plans reference stable internal trip IDs for approval.
function clean(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'')}
function escapeRe(v){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function tokenPresent(input,token){
 const pat=String(token||'').trim().split(/[\s-]+/).map(escapeRe).join('[\\s-]*');
 if(!pat)return false;
 return new RegExp('(^|[^a-zA-Z0-9])'+pat+'(?=$|[^a-zA-Z0-9])','i').test(input);
}
function matchesTrip(input,trips){
 return (trips||[]).filter(t=>t.number&&tokenPresent(input,t.number));
}
function matchesTruck(input,trucks){
 return (trucks||[]).filter(t=>t.fleetName&&tokenPresent(input,t.fleetName)||
   (t.registration&&tokenPresent(input,t.registration)));
}
const isRename=q=>/\b(rename|renumber|change|edit|correct|update)\b/i.test(q)&&
  (/\b(?:number|reference|ref)\b/i.test(q)||/\brename\b/i.test(q));
const isDeparture=q=>/\b(departing|departed|depart|departure|on.route|in.transit|start(?:ed)? driving|left depot)\b/i.test(q)&&
  /\b(set|move|switch|change|mark|update|start|from|to|now|already|is)\b/i.test(q);
function attempt(q){return isRename(q)||isDeparture(q)}
function plan(input,state){
 const q=String(input||'').trim(),trips=state?.trips||[],trucks=state?.trucks||[];
 if(!attempt(q))return null;
 if(isRename(q)){
  const oldMatches=matchesTrip(q.split(/\b(?:to|as|into)\b/i)[0],trips).sort((a,b)=>String(b.number).length-String(a.number).length);
  // The source trip must be clear, and a destination cannot be another existing trip.
  if(oldMatches.length!==1)return{error:'Please give the exact existing trip reference (for example: Change trip AT-1001 number to AT-1201).'};
  const trip=oldMatches[0];
  const re=new RegExp('(?:\\bto\\b|\\bas\\b|\\binto\\b)\\s+(?:trip\\s+)?(?:number\\s+)?([A-Z0-9][A-Z0-9._/-]{1,39})\\b','ig');
  const candidates=[...q.matchAll(re)];
  if(candidates.length!==1)return{error:'Please give the new trip number after “to”, for example: Change trip '+trip.number+' number to AT-1201.'};
  const next=candidates[0][1].trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9._/-]{1,39}$/.test(next))return{error:'The new trip number is invalid.'};
  if(clean(next)===clean(trip.number))return{error:'That trip already has this number.'};
  if(trips.some(x=>x.id!==trip.id&&clean(x.number)===clean(next)))return{error:'The new trip number is already used. Choose a unique number.'};
  return{kind:'trip_rename',tripId:trip.id,tripNumber:trip.number,old:trip.number,next,
   expected:{number:trip.number,status:trip.status||'',stage:Number(trip.stage||1),updatedAt:trip.updatedAt||null,
    truckId:trip.truckId||null},description:'Change trip '+trip.number+' number to '+next,
   warning:'The trip ID and linked invoices/PODs stay unchanged. Existing printed documents may still show the old number.'};
 }
 const direct=matchesTrip(q,trips);
 if(direct.length>1)return{error:'More than one trip was mentioned. Please specify only one trip reference.'};
 let trip=direct[0];
 if(!trip){
  const matchingTrucks=matchesTruck(q,trucks);
  if(matchingTrucks.length!==1)return{error:'Which truck or trip should depart? Include a fleet number such as ANG 12 or an exact trip reference.'};
  const truck=matchingTrucks[0];
  const eligible=trips.filter(t=>t.truckId===truck.id&&Number(t.stage||1)<3&&
    /^(planned|loading|assigned|booked|to loading)$/i.test(String(t.status||'Planned')));
  if(eligible.length!==1)return{error:eligible.length?'Multiple planned trips use '+truck.fleetName+'. Please give the exact trip number.':'No single planned or loading trip is assigned to '+truck.fleetName+'. Check Dispatch.'};
  trip=eligible[0];
 }
 if(Number(trip.stage||1)>=3||!(/^(planned|loading|assigned|booked|to loading)$/i.test(String(trip.status||'Planned'))))
  return{error:trip.number+' is not Planned or Loading. Only an open pre-departure trip can be marked In transit.'};
 if(!trip.truckId||!trip.driverId)return{error:trip.number+' needs both an assigned truck and driver before departure.'};
 return{kind:'trip_depart',tripId:trip.id,tripNumber:trip.number,
  old:String(trip.status||'Planned'),next:'In transit',
  expected:{number:trip.number,status:trip.status||'',stage:Number(trip.stage||1),
    updatedAt:trip.updatedAt||null,truckId:trip.truckId||null,driverId:trip.driverId||null},
  description:'Mark '+trip.number+' as Departed / In transit',
  warning:'Manual departure confirmation (not GPS-verified). Truck and driver become On trip; journey stage becomes 3.'};
}
function conflict(trip,proposal){
 const e=proposal.expected||{};
 return !trip||String(trip.number||'')!==String(e.number||'')||
   String(trip.status||'')!==String(e.status||'')||
   Number(trip.stage||1)!==Number(e.stage||1)||
   String(trip.updatedAt||'')!==String(e.updatedAt||'')||
   String(trip.truckId||'')!==String(e.truckId||'')||
   (proposal.kind==='trip_depart'&&String(trip.driverId||'')!==String(e.driverId||''));
}
function apply(state,proposal,actor='AI assistant confirmed by staff',now=new Date().toISOString()){
 const trip=(state.trips||[]).find(x=>x.id===proposal.tripId);
 if(conflict(trip,proposal)){const e=Error('This trip changed since the preview. Ask the assistant again to prepare a fresh change.');e.status=409;throw e}
 if(proposal.kind==='trip_rename'){
  if((state.trips||[]).some(x=>x.id!==trip.id&&clean(x.number)===clean(proposal.next))){
   const e=Error('Another trip now uses that number.');e.status=409;throw e
  }
  if(!/^[A-Z0-9][A-Z0-9._/-]{1,39}$/.test(String(proposal.next||'')))throw Error('Invalid new trip number');
  trip.number=proposal.next;
 }else if(proposal.kind==='trip_depart'){
  if(!trip.truckId||!trip.driverId||Number(trip.stage||1)>=3)throw Error('Trip can no longer depart');
  trip.status='In transit';trip.stage=3;trip.startedAt=trip.startedAt||now;
  const legs=(trip.legs||[]).slice().sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0));
  const current=legs.find(x=>!['Delivered','Invoiced','Closed'].includes(String(x.status||'')))||legs[0];
  if(current)current.status='In transit';
  const truck=(state.trucks||[]).find(x=>x.id===trip.truckId),driver=(state.drivers||[]).find(x=>x.id===trip.driverId);
  if(truck)truck.status='On trip';if(driver)driver.status='On trip';
 }else throw Error('Unsupported assistant action');
 trip.updatedAt=now;trip.updatedBy=actor;
 state.audit??=[];state.audit.unshift({id:'log_'+require('node:crypto').randomUUID(),at:now,
  actor,action:'Assistant-approved: '+proposal.description,linkedType:'trip',linkedId:trip.id});
 state.audit=state.audit.slice(0,200);
 return{tripId:trip.id,number:trip.number,status:trip.status,stage:trip.stage};
}
module.exports={plan,apply,attempt,tokenPresent,conflict};
