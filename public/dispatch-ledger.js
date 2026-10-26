'use strict';
function ledgerDotBar(labels,current,color,label){return '<ol class="ledger-progress status-'+color+'" aria-label="'+esc(label)+'">'+labels.map((x,i)=>'<li class="'+(i<=current?'reached ':'')+(i===current?'current':'')+'" '+(i===current?'aria-current="step"':'')+'><span class="ledger-dot"></span><span>'+esc(x)+'</span></li>').join('')+'</ol>'}
function ledgerRollingGeofences(t){
 const model=AngermundDispatchGeofences.windowFor(t,db.routes||[]);
 const live=t.gpsProgress?.geofenceTimeline;
 const dots=model.map((stop,i)=>{
  const first=i===0,cls=first?'is-last':i===1?'is-next':'is-after';
  const marker=stop.state==='arrived'?'✓':i+1;
  return '<div class="dispatch-fence-node '+cls+' '+(stop.state==='arrived'?'is-arrived':'')+'">'
   +'<span class="dispatch-fence-circle" title="'+esc(stop.name)+'">'+marker+'</span>'
   +'<b title="'+esc(stop.name)+'">'+esc(stop.name)+'</b>'
   +'<small>'+esc(stop.state==='inferred'?'Last departure (estimated)':stop.state==='departed'?'Last left':stop.state==='arrived'?'At geofence':stop.state==='starting'?'Current start':stop.state==='next'?'Next stop':stop.state==='unmapped'?'Location not mapped':stop.state==='done'?'End of journey':'Following stop')+'</small>'
   +'</div>';
 }).join('');
 const gps=t.gpsProgress,hasFix=Boolean(gps?.lastFix);
 const last=live?.fromLastKm==null?'':num(live.fromLastKm).toFixed(1)+' km from last geofence';
 const toNext=live?.toNextKm==null?'':num(live.toNextKm).toFixed(1)+' km straight-line to next';
 const foot=(last||toNext)?'<small class="dispatch-fence-distances">'+esc(last)+(last&&toNext?' · ':'')+esc(toNext)+'</small>':
    '<small class="dispatch-fence-distances">'+(hasFix?'Geofence coordinates required for automatic progress':'Waiting for live GPS signal')+'</small>';
 return '<div class="dispatch-three-fences" role="group" aria-label="Rolling last, next and following geofences">'
  +'<div class="dispatch-three-fences-label">📍 Geofences · previous → next → following</div>'
  +'<div class="dispatch-fence-steps">'+dots+'</div>'+foot+'</div>';
}
function ledgerKilometreProgress(t){
 const km=AngermundDispatchGeofences.kmProgress(t,journeyDistance(t));
 if(!km.total)return '<small class="dispatch-km-pending">Trip distance not yet recorded</small>';
 const completed=TripLifecycle.completed(t);
 const suffix=km.verified?' · verified GPS':km.ready?' · GPS observed / provisional':' · awaiting GPS';
 const travelled=completed&&km.travelled<km.total&&km.verified===false?'GPS observed '+km.travelled.toLocaleString()+' km':
  (km.ready?km.travelled.toLocaleString()+' km travelled':'GPS kilometres pending');
 return '<div class="dispatch-km-summary"><span>'+esc(travelled)+esc(suffix)+'</span>'
  +'<span>'+(km.ready?km.remaining.toLocaleString()+' km remaining':'Total '+km.total.toLocaleString()+' km')+'</span></div>'
  +'<div class="dispatch-km-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+km.percent.toFixed(0)+'" aria-label="GPS observed kilometres across complete trip"><span style="width:'+km.percent.toFixed(1)+'%"></span></div>'
  +'<small class="dispatch-km-footnote">Total trip '+km.total.toLocaleString()+' km · '+(km.ready?'GPS travelled kilometres; remaining is an estimate until the journey is verified':'Trip-distance estimate, awaiting GPS')+' · diesel slips remain linked to this trip</small>';
}
function ledgerProgress(t){
 const ls=tripLegs(t).filter(l=>!l.cancelled&&!/cancelled/i.test(l.status||'')),phase=TripLifecycle.phase(t),returning=TripLifecycle.returning(t),done=TripLifecycle.completed(t),delivered=TripLifecycle.delivered(t);
 const completedLoads=ls.filter(TripLifecycle.deliveredLeg).length,segments=[];
 const place=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
 const endpoints=leg=>String(route(leg.routeId)||'').split(/→|->|↔|–/).map(place).filter(Boolean);
 ls.forEach((leg,i)=>{
   if(i){const previous=endpoints(ls[i-1]),next=endpoints(leg);
     if(previous.length>1&&next.length>1&&previous[previous.length-1]!==next[0])segments.push({transfer:true,legIndex:i,leg});
   }
   segments.push({transfer:false,legIndex:i,leg});
 });
 if(!segments.length)segments.push({transfer:false,legIndex:0,leg:t});
 const activeIndex=Math.max(0,ls.findIndex(l=>!TripLifecycle.deliveredLeg(l)));
 const activeSegment=Math.max(0,segments.findIndex(s=>s.legIndex===activeIndex&&!s.transfer));
 const active=ls[activeIndex]||t,status=String(active.status||''),loading=/loading/i.test(status)&&!/offloading/i.test(status);
 const outboundFraction=delivered?1:(activeSegment+(/in transit|on route/i.test(status)||(ls.length<=1&&phase.key==='route')?0.66:loading||(ls.length<=1&&phase.key==='loading')?0.25:0))/segments.length;
 const position=done?0:returning?50:Math.max(0,Math.min(100,outboundFraction*100));
 const label=done?'At Angermund depot · Complete':returning?'Returning to Angermund depot':delivered?'Delivered · Awaiting return':phase.label;
 const stops=ls.length>1?'<small>'+ls.map((leg,i)=>'Leg '+(i+1)+' · '+esc(route(leg.routeId))+(TripLifecycle.deliveredLeg(leg)?' · Delivered':'')).join(' → ')+'</small>':'';
 const lines=segments.map((s,i)=>{
   const left=i/segments.length*100,right=(i+1)/segments.length*100;
   const travelled=done||returning?100:Math.max(0,Math.min(100,(position-left)/(right-left)*100));
   const green=done?100:returning?Math.max(0,Math.min(100,(right-position)/(right-left)*100)):0;
   const colour=s.transfer?'#fb923c':'#3b82f6';
   return '<span class="ledger-route-segment" style="left:'+left+'%;width:'+(right-left)+'%;background:linear-gradient(to right,'+colour+' 0%,'+colour+' '+travelled+'%,#64748b '+travelled+'%,#64748b 100%)" '+(s.transfer?'title="Travel to different loading point"':'')+'><span class="ledger-return-fill" style="width:'+green+'%"></span></span>'+(!s.transfer?'<span class="ledger-stop-marker '+(done||TripLifecycle.deliveredLeg(s.leg)?'stop-reached':'')+'" style="left:'+right+'%" title="Delivery '+(s.legIndex+1)+'"></span>':'');
 }).join('');
 return '<div class="ledger-single-journey '+(returning?'is-returning ':'')+(done?'is-home ':'')+(delivered?'is-delivered ':'')+((returning||phase.key==='route')?'is-driving':'')+'" role="group" aria-label="Journey progress: '+esc(label)+'">'+stops+'<div class="ledger-one-track" style="--truck-position:'+position+'%">'+lines+'<span class="ledger-depot-marker"></span><span class="ledger-moving-dot" aria-hidden="true"></span></div><div class="ledger-one-labels"><span>'+(done?'At depot':'Angermund depot')+'</span><strong>'+esc(label)+'</strong><span>Delivered</span></div>'+(ls.length>1?'<small>'+completedLoads+' / '+ls.length+' loads delivered</small>':'')+ledgerRollingGeofences(t)+ledgerKilometreProgress(t)+'</div>';
}
function ledgerTripCard(t){
 const phase=TripLifecycle.phase(t),ls=tripLegs(t),pod=ls.every(l=>l.pod||l.podDocumentId||l.podUploadId)||Boolean(t.pod||t.podDocumentId||t.podUploadId),fills=(db.diesel||[]).filter(f=>f.tripId===t.id),litres=sum(fills,f=>num(f.litres)),capture=['admin','manager','dispatcher'].includes(role),done=TripLifecycle.completed(t),returned=TripLifecycle.returning(t),delivered=TripLifecycle.delivered(t);
 const advance=!done&&!returned&&!delivered?'<button type="button" class="primary small advance-trip" data-id="'+esc(t.id)+'">'+({1:'Start loading',2:'Depart',3:'Confirm delivery'}[num(t.stage)]||'Open')+'</button>':'';
 const returnAction=capture&&delivered&&!done&&!returned?'<button type="button" class="primary small" data-ledger-return="'+esc(t.id)+'">↩ Start return</button>':'';
 const depotAction=capture&&delivered&&!done?'<button type="button" class="ghost small" data-ledger-depot="'+esc(t.id)+'">Confirm at depot</button>':'';
 return '<article class="ledger-row clickable-record status-'+phase.key+'" data-trip-open="'+esc(t.id)+'"><div class="ledger-truck"><img src="'+FleetPhotos.source(truckRecord(t.truckId))+'" alt="'+esc(truck(t.truckId))+'" class="ledger-truck-image"><div><b>'+esc(truck(t.truckId))+'</b><small>'+esc(t.driverId?driver(t.driverId):'Driver unassigned')+'</small><span class="ledger-status">'+esc(phase.label)+'</span><small>'+esc(t.number)+'</small><small>Pickup: '+esc(t.date||'Not set')+'</small><small>Delivery: '+esc(t.plannedDropDate||'Not set')+'</small>'+shunterTripBadge(t)+'</div></div><div class="ledger-journey"><b>'+esc(journeyRouteLabel(t))+'</b><small>'+journeyDistance(t).toLocaleString()+' km · '+esc(journeyLoadLabel(t))+'</small>'+ledgerProgress(t)+'</div><div class="ledger-proof"><span class="ledger-label">POD</span><b><i class="ledger-indicator '+(pod?'available':'pending')+'"></i>'+(pod?'Attached':'Pending')+'</b>'+tripRequirementChips(t)+'</div><div class="ledger-fuel"><span class="ledger-label">Diesel</span><b>'+(fills.length?litres.toLocaleString()+' L':'Awaiting slip')+'</b><small>'+fills.length+' linked slip'+(fills.length===1?'':'s')+'</small></div><div class="ledger-actions"><div class="fleet-card-actions">'+advance+returnAction+depotAction+(capture?'<button type="button" class="ghost small dispatch-trip-slip" data-trip="'+esc(t.id)+'">📷 Slip</button><button type="button" class="ghost small dispatch-trip-pod" data-trip="'+esc(t.id)+'">📄 POD</button><button type="button" class="ghost small edit-load-button" data-id="'+esc(t.id)+'">Edit load</button>':'')+'<button type="button" class="ghost small open-trip" data-id="'+esc(t.id)+'">Details</button>'+tripDeleteButton(t)+'</div></div></article>';
}
function ledgerAvailableTrucks(){const busy=new Set((db.trips||[]).filter(t=>!TripLifecycle.completed(t)&&!/cancelled/i.test(t.status||'')).map(t=>t.truckId));return(db.trucks||[]).filter(t=>!busy.has(t.id)&&!/workshop|maintenance|inactive|repair|out of service/i.test(t.status||''))}
function ledgerOverview(){const rows=opsFiltering()?opsRows('trips'):(db.trips||[]),active=rows.filter(t=>!TripLifecycle.completed(t)&&!/cancelled/i.test(t.status||'')),count=key=>active.filter(t=>TripLifecycle.phase(t).key===key).length;
 return '<section class="ledger-overview"><div><strong>'+db.trucks.length+'</strong><span>Trucks</span></div><div class="status-available"><strong>'+ledgerAvailableTrucks().length+'</strong><span>Available</span></div><div class="status-route"><strong>'+count('route')+'</strong><span>On route</span></div><div class="status-returning"><strong>'+count('returning')+'</strong><span>Returning</span></div><div class="status-destination"><strong>'+count('destination')+'</strong><span>At destination</span></div></section><div class="ledger-tabs">'+[['process','In process',active.length],['completed','Completed',rows.filter(TripLifecycle.completed).length],['all','All trips',rows.length]].map(([key,label,n])=>'<button class="'+(tripCompletionFilter===key?'active':'')+'" data-ledger-filter="'+key+'">'+label+' <span>'+n+'</span></button>').join('')+'<span class="ledger-key"><i class="ledger-indicator available"></i> Available <i class="ledger-indicator route"></i> On route <i class="ledger-indicator destination"></i> At destination</span></div>';
}
function ledgerAvailablePanel(){const rows=ledgerAvailableTrucks();return '<section class="ledger-available"><h3><i class="ledger-indicator available"></i> Available trucks</h3><div>'+rows.map(t=>'<button class="ghost small" data-ledger-truck="'+esc(t.id)+'">'+esc(t.fleetName||t.registration)+'</button>').join('')+(rows.length?'':'<small>No trucks currently available</small>')+'</div></section>'}
document.addEventListener('click',async e=>{
 const filter=e.target.closest('[data-ledger-filter]');if(filter){tripCompletionFilter=filter.dataset.ledgerFilter;render();return}
 const vehicle=e.target.closest('[data-ledger-truck]');if(vehicle){go('fleet');return}
 const returning=e.target.closest('[data-ledger-return]'),depot=e.target.closest('[data-ledger-depot]');if(!returning&&!depot)return;
 const id=returning?.dataset.ledgerReturn||depot.dataset.ledgerDepot;if(depot&&!confirm('Has this truck physically arrived at Angermund depot? Confirm only when the truck is back in the yard.'))return;
 const button=returning||depot;button.disabled=true;try{await api((depot?'/api/admin/trips/':'/api/trips/')+encodeURIComponent(id)+(depot?'/depot-arrival':'/return'),{method:'POST',body:JSON.stringify(depot?{confirmAtDepot:true}:{})});await refreshCentralState(false);notify(depot?'Arrival at Angermund depot confirmed':'Returning to Angermund depot')}catch(err){notify(err.message)}finally{button.disabled=false}
});
function ledgerVehiclePhase(vehicle){
 const assigned=(db.trips||[]).filter(t=>t.truckId===vehicle.id&&!TripLifecycle.completed(t)&&!/cancelled/i.test(t.status||'')).sort((a,b)=>Number(Boolean(b.returnJourney?.startedAt))-Number(Boolean(a.returnJourney?.startedAt))||num(b.stage)-num(a.stage));
 if(assigned.length)return TripLifecycle.phase(assigned[0]);
 if(/workshop|maintenance|repair|out of service|inactive/i.test(vehicle.status||''))return{key:'loading',label:vehicle.status};
 return{key:'available',label:'Available'};
}
function ledgerVehicleBadge(vehicle){const p=ledgerVehiclePhase(vehicle);return '<span class="ledger-status status-'+p.key+'">'+esc(p.label)+'</span>'}
