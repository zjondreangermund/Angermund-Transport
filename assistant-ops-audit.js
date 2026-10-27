'use strict';
// Deterministic, read-only cross-module investigation. No correction is assumed
// from an AI guess. The existing approved job system may create review tasks.
const Metrics=require('./public/trip-metrics');
const Link=require('./payroll-trip-link');
const normalize=x=>String(x??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const n=x=>Number.isFinite(Number(x))?Number(x):0;
const iso=x=>String(x||'').slice(0,10);
const finance=new Set(['admin','manager','finance']);
const operations=new Set(['admin','manager','finance','dispatcher']);
const editable=new Set(['admin','manager','dispatcher']);
const MAX_TRIPS=8,MAX_ISSUES=25;
function namesInQuestion(q,name){
 const target=normalize(name),text=' '+normalize(q)+' ';
 if(!target||target.length<3)return false;
 return text.includes(' '+target+' ');
}
function isAuditRequest(q){
 const text=String(q||'');
 return (/\b(audit|investigate|diagnos(?:e|is|tic)|reconcil(?:e|iation)|trace|cross.?check|review (?:all )?issues|check (?:everything|the whole trip))\b/i.test(text)
  && /\b(trip|fleet|truck|ang\s*0?\d+|diesel|fuel|payroll|payslip|invoice|pod|slip|driver|billing)\b/i.test(text))
  ||(/\bwhy\b/i.test(text)&&/\b(?:diesel|fuel|payroll|payslip|invoice)\b/i.test(text)
     &&(/\bang[\s-]*\d+\b/i.test(text)||/\b(?:trip|order)\s*(?:#|no\.?|number)?\s*[A-Z0-9]*\d+[A-Z0-9-]*\b/i.test(text)));
}
function wantsTasks(q){
 return /\b(?:create|prepare|make|add)\s+(?:(?:follow.?up|review|action|missing|audit)\s+)?tasks?\b/i.test(q)&&
  /\b(?:audit|investigate|from (?:this|the) audit|issues|check)\b/i.test(q);
}
function dateFromQuestion(q){
 const explicit=/\b20\d{2}-\d{2}-\d{2}\b/.exec(q)?.[0];if(explicit)return explicit;
 const m=/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i.exec(q);
 if(!m)return null;
 const month=1+['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase().slice(0,3));
 const d=String(m[3])+'-'+String(month).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');
 return Number.isFinite(Date.parse(d+'T00:00:00Z'))?d:null;
}
function truckFor(q,state){
 const code=/\bang[\s-]*0?(\d{1,2})\b/i.exec(q)?.[1];if(!code)return null;
 const xs=(state.trucks||[]).filter(t=>{
  const m=/\bang[\s-]*0?(\d{1,2})\b/i.exec(t.fleetName||'');
  return m&&Number(m[1])===Number(code)||String(t.id).toLowerCase()==='trk_ang'+Number(code);
 });
 return xs.length===1?xs[0]:null;
}
function resolve(q,state,focus=null){
 const trips=state.trips||[],date=dateFromQuestion(q),truck=truckFor(q,state);
 const matched=trips.filter(t=>t.number&&namesInQuestion(q,t.number)||
  [t.sourceOrderRef,t.externalTmsId,t.sourceTmsId,t.carrierDetails?.tmsId].some(v=>v&&namesInQuestion(q,v)));
 if(matched.length===1)return{trips:matched,scope:'exact trip'};
 if(matched.length>1)return{error:'Several trips match that reference. Give the exact saved trip number.',suggestions:matched.slice(0,5)};
 if(!truck&&focus?.type==='trip'&&/\b(this|that|it)\s+trip\b/i.test(q)){
  const focused=trips.filter(t=>t.id===focus.id||String(t.number)===String(focus.reference));
  if(focused.length===1)return{trips:focused,scope:'conversation trip'};
 }
 if(truck){
  const candidates=trips.filter(t=>t.truckId===truck.id&&(!date||
   [t.date,t.deliveredDate,t.completedDate,t.closedDate].some(x=>iso(x)===date)));
  if(!candidates.length)return{error:'No saved trip found for '+(truck.fleetName||'ANG truck')+(date?' on '+date:'')+'. Check import history and active dashboard filters.'};
  if(date&&candidates.length===1)return{trips:candidates,scope:'truck and date'};
  if(/\b(?:last|latest|most recent)\b/i.test(q)){
   const sorted=candidates.slice().sort((a,b)=>iso(b.date).localeCompare(iso(a.date))||String(b.id).localeCompare(String(a.id)));
   if(sorted.length>1&&iso(sorted[0].date)===iso(sorted[1].date))return{error:'Multiple trips share the latest date for '+truck.fleetName+'. Give a trip number.',suggestions:sorted.slice(0,5)};
   return{trips:sorted.slice(0,1),scope:'latest truck trip'};
  }
  if(date&&candidates.length>1)return{error:'Multiple trips for '+truck.fleetName+' on '+date+'. Please choose the exact trip.',suggestions:candidates.slice(0,5)};
  return{error:'There are '+candidates.length+' trips for '+truck.fleetName+'. Specify a trip number, date, or ask for its latest trip.',suggestions:candidates.slice(0,5)};
 }
 if(/\b(?:all|fleet|every)\b/i.test(q)&&/\b(?:trips?|fleet)\b/i.test(q)){
  const active=trips.filter(t=>!/\b(?:cancelled|deleted)\b/i.test(t.status||''));
  return{trips:active.slice().sort((a,b)=>iso(b.date).localeCompare(iso(a.date))).slice(0,MAX_TRIPS),scope:'recent fleet sample',total:active.length};
 }
 return{error:'Specify an exact trip number (or ANG truck plus date). For example: Investigate ANG 10 latest trip, or Audit TRIP-204.'};
}
function issue(code,level,evidence,next,topic='trips',task=true){
 return{code,level,evidence:String(evidence).slice(0,350),next:String(next).slice(0,240),topic,task};
}
function tripAudit(state,t,role){
 const tripNo=String(t.number||t.id||'Trip').slice(0,80);
 const truck=(state.trucks||[]).find(x=>x.id===t.truckId);
 const dr=(state.drivers||[]).find(x=>x.id===t.driverId);
 const completed=n(t.stage)>=4||/\b(delivered|completed|closed|invoiced)\b/i.test(String(t.status||''));
 const forPay=n(t.stage)>=3||/\b(delivered|completed)\b/i.test(String(t.status||''));
 const slips=(state.diesel||[]).filter(x=>x.tripId===t.id);
 const metric=Metrics.fuel(t,slips);
 const errs=[];
 if(!dr)errs.push(issue('DRIVER_LINK','high','No uniquely assigned driver on this trip.','Review dispatch and assign the correct driver through the approved trip workflow.','dispatch'));
 if(!t.truckId||!truck)errs.push(issue('TRUCK_LINK','high','No valid fleet truck assignment.','Review the truck assignment in Dispatch.','dispatch'));
 if(!metric.distance)errs.push(issue('DISTANCE_MISSING','high','Saved records have no payable full-trip distance.','Verify start/depot arrival odometers, GPS or the saved route distance.','trips'));
 else if(metric.partial)errs.push(issue('DISTANCE_PARTIAL','high','Only '+metric.distance+' km from partial diesel odometer evidence; not the entire trip.','Record independently verified complete journey kilometres before final payroll.','diesel'));
 else if(metric.estimated)errs.push(issue('DISTANCE_ESTIMATE','review',String(metric.distance)+' km comes from '+metric.distanceSource+'.','Check actual departure and arrival readings before finalizing kilometres.','trips',false));
 if(!slips.length)errs.push(issue('DIESEL_UNLINKED','review','No diesel slips are linked to this trip.','Review uploads and link actual diesel slips; do not invent purchases.','diesel'));
 else{
  const odometers=slips.filter(x=>n(x.odometer)>0).sort((a,b)=>iso(a.date).localeCompare(iso(b.date))||String(a.id).localeCompare(String(b.id)));
  if(!odometers.length)errs.push(issue('DIESEL_ODOMETER_MISSING','review',slips.length+' diesel slip(s), none with a positive odometer.','Review uploaded slip readings or enter the verified value.','diesel'));
  else for(let i=1;i<odometers.length;i++)if(n(odometers[i].odometer)<n(odometers[i-1].odometer)){
   errs.push(issue('ODOMETER_SEQUENCE','high','Slip odometers decrease over the saved date order.','Confirm original slip dates and readings; correct only with actual evidence.','diesel'));break;
  }
  const refs=new Map();
  for(const x of slips){const key=normalize(x.slip||x.receiptNo);if(!key)continue;refs.set(key,(refs.get(key)||0)+1);}
  const duplicates=[...refs.entries()].filter(([,count])=>count>1).map(([ref])=>ref);
  if(duplicates.length)errs.push(issue('SLIP_POSSIBLE_DUPLICATE','review','Repeated slip reference(s): '+duplicates.slice(0,4).join(', ')+'.','Compare original slip images before removing any entries.','diesel'));
  if(!metric.ready)errs.push(issue('FUEL_NOT_READY','review',metric.reason||'Fuel rate cannot be calculated from complete available evidence.','Validate linked diesel litres and complete distance. Do not treat refuelling as exact fuel consumed.','diesel',false));
 }
 const legs=Array.isArray(t.legs)&&t.legs.length?t.legs:[t];
 const missingPOD=legs.filter(l=>!l.pod&&!t.pod);
 if(completed&&missingPOD.length)errs.push(issue('POD_MISSING','high',missingPOD.length+' leg(s) are missing POD evidence.','Upload genuine POD files to the correct journey legs.','driverUploads'));
 const shunter=['trk_ang4','trk_ang5'].includes(t.truckId);
 const invoices=(state.invoices||[]).filter(inv=>inv.tripId===t.id||
  (inv.tripIds||[]).includes(t.id)||(inv.lines||[]).some(l=>l.tripId===t.id)||
  (t.invoiceIds||[]).includes(inv.id)||legs.some(l=>l.invoiceId===inv.id));
 const hasInvoices=invoices.length>0;
 if(completed&&!shunter&&!hasInvoices&&missingPOD.length===0&&finance.has(role))
  errs.push(issue('INVOICE_UNBILLED','review','Trip is delivered with POD evidence but no linked invoice was found.','Review client, leg billing eligibility, VAT/MDC requirements and prepare an invoice for approval.','invoices'));
 if(finance.has(role)&&hasInvoices&&invoices.some(inv=>inv.periodStart&&inv.periodEnd&&inv.periodStart>inv.periodEnd))
  errs.push(issue('INVOICE_DATE_INVALID','high','A linked invoice has a reversed billing start/end date.','Review and correct invoice billing dates using original customer cutoff.','invoices'));
 if(finance.has(role)&&dr&&forPay&&!shunter){
  const workers=(state.employees||[]).filter(e=>Link.resolveDriver(state,e)?.id===dr.id);
  if(workers.length!==1)errs.push(issue('PAYROLL_DRIVER_MAPPING','high',workers.length?workers.length+' staff profiles map to this driver.':'No single employee payroll profile maps to the assigned driver.','Check Drivers & Staff identity mapping before calculating any earnings.','driverAccounts'));
  else{
   const employee=workers[0],billDate=iso(t.deliveredDate||t.completedDate||t.closedDate||t.date);
   const relevant=(state.payroll||[]).filter(p=>p.employeeId===employee.id&&p.periodStart&&p.periodEnd&&p.periodStart<=billDate&&billDate<=p.periodEnd);
   if(!relevant.length)errs.push(issue('PAYROLL_PERIOD_MISSING','review','No payslip covers delivery/billing date '+(billDate||'unknown')+' for '+employee.name+'.','Review NBL invoice dates and generate a matching draft only after confirming the cutoff.','payroll'));
   else{
    for(const p of relevant.slice(0,2)){
     const breakdown=Array.isArray(p.tripBreakdown)?p.tripBreakdown:null;
     if(breakdown&&!breakdown.some(x=>x.tripId===t.id||x.number===t.number))
      errs.push(issue('PAYROLL_TRIP_EXCLUDED',p.status==='Paid'||p.status==='Approved'?'high':'review',p.period+' '+p.status+' payslip covers trip date but lacks this trip in the recorded earnings breakdown.','Check trip delivery date, completion, assigned driver and saved kilometre evidence. Approved/Paid payslips are locked.','payroll'));
     if((p.status==='Approved'||p.status==='Paid')&&metric.partial)
      errs.push(issue('FINALIZED_WITH_PARTIAL_KM','high',p.period+' payroll is finalized although linked trip kilometres are partial.','Flag for payroll review; never automatically modify finalized pay.','payroll'));
    }
   }
  }
  const linked=invoices.filter(i=>i.periodStart&&i.periodEnd);
  if(linked.length){
   for(const invoice of linked.slice(0,2)){
    const matching=(state.payroll||[]).filter(p=>workers.some(e=>e.id===p.employeeId)&&((p.sourceInvoiceIds||[]).includes(invoice.id)||iso(p.periodEnd)===iso(invoice.periodEnd)));
    for(const p of matching)if(p.periodStart!==invoice.periodStart||p.periodEnd!==invoice.periodEnd)
      errs.push(issue('INVOICE_PAYROLL_CUTOFF','high','Invoice '+(invoice.number||invoice.id)+' is '+invoice.periodStart+' to '+invoice.periodEnd+' but '+p.period+' payroll is '+p.periodStart+' to '+p.periodEnd+'.','Review exact billing/payroll dates. Do not overwrite approved or paid payslips.','payroll'));
   }
  }
 }
 return{tripId:t.id,number:tripNo,date:iso(t.date),truck:truck?.fleetName||'',status:String(t.status||'Unknown'),distanceKm:metric.distance,
    distanceSource:metric.distanceSource,partialKm:metric.partial,recordedDieselLitres:metric.litres,linkedDieselSlips:slips.length,
    linkedInvoices:finance.has(role)?invoices.map(x=>x.number||x.id).slice(0,4):undefined,
    issues:errs};
}
function run(q,state,user,focus=null){
 const role=String(user?.role||'');
 if(!operations.has(role))return{answer:'Your account cannot run full operational investigations.',source:'record-permission',page:null,issues:[]};
 const selected=resolve(q,state,focus);
 if(selected.error)return{answer:selected.error,page:'trips',source:'linked-audit',issues:[],records:(selected.suggestions||[]).map(t=>({id:t.id,kind:'trip',label:t.number||t.id}))};
 const rows=selected.trips.map(t=>tripAudit(state,t,role));
 const issues=rows.flatMap(row=>row.issues.map(x=>({...x,tripId:row.tripId,tripNumber:row.number}))).slice(0,MAX_ISSUES);
 const summary=rows.map(row=>row.number+' · '+(row.truck||'Unknown truck')+' · '+row.date+' · '+row.status+
  ' · '+row.distanceKm+' km ('+row.distanceSource+(row.partialKm?', partial':'')+')'+
  ' · '+row.linkedDieselSlips+' linked diesel slip(s)'+(finance.has(role)?' · invoices '+(row.linkedInvoices.join(', ')||'none'):'')+
  '\n'+(row.issues.length?row.issues.map(x=>'['+x.level+'] '+x.code+': '+x.evidence+' Next: '+x.next).join('\n'):'No issues detected in the available checks. This is not a complete accounting or engineering verification.')).join('\n\n');
 const title='Linked operational audit ('+rows.length+' '+(rows.length===1?'trip':'trips')+', '+issues.length+' finding(s))'+
   (selected.total?' · most recent '+rows.length+' of '+selected.total+' saved trips':'')+'.\n';
 return{answer:(title+summary+'\n\nThis report is read-only. For follow-up work, ask “Prepare audit tasks for '+rows[0]?.number+'”; you must approve tasks before saving. Original documents and locked payroll require manual verification.').slice(0,8500),
   page:'trips',source:'linked-audit',issues,records:rows.map(t=>({id:t.tripId,kind:'trip',label:t.number})),
   targets:rows.map(x=>({id:x.tripId,number:x.number}))};
}
const taskCodeToTitle={
 DRIVER_LINK:'Verify assigned driver',
 TRUCK_LINK:'Verify truck assignment',
 DISTANCE_MISSING:'Verify missing trip kilometres',
 DISTANCE_PARTIAL:'Verify complete trip distance',
 DIESEL_UNLINKED:'Find and link genuine diesel slips',
 DIESEL_ODOMETER_MISSING:'Verify diesel slip odometer',
 ODOMETER_SEQUENCE:'Verify diesel odometer sequence',
 SLIP_POSSIBLE_DUPLICATE:'Review possible duplicate diesel slips',
 POD_MISSING:'Collect missing POD',
 INVOICE_UNBILLED:'Review billing eligibility',
 INVOICE_DATE_INVALID:'Correct invoice date evidence',
 PAYROLL_DRIVER_MAPPING:'Review driver employee mapping',
 PAYROLL_PERIOD_MISSING:'Review payroll cutoff and missing draft',
 PAYROLL_TRIP_EXCLUDED:'Check trip excluded from payroll',
 FINALIZED_WITH_PARTIAL_KM:'Review finalized payroll kilometre evidence',
 INVOICE_PAYROLL_CUTOFF:'Resolve NBL invoice/payroll date mismatch'
};
function taskCommands(report,state){
 const activeTitles=new Set((state.tasks||[]).filter(t=>!/\b(?:completed|cancelled|closed)\b/i.test(t.status||'')).map(t=>normalize(t.title)));
 const seen=new Set(),commands=[];
 for(const x of report.issues||[]){
  const prefix=taskCodeToTitle[x.code];if(!prefix||x.task===false)continue;
  const title=(prefix+' for '+x.tripNumber).slice(0,160);
  if(seen.has(normalize(title))||activeTitles.has(normalize(title)))continue;
  seen.add(normalize(title));commands.push('Create task to '+title+' high priority');
  if(commands.length>=8)break;
 }
 return commands;
}
module.exports={isAuditRequest,wantsTasks,dateFromQuestion,resolve,tripAudit,run,taskCommands};
