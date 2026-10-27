'use strict';
// Explicit, persisted early payment of completed transport trips. Allocation
// lives on the target payslip and survives all normal draft recalculations.
// Any later cycle automatically excludes trips manually paid in another cycle.
const Link=require('./payroll-trip-link');
const Cycle=require('./payroll-cycle');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const date=x=>String(x||'').slice(0,10);
const completed=t=>!/(cancelled|canceled|deleted)/i.test(String(t.status||''))&&
  (Number(t.stage||0)>=3||/delivered|completed|complete|invoiced/i.test(String(t.status||'')));
const billingDate=t=>date(t.deliveredDate||t.completedDate||t.closedDate||t.date);
const frozen=p=>['Approved','Paid'].includes(p.status);
const tripIds=p=>Array.isArray(p.manualTripIds)?p.manualTripIds.map(String):[];
function matchedByOtherPayslip(state,trip,employeeId,targetId){
 const claims=[];
 for(const p of state.payroll||[]){
  if(String(p.id)===String(targetId))continue;
  if(tripIds(p).includes(String(trip.id)))claims.push({p,reason:'manual'});
  if(frozen(p)&&Array.isArray(p.tripBreakdown)&&p.tripBreakdown.some(x=>String(x.tripId||'')===String(trip.id)))
    claims.push({p,reason:'finalized'});
  if(frozen(p)&&!Array.isArray(p.tripBreakdown)&&p.employeeId===employeeId){
   const d=billingDate(trip);
   if(d&&d>=date(p.periodStart)&&d<=date(p.periodEnd))claims.push({p,reason:'legacy-finalized'});
  }
 }
 return claims;
}
function selectedTrips(state,employeeId,driver,payslip,start,end){
 if(!driver)return[];
 const target=String(payslip?.id||'');
 const all=Link.eligibleTrips(state,driver,'0000-01-01','9999-12-31',{billingDate:true})
   .filter(t=>!Cycle.isShunter(state,t));
 const manual=new Set(tripIds(payslip));
 const result=all.filter(t=>{
   const claims=matchedByOtherPayslip(state,t,employeeId,target);
   if(claims.length)return false;
   const bill=billingDate(t);
   return manual.has(String(t.id))||(bill>=start&&bill<end);
 });
 return result.sort((a,b)=>billingDate(a).localeCompare(billingDate(b))||String(a.number||a.id).localeCompare(String(b.number||b.id)));
}
function ensureTarget(state,payslip,driver){
 if(!payslip)fail('Payslip not found.',404);
 if(frozen(payslip))fail('Approved/Paid payslips are locked. Edit a Draft payslip before approving it.',409);
 if(!driver)fail('The employee must have a linked transport driver before assigning a trip.',409);
 const profile=(state.payProfiles||[]).find(p=>(p.employeeId||p.driverId)===payslip.employeeId)||{};
 if(Cycle.shunterDriver(state,driver,profile))fail('Shunter earnings are calculated by worked days, not manual trip kilometres.',409);
}
function candidateTrips(state,payslip,driver){
 if(!payslip||!driver)return[];
 const cutoff=date(payslip.periodEnd);
 return(state.trips||[]).filter(t=>{
   if(String(t.driverId)!==String(driver.id)||!completed(t)||Cycle.isShunter(state,t))return false;
   if(!(billingDate(t)>cutoff)||tripIds(payslip).includes(String(t.id)))return false;
   if(matchedByOtherPayslip(state,t,payslip.employeeId,payslip.id).length)return false;
   return true;
 }).sort((a,b)=>billingDate(a).localeCompare(billingDate(b))||String(a.number||a.id).localeCompare(String(b.number||b.id)))
   .slice(0,120).map(t=>({id:t.id,number:t.number||t.id,date:date(t.date),deliveryDate:billingDate(t),truckId:t.truckId,
     load:(t.legs||[]).map(l=>l.load||'').filter(Boolean).join(' / ')||t.load||'',status:t.status}));
}
function assign(state,payslip,driver,tripId,actor=''){
 ensureTarget(state,payslip,driver);
 const trip=(state.trips||[]).find(t=>String(t.id)===String(tripId));
 if(!trip)fail('Trip not found in saved dispatch records.',404);
 if(String(trip.driverId)!==String(driver.id))fail('Trip belongs to a different driver. Correct dispatch assignment before payroll.',409);
 if(!completed(trip))fail('Only delivered or payroll-eligible trips can be allocated to a payslip.',409);
 if(Cycle.isShunter(state,trip))fail('Shunter trips cannot be paid by the transport kilometre allocation.',409);
 const bill=billingDate(trip),cutoff=date(payslip.periodEnd);
 if(!bill||bill<=cutoff)fail('The selected trip is not after this payslip cutoff; trips within the cutoff are included automatically.',409);
 const claims=matchedByOtherPayslip(state,trip,payslip.employeeId,payslip.id);
 const locked=claims.find(c=>frozen(c.p));
 if(locked)fail('Trip is already on a finalized payslip or requires legacy payslip review ('+locked.p.period+'). Do not pay it twice.',409);
 const manual=claims.find(c=>c.reason==='manual');
 if(manual)fail('Trip was manually allocated to the '+manual.p.period+' payslip. Remove that allocation before moving it.',409);
 if(tripIds(payslip).includes(String(trip.id)))fail('Trip already assigned to this payslip.',409);
 if(tripIds(payslip).length>=20)fail('A payslip can carry forward at most 20 manually selected trips.',400);
 payslip.manualTripIds=[...tripIds(payslip),String(trip.id)];
 payslip.manualTripLog=[...(payslip.manualTripLog||[]),{tripId:trip.id,action:'included-early',at:new Date().toISOString(),actor:String(actor).slice(0,80),billingDate:bill,cutoff}].slice(-60);
 return trip;
}
function remove(state,payslip,driver,tripId,actor=''){
 ensureTarget(state,payslip,driver);
 if(!tripIds(payslip).includes(String(tripId)))fail('Trip is not manually allocated to this payslip.',404);
 payslip.manualTripIds=tripIds(payslip).filter(x=>x!==String(tripId));
 payslip.manualTripLog=[...(payslip.manualTripLog||[]),{tripId:String(tripId),action:'removed',at:new Date().toISOString(),actor:String(actor).slice(0,80)}].slice(-60);
 return(state.trips||[]).find(t=>String(t.id)===String(tripId))||null;
}
module.exports={selectedTrips,candidateTrips,assign,remove,billingDate,completed,matchedByOtherPayslip,frozen};
