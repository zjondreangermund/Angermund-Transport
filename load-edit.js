const {calculate:calculateInvoiceCharges}=require('./public/invoice-charges');
const {defaultDriverId,syncDriverReferences}=require('./truck-driver-defaults');
'use strict';
const fail=message=>{const e=new Error(message);e.status=400;throw e};
const number=v=>{const n=Number(v);if(!Number.isFinite(n)||n<0)fail('Amounts and quantities must be valid non-negative numbers');return n};
function syncLinkedLoad(state,t,leg){
  const c=t.carrierDetails;
  if(c&&t.legs[0].id===leg.id){
    Object.assign(c,{orderRef:t.sourceOrderRef||'',pro:t.carrierPro||'',status:t.carrierStatus||'',equipment:t.equipment||'',productDescription:leg.load,weightKg:Number(leg.tons||0)*1000,weightUom:'kg',rate:leg.income,trailers:t.sourceTrailerRegistrations||[]});
    c.productWeightRaw=c.weightKg;c.productNetWeightRaw=c.weightKg;
    const r=(state.routes||[]).find(x=>x.id===leg.routeId);
    if(r){c.origin={...c.origin,name:r.loadName||r.name.split(/\s*(?:->|→)\s*/)[0]};c.destination={...c.destination,name:r.offloadName||r.name.split(/\s*(?:->|→)\s*/).slice(-1)[0]}}
    t.sourceRate=leg.income;if(leg.income>0)t.ratePending=false;
  }
  for(const key of ['diesel','expenses','advances','inspections','tripIssues'])for(const row of state[key]||[])if(row.tripId===t.id){row.truckId=t.truckId;row.driverId=t.driverId}
  const tr=(state.trucks||[]).find(x=>x.id===t.truckId),dr=(state.drivers||[]).find(x=>x.id===t.driverId),r=(state.routes||[]).find(x=>x.id===leg.routeId);
  for(const inv of state.invoices||[]){
    let changed=false;
    for(const line of inv.lines||[])if(line.tripId===t.id&&(!line.legId||line.legId===leg.id)){
      Object.assign(line,{date:t.date,tripNumber:t.number,route:r?.name||'',truck:tr?.fleetName||tr?.registration||'',registration:tr?.registration||'',driver:dr?.name||'',load:leg.load,amount:leg.income});changed=true;
    }
    if(inv.tripId===t.id&&(!inv.legId||inv.legId===leg.id)&&!inv.consolidated&&!inv.shunterRecon){inv.clientId=leg.clientId;inv.amount=inv.legId?leg.income:t.income;changed=true}
    if(!changed)continue;
    if(!inv.lines?.length)inv.transportSubtotal=inv.amount;
    if(inv.lines?.length)inv.amount=Number(inv.lines.reduce((a,l)=>a+Number(l.amount||0),0).toFixed(2));
    calculateInvoiceCharges(state,inv);
    const paid=Math.max(Number(inv.paidAmount||0),(state.payments||[]).filter(p=>p.invoiceId===inv.id).reduce((a,p)=>a+Number(p.amount||0),0));
    if(inv.amount<paid-.005)fail('The corrected invoice total is below payments received. Resolve the payment or credit first.');
    inv.paidAmount=paid;inv.balance=Number((inv.amount-paid).toFixed(2));inv.status=inv.balance<=.005?'Paid':paid>0?'Part Paid':inv.due&&inv.due<new Date().toISOString().slice(0,10)?'Overdue':'Unpaid';inv.updatedAt=new Date().toISOString();
  }
}
const workflowStages={Planned:1,Loading:2,'In transit':3,'At offloading':3,Delivered:4,Invoiced:5,Closed:6};
function syncJourneyWorkflow(t){
  const legs=(t.legs||[]).slice().sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0));
  if(!legs.length)return;
  const active=legs.find(l=>!['Delivered','Invoiced','Closed'].includes(l.status));
  const status=active?.status||(legs.every(l=>l.status==='Closed')?'Closed':legs.every(l=>l.status==='Invoiced'||l.status==='Closed')?'Invoiced':'Delivered');
  if(!workflowStages[status])return;
  const previous=Number(t.stage||0);t.status=status;t.stage=workflowStages[status];
  if(t.stage<previous){
    if(t.stage<3){delete t.startedAt;for(const l of legs.filter(l=>['Planned','Loading'].includes(l.status))){delete l.startedAt;l.geo={}}t.geo={}}
    if(t.stage<4){delete t.depotArrival;delete t.operationalCompletedAt;delete t.returnJourney;delete t.arrivedAt;delete t.deliveredDate;delete t.completedDate;delete t.closedDate;t.driverComplete=false;delete t.driverCompletedAt;if(active)delete active.arrivedAt}
  }
}
function editLoad(state,t,body,helpers){
  const {ensureTripLegs,syncTripFromLegs,recalcTripCosts,isShunterTruckId}=helpers;
  const legs=ensureTripLegs(state,t),leg=body.legId&&!String(body.legId).startsWith('legacy_')?legs.find(x=>x.id===body.legId):legs[0];if(!leg)fail('Load leg not found');
  if(body.status!==undefined){if(!workflowStages[body.status])fail('Invalid load status');leg.status=body.status;syncJourneyWorkflow(t)}
  const old={truckId:t.truckId,date:t.date,driverId:t.driverId};
  const explicitDriver=body.driverAssignmentOverride===true||body.driverId!==undefined&&String(body.driverId||'')!==String(t.driverId||'');
  if(explicitDriver){t.driverAssignmentOverride=true;t.driverAssignmentSource='manual';t.assignedDriverAt=new Date().toISOString()}
  if(body.truckId!==undefined&&body.truckId!==t.truckId&&!explicitDriver&&!t.driverAssignmentOverride){body={...body,driverId:defaultDriverId(state,body.truckId)};t.driverAssignmentSource='truck-default'}
  for(const [field,collection,optional] of [['truckId','trucks',true],['driverId','drivers',true],['trailerId','trailers',true],['routeId','routes',false],['clientId','clients',false]]){
    if(body[field]===undefined)continue;const value=String(body[field]||'');
    if((value||!optional)&&!(state[collection]||[]).some(x=>x.id===value))fail('Invalid '+field);
    (['routeId','clientId'].includes(field)?leg:t)[field]=value;
  }
  for(const k of ['date','plannedDropDate'])if(body[k]!==undefined){const v=String(body[k]);if((k==='date'||v)&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))fail('Enter a valid date');t[k]=v}
  if(body.clientId!==undefined&&(state.invoices||[]).some(i=>i.consolidated&&i.lines?.some(l=>l.tripId===t.id&&(!l.legId||l.legId===leg.id))&&i.clientId!==leg.clientId))fail('Move this load out of its consolidated client invoice before changing the client');
  for(const k of ['sourceOrderRef','carrierPro','carrierStatus','equipment'])if(body[k]!==undefined)t[k]=String(body[k]||'').trim().slice(0,240);
  if(body.trailerId!==undefined){t.trailerIds=t.trailerId?[t.trailerId]:[];t.sourceTrailerRegistrations=(state.trailers||[]).filter(x=>t.trailerIds.includes(x.id)).map(x=>x.registration)}
  if(body.routeId!==undefined&&t.carrierDetails&&t.routeId!==body.routeId){t.carrierDetails.origin={};t.carrierDetails.destination={}}
  if(body.load!==undefined)leg.load=String(body.load).slice(0,1000);
  for(const k of ['tons','pallets','distance','namibiaKm','unitRate','agreedAmount'])if(body[k]!==undefined)leg[k]=number(body[k]);
  if(body.pricingMethod!==undefined){if(!['Flat trip','Per km','Per ton','Per pallet','Manual negotiated'].includes(body.pricingMethod))fail('Invalid pricing method');leg.pricingMethod=body.pricingMethod}
  if(body.routeId!==undefined){const r=state.routes.find(x=>x.id===leg.routeId);if(body.distance===undefined)leg.distance=Number(r.distance||0);if(body.namibiaKm===undefined)leg.namibiaKm=Number(r.namibiaKm||0)}
  const reconChanged=old.truckId!==t.truckId||old.date!==t.date;
  if(reconChanged){
    const refs=[t.externalTmsId,t.sourceTmsId].filter(Boolean).map(String);
    const affected=(state.shunterRecons||[]).filter(r=>(r.tmsIds||[]).some(x=>refs.includes(String(x))));
    if(affected.some(r=>r.invoiceId))fail('This load is in an invoiced shunter recon. Correct that recon before changing its truck or date.');
    for(const r of affected){r.tmsIds=r.tmsIds.filter(x=>!refs.includes(String(x)));if(r.rateBasis!=='manual')r.charge=r.tmsIds.length?(r.rateBasis==='special'?r.tmsIds.length*Number(state.shunterSettings?.specialMovementRate||1895):Number(state.shunterSettings?.weekdayRate||4700)):0}
    t.shunterReconId='';
  }
  t.shunter=isShunterTruckId(t.truckId);t.tripType=t.shunter?'Shunter':'Transport';
  if(reconChanged&&t.shunter)helpers.upsertImportedShunterRecon(state,t);
  syncTripFromLegs(state,t);t.load=legs[0].load;recalcTripCosts(state,t);syncLinkedLoad(state,t,leg);syncDriverReferences(state,t);
  if(t.carrierDetails){if(body.date!==undefined){t.carrierDetails.pickPlanStart=t.date;t.carrierDetails.pickPlanEnd=t.date}if(body.plannedDropDate!==undefined){t.carrierDetails.dropPlanStart=t.plannedDropDate;t.carrierDetails.dropPlanEnd=t.plannedDropDate}}
  t.updatedAt=new Date().toISOString();return{trip:t,leg};
}
module.exports={editLoad,syncLinkedLoad,syncJourneyWorkflow};
