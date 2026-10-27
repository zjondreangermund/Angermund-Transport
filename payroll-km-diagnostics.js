'use strict';
const Link=require('./payroll-trip-link'),Cycle=require('./payroll-cycle');
const Trips=require('./payroll-manual-trips'),Metrics=require('./public/trip-metrics');
const Eligibility=require('./public/payroll-eligibility');
function broadRequest(question){
 const q=String(question||'');
 return /\b(?:why|check|investigate|diagnose|explain|missing|zero|no|not|dont|doesnt|aren't|isn't|wrong)\b/i.test(q)
  && /\b(?:drivers?|salar(?:y|ies)|wages?|payroll|payslips?)\b/i.test(q)
  && /\b(?:km|kilomet(?:er|re)s?|trip money|trip pay|distance|readings?)\b/i.test(q)
  && !/\b(?:trip|tms|nbl)[\s#:-]*(?:[a-z]*-)?\d{3,}\b/i.test(q)
  && !/\bang[\s-]*\d{1,2}\b/i.test(q);
}
function diagnose(state,{period=null,employeeId=null}={}){
 const payroll=(state.payroll||[]),employees=state.employees?.length?state.employees:state.drivers||[];
 const selected=period||payroll.map(p=>String(p.period||'')).filter(x=>/^\d{4}-\d{2}$/.test(x)).sort().at(-1)||new Date().toISOString().slice(0,7);
 const rows=[];
 for(const employee of employees){
  if(employeeId&&String(employee.id)!==String(employeeId))continue;
  if(employee.active===false||employee.status==='Inactive')continue;
  if(!Eligibility.isDriver(employee,state.drivers||[]))continue;
  const driver=Link.resolveDriver(state,employee),p=payroll.find(x=>x.employeeId===employee.id&&x.period===selected);
  const profile=(state.payProfiles||[]).find(x=>(x.employeeId||x.driverId)===employee.id)||{};
  if(driver&&Cycle.shunterDriver(state,driver,profile))continue;
  const cycle=Cycle.bounds(selected,driver,false,p,profile);
  const trips=driver?Trips.selectedTrips(state,employee.id,driver,p,cycle.start,cycle.end):[];
  const details=trips.map(t=>{
   const diesel=(state.diesel||[]).filter(d=>d.tripId===t.id);
   const distance=Metrics.distance(t,diesel);
   const odo=diesel.filter(d=>Number(d.odometer)>0).map(d=>Number(d.odometer));
   const reasons=[];
   if(!distance.distance){
    reasons.push(odo.length?
      odo.length===1?'Only one linked diesel odometer ('+odo[0]+') and no independently verified full trip distance':
      'Saved diesel odometer readings are not a valid full trip distance':
      'No verified distance and no linked odometer readings');
   }else if(distance.partial)reasons.push('Only '+distance.distance+' km of partial journey evidence, not the full trip');
   if(diesel.length&&!diesel.some(d=>d.verified===true))reasons.push('Diesel slips are awaiting verification; payroll km require valid distance evidence, not just slip approval');
   return{number:t.number||t.id,tripId:t.id,tripDate:t.date,billingDate:Trips.billingDate(t),distanceKm:distance.distance,
    distanceSource:distance.distanceSource,partial:distance.partial,slips:diesel.length,odometerReadings:odo.length,reasons};
  });
  const km=details.reduce((sum,t)=>sum+t.distanceKm,0),payslipKm=p?.tripKm??null;
  const notes=[];
  if(!driver)notes.push('No unambiguous driver linked to the employee; assign the driver first.');
  else if(!p)notes.push('No payslip saved for this month; generate a Draft payroll after checking the cutoff.');
  else if(!trips.length)notes.push('No payable completed trips linked to this driver in the payslip cutoff; review status, driver assignment and delivery date.');
  else{
   if(details.some(t=>t.distanceKm===0))notes.push('One or more eligible trips have no calculable distance.');
   if(details.some(t=>t.partial))notes.push('One or more eligible trips have only partial kilometres; verify departure/arrival or full route before final payment.');
   if(payslipKm===0&&km>0)notes.push(['Approved','Paid'].includes(p.status)?
    'Saved payslip is finalized: trip distance exists now, but the locked record cannot be automatically changed. Review separately.':
    'Draft has outdated zero kilometres; refresh this driver’s Draft payslip.');
   else if(payslipKm!=null&&Math.abs(payslipKm-km)>0.1)notes.push(['Approved','Paid'].includes(p.status)?
    'Current trip evidence differs from the finalized payslip; manual payroll review required.':
    'Saved Draft kilometres differ from eligible trip kilometres; refresh Draft.');
   if(km===0)notes.push('A diesel odometer number is not a distance: at least two valid readings, depot start and end, continuous GPS or a complete saved route are required.');
  }
  rows.push({employeeId:employee.id,employee:employee.name||'',driverId:driver?.id||null,
   status:p?.status||'No payslip',period:selected,start:cycle.start,end:cycle.periodEnd,
   savedKm:payslipKm,expectedKm:Number(km.toFixed(2)),savedTripPay:p?.tripPay??null,
   eligibleTrips:details,issues:notes});
 }
 return{period:selected,rows,notice:'Read-only saved-record inspection. A fuel slip odometer is one observation, not proof of full journey kilometres.'};
}
function reply(q,state){
 const period=/\b20\d{2}-(?:0[1-9]|1[0-2])\b/.exec(q)?.[0]||null;
 const report=diagnose(state,{period});
 const problems=report.rows.filter(r=>r.issues.length);
 const lines=['Driver payroll kilometre diagnosis for '+report.period+' (saved application records):',
  report.rows.length+' transport driver(s) checked; '+problems.length+' with missing/outdated payroll evidence.'];
 for(const row of (problems.length?problems:report.rows).slice(0,12)){
  lines.push(row.employee+' · payslip '+row.status+' · '+row.start+' to '+row.end+
   ' · saved '+(row.savedKm===null?'no payslip':row.savedKm+' km')+
   ' / eligible current '+row.expectedKm+' km.');
  for(const t of row.eligibleTrips.filter(x=>x.reasons.length).slice(0,3))
   lines.push('  '+t.number+': '+t.reasons.join('; ')+'.');
  for(const note of row.issues)lines.push('  Action: '+note);
 }
 if(!problems.length)lines.push('No discrepancy was detected in these saved records. Check the exact payslip display if values still appear as zero.');
 lines.push('I did not change any payroll. To repair: verify driver + delivery/cutoff, check valid trip start/end or complete GPS/route distance, then refresh Draft payroll. Paid/Approved payslips stay locked.');
 return{answer:lines.join('\n').slice(0,5500),page:'payroll',source:'live-payroll-km-diagnostics',period:report.period};
}
module.exports={broadRequest,diagnose,reply};
