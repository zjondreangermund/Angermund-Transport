'use strict';
// Read-only investigations from the SAME state powering Dispatch, Diesel and Payroll.
// Never assume that an assigned truck proves who drove, or that a fuel-slip odometer
// proves complete journey km. Nothing in this module modifies invoices or salaries.
const Link=require('./payroll-trip-link');
const PayrollTrips=require('./payroll-manual-trips');
const Cycle=require('./payroll-cycle');
const Metrics=require('./public/trip-metrics');
const Eligibility=require('./public/payroll-eligibility');
const has=(text,re)=>re.test(String(text||''));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const d=v=>String(v||'').slice(0,10);
const text=v=>String(v??'');
const money=v=>'N$'+n(v).toFixed(2);
const normalized=v=>text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const finance=new Set(['admin','manager','finance']);
const operational=new Set(['admin','manager','finance','dispatcher']);
const modes=new Set(['driver_earnings_audit','driver_slip_audit','payroll_gap_summary','unassigned_trip_audit','truck_slip_audit','unbilled_completed_audit','trip_distance_audit','payroll_early_trip_check','fleet_data_quality','diesel_duplicate_audit']);
function detect(q){
 const phrase=text(q).trim();
 if(!phrase||/^\s*(?:create|add|delete|remove|edit|move|assign|approve|pay|save|set|change|update|generate)\b/i.test(phrase))return null;
 if(has(phrase,/\b(?:invoice|invoiced)\b/i)&&has(phrase,/\b(?:salary|payroll|payslip|trip pay|driver pay)\b/i))
  return 'driver_earnings_audit';
 if(has(phrase,/\b(?:payslip|payroll|salary|salaries|earnings|trip pay|trip money|driver pay)\b/i)&&has(phrase,/\b(?:why|0\b|zero|missing|not|no |excluded|eligible|check|investigate|diagnos|trip|km|wrong|double|show)\b/i))
  return 'driver_earnings_audit';
 if(has(phrase,/\b(?:slips?|receipts?|fuel|diesel)\b/i)&&has(phrase,/\b(?:missing|not|which|all|every|check|link|have|has|without)\b/i)&&has(phrase,/\b(?:drivers?|trips?|truck|ang[\s-]*\d+)\b|\b(?:for|of)\s+[A-Z][a-z]{2,}/i))
  return 'driver_slip_audit';
 if(has(phrase,/\b(?:which|who|all|find|check|list|show|why)\b/i)&&
  (has(phrase,/\b(?:payslips?|payroll|salary|salaries|wages|pay)\b/i)||
   has(phrase,/\bdrivers?\b/i)&&has(phrase,/\b(?:no km|zero km|unpaid trips)\b/i))&&
  has(phrase,/\b(?:zero|missing|no trips|without|not paid|no km|discrepanc|shortpaid)\b/i))
  return 'payroll_gap_summary';
 if(has(phrase,/\b(?:trips?|loads?)\b/i)&&has(phrase,/\b(?:without|no|missing|unassigned)\b/i)&&has(phrase,/\b(?:driver|truck|assignment)\b/i))
  return 'unassigned_trip_audit';
 if(has(phrase,/\b(?:unbilled|uninvoiced|not invoiced|awaiting invoice|ready to bill|ready for billing)\b/i)&&has(phrase,/\b(?:trips?|loads?|delivery|deliveries)\b/i))
  return 'unbilled_completed_audit';
 if(has(phrase,/\b(?:km|kilomet|distance|odometer)\b/i)&&has(phrase,/\b(?:missing|zero|no |wrong|partial|not calculated|check|find)\b/i)&&has(phrase,/\b(?:trips?|drivers?|truck|fleet)\b/i))
  return 'trip_distance_audit';
 if(has(phrase,/\b(?:after cutoff|after cut off|early pay|paid early|next payslip|double.?pay|carried over|carryover)\b/i))
  return 'payroll_early_trip_check';
 if(has(phrase,/\b(?:duplicate|twice|duplicated)\b/i)&&has(phrase,/\b(?:fuel|diesel|receipts?|slips?)\b/i))
  return 'diesel_duplicate_audit';
 if(has(phrase,/\b(?:data quality|incomplete records|everything missing|audit fleet|fleet issues)\b/i))
  return 'fleet_data_quality';
 return null;
}
function getPeriod(q,s,now=new Date()){
 const explicit=/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/.exec(q);
 if(explicit)return explicit[1]+'-'+explicit[2].padStart(2,'0');
 const m=/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(20\d{2})\b/i.exec(q);
 if(m){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase())+1;return m[2]+'-'+String(month).padStart(2,'0');}
 const saved=(s.payroll||[]).map(p=>p.period).filter(v=>/^20\d{2}-\d{2}$/.test(text(v))).sort();
 return saved.at(-1)||now.toISOString().slice(0,7);
}
function resolveEmployee(q,s,explicit=null){
 const candidate=text(q+' '+(explicit||'')).toLowerCase(),tokens=' '+normalized(candidate)+' ';
 const employees=s.employees?.length?s.employees:(s.drivers||[]);
 const matched=employees.filter(e=>{
  const names=[e.name,[e.firstName,e.lastName].filter(Boolean).join(' ')].filter(Boolean);
  const linked=Link.resolveDriver(s,e);if(linked?.name)names.push(linked.name);
  return names.some(name=>{
   const full=normalized(name),parts=full.split(' ').filter(x=>x.length>=4);
   return full.length>2&&(tokens.includes(' '+full+' ')||parts.some(x=>tokens.includes(' '+x+' ')));
  });
 });
 if(matched.length>1)return{error:'Multiple employees match that name: '+matched.slice(0,5).map(x=>x.name).join(', ')+'. Give the full name.',ambiguous:true};
 if(!matched.length)return{error:'No employee name matched this question.',absent:true};
 const employee=matched[0],driver=Link.resolveDriver(s,employee);
 return{employee,driver};
}
function resolveTruck(q,s){
 const match=/\bang\s*[- ]*0?(\d{1,2})\b/i.exec(q);
 if(!match)return null;return(s.trucks||[]).find(x=>Number((/ang\s*[- ]*0?(\d{1,2})/i.exec(String(x.fleetName||''))||[])[1])===Number(match[1])||x.id==='trk_ang'+Number(match[1]))||null;
}
function candidateTripInfo(s,t,range,driver){
 const slip=(s.diesel||[]).filter(x=>String(x.tripId)===String(t.id));
 const km=Metrics.distance(t,slip);
 const complete=PayrollTrips.completed(t),shunter=Cycle.isShunter(s,t);
 const when=PayrollTrips.billingDate(t),inRange=Boolean(when&&when>=range.start&&when<range.end);
 const other=PayrollTrips.matchedByOtherPayslip(s,t,range.employeeId,range.payslip?.id||'');
 const issues=[];
 if(!driver||String(t.driverId)!==String(driver.id))issues.push('Trip is not linked to the payroll driver ID; verify the actual driver in Dispatch');
 if(!complete)issues.push('Trip is not Delivered/Completed or is cancelled; verify status');
 if(shunter)issues.push('ANG4/ANG5 trip follows shunter rules, not transport trip km pay');
 if(!inRange)issues.push('Delivery/billing date '+(when||'missing')+' is outside '+range.start+' to '+range.periodEnd);
 if(other.length)issues.push('Already allocated to a different payslip ('+other[0].p.period+', '+other[0].reason+'); do not pay twice');
 if(km.distance<=0)issues.push('No payable full-trip distance saved; check verified trip start/end, GPS, route and linked odometers');
 else if(km.partial)issues.push('Only partial '+km.distance+' km evidence; verify full journey before final payment');
 return{tripId:t.id,number:t.number||t.id,truck:(s.trucks||[]).find(x=>x.id===t.truckId)?.fleetName||'',date:d(t.date),billingDate:when,assignedDriverId:t.driverId||null,
  status:t.status||'',stage:t.stage||0,distanceKm:km.distance,source:km.distanceSource,partial:Boolean(km.partial),
  dieselSlips:slip.length,verifiedSlips:slip.filter(x=>x.verified===true).length,issues,eligible:issues.every(x=>!/(not linked|not Delivered|follows shunter|outside|Already allocated)/i.test(x))};
}
function driverReport(s,employee,period){
 const driver=Link.resolveDriver(s,employee),profile=(s.payProfiles||[]).find(p=>(p.employeeId||p.driverId)===employee.id)||{};
 const slip=(s.payroll||[]).find(p=>p.employeeId===employee.id&&p.period===period)||null;
 const shunter=Cycle.shunterDriver(s,driver,profile);
 const bounds=Cycle.bounds(period,driver,shunter,slip,profile);
 const range={...bounds,employeeId:employee.id,payslip:slip};
 const strict=driver?(s.trips||[]).filter(t=>String(t.driverId)===String(driver.id)):[];
 const related=driver?(s.trips||[]).filter(t=>
   String(t.driverId)===String(driver.id)||String(t.driverId)===String(employee.id)&&String(employee.id)!==String(driver.id)):[];
 const trips=related.filter(t=>{
   const when=PayrollTrips.billingDate(t),original=d(t.date);
   return (when&&when>=bounds.start&&when<bounds.end)||(original&&original>=bounds.start&&original<bounds.end)||(slip?.manualTripIds||[]).includes(t.id);
 }).map(t=>candidateTripInfo(s,t,range,driver));
 const payable=driver&&!shunter?PayrollTrips.selectedTrips(s,employee.id,driver,slip,bounds.start,bounds.end):[];
 const expected=payable.reduce((sum,t)=>sum+Metrics.distance(t,(s.diesel||[]).filter(x=>x.tripId===t.id)).distance,0);
 return{employee,driver,profile,payslip:slip,shunter,bounds,assignedCount:strict.length,candidates:trips,eligibleCount:payable.length,
  expectedKm:Number(expected.toFixed(2)),savedKm:slip?.tripKm??null,savedPay:slip?.tripPay??null};
}
function formatReport(r,kind){
 const name=r.employee.name||r.driver?.name||'Employee';
 const rows=[name+' · '+r.bounds.start+' to '+r.bounds.periodEnd+
   ' · '+(r.payslip?'payslip '+r.payslip.status:'no saved payslip')+
   ' · saved '+(r.savedKm===null?'not generated':r.savedKm+' km / '+money(r.savedPay)+' trip pay')+
   ' · '+r.eligibleCount+' payable trip(s) · recalculated eligible '+r.expectedKm+' km.'];
 if(r.shunter){
  rows.push('ANG4/5 shunter assignment: monthly basic plus worked-day bonus, not trip-km pay.');return rows.join('\n');
 }
 if(!r.driver){rows.push('No uniquely linked driver ID in Drivers & Staff; cannot safely allocate a trip to this employee.');return rows.join('\n');}
 if(!r.candidates.length)rows.push('No assigned trips fall in these dates. Check Dispatch driver assignments, delivery dates, and Excel import records. No invoice is needed to earn driver km pay.');
 else for(const t of r.candidates.slice(0,14)){
  rows.push(t.number+' · '+t.billingDate+' · '+t.truck+' · '+t.status+' · '+t.distanceKm+' km ('+t.source+') · '+t.dieselSlips+' linked diesel slips ('+t.verifiedSlips+' verified).');
  if(kind==='driver_slip_audit')rows.push(t.dieselSlips?'  Diesel record(s) linked. Verify source/receipt and whether the interval is complete.':'  No diesel record linked. This alone does NOT prove no trip occurred or block payroll if reliable distance is saved.');
  for(const issue of t.issues.slice(0,4))rows.push('  Check: '+issue);
 }
 if(!r.payslip)rows.push('Generate Draft payslip for this cutoff after reviewing assignment/status/distance.');
 else if(['Approved','Paid'].includes(r.payslip.status))rows.push('Finalized payslip is locked; differences require human payroll review.');
 else if(Math.abs(n(r.payslip.tripKm)-r.expectedKm)>.1)rows.push('Draft differs from verified eligible kilometres. Refresh Draft payroll after correcting saved records.');
 if(kind==='driver_slip_audit'&&!r.candidates.length)rows.push('No matching saved trip records in this period, so no missing-slip claim can be verified.');
 rows.push('Invoicing is NOT a prerequisite for trip pay. NBL invoices can set exact payroll cutoff dates; trips still need driver assignment, eligible status, valid payable distance and no prior payment.');
 return rows.join('\n');
}
function run(mode,q,s,user={},options={}){
 if(!modes.has(mode))return null;
 const role=text(user.role);
 if(!operational.has(role))return{answer:'Your role cannot view operational records.',source:'record-permission'};
 if(!finance.has(role)&&['driver_earnings_audit','payroll_gap_summary','payroll_early_trip_check'].includes(mode))
  return{answer:'Finance payroll records require admin, manager or finance permission.',source:'record-permission'};
 const period=getPeriod(q,s,options.now);
 const reportName=resolveEmployee(q,s,options.person);
 if(['driver_earnings_audit','driver_slip_audit','payroll_early_trip_check'].includes(mode)){
  if(!reportName.employee){
   if(reportName.ambiguous)return{answer:reportName.error,page:'driverAccounts',source:'live-audit'};
   if(mode!=='driver_earnings_audit'&&mode!=='payroll_early_trip_check')
    return broad(mode,q,s,user,period);
   if(mode==='driver_earnings_audit')return broad('payroll_gap_summary',q,s,user,period);
   return{answer:'Specify the driver to check after-cutoff trip allocations.',page:'payroll',source:'live-audit'};
  }
  const r=driverReport(s,reportName.employee,period);
  let answer=mode==='driver_slip_audit'&&!finance.has(role)?
   (r.employee.name+' · '+period+' · '+r.candidates.length+' matching saved trip(s):\n'+
    r.candidates.slice(0,14).map(t=>t.number+' · '+t.truck+' · '+t.status+' · '+t.dieselSlips+' linked fuel slips ('+t.verifiedSlips+' verified)'+
     (t.dieselSlips?'':'. Check uploaded receipts and trip linking; a slip is not required for km earnings if valid journey distance is saved.')).join('\n')):
   formatReport(r,mode);
  if(mode==='payroll_early_trip_check'){
   const early=(r.payslip?.manualTripIds||[]).map(id=>(s.trips||[]).find(t=>t.id===id)).filter(Boolean);
   answer+='\nManually paid-early trips on this payslip: '+early.length+
    (early.length?'\n'+early.map(t=>t.number||t.id).join(', '):'.');
  }
  return{answer:answer.slice(0,9000),page:'payroll',source:'linked-payroll-trip-audit',
   period,records:r.candidates.slice(0,12).map(t=>({id:t.tripId,label:t.number,kind:'trip'}))};
 }
 return broad(mode,q,s,user,period);
}
function broad(mode,q,s,user,period){
 const rows=[];
 if(mode==='payroll_gap_summary'){
  for(const employee of (s.employees||[]).filter(e=>Eligibility.isDriver(e,s.drivers||[]))){
   const r=driverReport(s,employee,period);if(r.shunter)continue;
   if(r.savedKm===0||r.savedKm===null||r.eligibleCount&&Math.abs(n(r.savedKm)-r.expectedKm)>.1)
    rows.push(employee.name+': saved '+(r.savedKm===null?'no payslip':r.savedKm+' km')+', eligible '+r.expectedKm+' km, '+r.eligibleCount+' eligible trips'+
     (!r.driver?' · missing linked driver record':'')+
     (!r.candidates.length?' · no matching completed trips in cutoff':'')+
     (r.payslip&&['Paid','Approved'].includes(r.payslip.status)?' · locked finalized pay':''));
  }
  return{answer:'Payroll gap review · '+period+' · '+rows.length+' drivers needing verification:\n'+(rows.slice(0,20).join('\n')||'No gaps detected in saved payroll.')+
   '\nInvoices are not required for trip-pay eligibility. Review each matching trip, distance, driver assignment and cutoff before generating Draft corrections.',page:'payroll',source:'live-audit'};
 }
 let selected=[],heading='',page='trips';
 const truck=resolveTruck(q,s);const trips=(s.trips||[]).filter(t=>!truck||t.truckId===truck.id);
 if(mode==='driver_slip_audit'||mode==='truck_slip_audit'){
  const all=trips.filter(t=>PayrollTrips.completed(t));
  selected=all.filter(t=>!(s.diesel||[]).some(d=>d.tripId===t.id));heading='Completed trips with no linked diesel slips';page='diesel';
 }else if(mode==='unassigned_trip_audit'){
  selected=trips.filter(t=>!t.driverId||!(s.drivers||[]).some(d=>d.id===t.driverId));heading='Trips without a valid linked driver';page='trips';
 }else if(mode==='unbilled_completed_audit'){
  selected=trips.filter(t=>PayrollTrips.completed(t)&&!(t.invoiceIds||[]).length&&!(s.invoices||[]).some(inv=>inv.tripId===t.id||(inv.tripIds||[]).includes(t.id)||(inv.lines||[]).some(l=>l.tripId===t.id)));heading='Completed trips without linked invoice evidence';page='invoices';
 }else if(mode==='trip_distance_audit'){
  selected=trips.filter(t=>PayrollTrips.completed(t)&&Metrics.distance(t,(s.diesel||[]).filter(x=>x.tripId===t.id)).distance<=0);heading='Completed trips without usable distance';page='trips';
 }else if(mode==='diesel_duplicate_audit'){
  const slips=s.diesel||[],map=new Map();
  for(const slip of slips){const key=normalized(slip.slip||slip.receiptNo||'');if(key)map.set(key,[...(map.get(key)||[]),slip]);}
  const duplicates=[...map.entries()].filter(([,items])=>items.length>1);
  return{answer:'Possible duplicated diesel reference(s): '+duplicates.length+'\n'+
   (duplicates.slice(0,15).map(([ref,items])=>ref+': '+items.length+' records; check original slip images before removing anything').join('\n')||'None detected from saved reference strings.')+
   '\nRepeated identifiers are not definitive proof of duplicate purchases.',page:'diesel',source:'live-audit'};
 }else if(mode==='fleet_data_quality'){
  const subsets=[['No valid driver',trips.filter(t=>!t.driverId||!(s.drivers||[]).some(d=>d.id===t.driverId)).length],
   ['Delivered without POD',trips.filter(t=>PayrollTrips.completed(t)&&!t.pod&&!(t.legs||[]).every(l=>l.pod)).length],
   ['Completed without distance',trips.filter(t=>PayrollTrips.completed(t)&&!Metrics.distance(t,(s.diesel||[]).filter(x=>x.tripId===t.id)).distance).length],
   ['Diesel not verified',(s.diesel||[]).filter(x=>!x.verified).length]];
  return{answer:'Fleet records quality snapshot:\n'+subsets.map(([name,count])=>name+': '+count).join('\n')+
   '\nNo fixes or payments were made. Use more specific questions to list affected trips.',page:'trips',source:'live-audit'};
 }
 const listed=selected.slice(0,18);
 return{answer:heading+': '+selected.length+(truck?' for '+truck.fleetName:'')+'.'+
   (listed.length?'\n'+listed.map(t=>(t.number||t.id)+' · '+d(t.date)+' · '+(t.status||'unknown')+' · '+((s.drivers||[]).find(x=>x.id===t.driverId)?.name||'Unassigned')).join('\n'):'\nNone found in saved app records.')+
   (mode==='unbilled_completed_audit'?'\nThis is an invoice-record check, not a condition for calculating driver trip money.':'')+
   '\nCheck source documents and saved links before taking action.',page,source:'live-audit',
   records:listed.map(t=>({id:t.id,kind:'trip',label:t.number||t.id}))};
}
module.exports={detect,run,getPeriod,resolveEmployee,driverReport,formatReport,modes};
