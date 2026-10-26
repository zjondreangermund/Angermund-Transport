'use strict';
// Read-only, permission-aware answers grounded in the live operations state.
// No AI guesses, no changes, and no exposure of payroll to dispatch/driver roles.
const Cycle=require('./payroll-cycle');
const Link=require('./payroll-trip-link');
const Metrics=require('./public/trip-metrics');
const clean=x=>String(x||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ');
const fmt=x=>'N$ '+Number(x||0).toLocaleString('en-NA',{minimumFractionDigits:2,maximumFractionDigits:2});
const eq=(a,b)=>clean(a).trim()===clean(b).trim();
function workforce(state){return(state.employees||[]).filter(e=>e.active!==false&&e.status!=='Inactive');}
function driverFor(state,employee){return Link.resolveDriver(state,employee);}
function profileFor(state,employee){return(state.payProfiles||[]).find(p=>String(p.employeeId||p.driverId)===String(employee.id))||{};}
function findEmployee(state,question){
 const q=clean(question);
 const rows=workforce(state).filter(e=>{const d=driverFor(state,e);
   return [e.name,d?.name].filter(Boolean).some(name=>{
     const n=clean(name).trim();return n.length>=3&&(' '+q+' ').includes(' '+n+' ')||
       n.split(' ').some(w=>w.length>=4&&(' '+q+' ').includes(' '+w+' '));
   });
 });
 return rows.length===1?rows[0]:null;
}
function truckMention(state,q){
 const match=/\bang\s*0?(\d{1,2})\b/i.exec(q);
 if(!match)return null;
 return(state.trucks||[]).find(t=>Number((/ang\s*0?(\d{1,2})/i.exec(String(t.fleetName||''))||[])[1])===Number(match[1])||
   eq(t.id,'trk_ang'+match[1]))||null;
}
function dateMention(q){
 const iso=/\b20\d{2}-\d{2}-\d{2}\b/.exec(q);if(iso)return iso[0];
 const m=/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i.exec(q);
 if(!m)return null;const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase().slice(0,3))+1;
 return m[3]+'-'+String(month).padStart(2,'0')+'-'+m[1].padStart(2,'0');
}
function result(answer,page,records=[]){return{answer,page,records:records.slice(0,6),source:'live-operations-diagnostics',aiEnabled:false};}
function answer(question,state={},user={}){
 const q=String(question||'').trim();if(!q)return null;
 const role=String(user.role||''),finance=['admin','manager','finance'].includes(role),ops=finance||role==='dispatcher';
 const employee=findEmployee(state,q),truck=truckMention(state,q),date=dateMention(q);
 const period=/\b20\d{2}-(?:0[1-9]|1[0-2])\b/.exec(q)?.[0];
 const payrollAsked=/\b(payroll|payslip|salary|wages|trip pay|driver pay|daily bonus|cut.?off|pay period|shunter bonus)\b/i.test(q);
 if(finance&&/\b(shunter|shunting)\b/i.test(q)&&/\b(bonus|pay|amount|rate|daily|settings?|setup|who|how much)\b/i.test(q)){
   const rows=workforce(state).map(e=>({e,d:driverFor(state,e),p:profileFor(state,e)})).filter(x=>Cycle.shunterDriver(state,x.d,x.p));
   if(!rows.length)return result('There are no linked shunter drivers in the saved payroll profiles. Open Shunter Bonus, choose a driver and save their monthly bonus pool and working-day divisor.','shunterBonus');
   const selected=employee?rows.filter(x=>x.e.id===employee.id):rows;
   if(!selected.length)return result('That worker is not currently set to the shunter pay basis. Open Shunter Bonus to assign their driver profile.','shunterBonus');
   return result(selected.slice(0,10).map(x=>{
     const amount=Number(x.p.shunterBonusAmount??8000),days=Number(x.p.shunterWorkingDays??20);
     return x.e.name+': '+fmt(amount)+' bonus pool / '+days+' working days = '+fmt(days>0?amount/days:0)+' for each recorded driving day. Stored settings continue every month until edited.';
   }).join('\n')+'\nOne driving day is counted once, not once per load. Draft payroll must be refreshed to apply changed rates.','shunterBonus');
 }
 if(finance&&/\b(cut.?off|pay period|payroll dates?|billing period)\b/i.test(q)){
   const selected=employee?[employee]:workforce(state).filter(e=>driverFor(state,e)).slice(0,8);
   if(!selected.length)return result('No linked transport drivers were found. The date range chosen for an NBL invoice is used exactly for the matching drivers\' payroll drafts.','payroll');
   return result(selected.map(e=>{
     const d=driverFor(state,e),p=profileFor(state,e),shunter=Cycle.shunterDriver(state,d,p);
     const active=(state.payroll||[]).filter(x=>x.employeeId===e.id).sort((a,b)=>String(b.period||'').localeCompare(String(a.period||'')))[0];
     return e.name+': '+(shunter?'calendar month (shunter)':'cutoff day '+String(p.cutoffDay??20)+'; invoice dates override this')+
       (active?' · saved '+active.period+' payslip '+(active.periodStart||'?')+' to '+(active.periodEnd||'?')+' ('+active.status+')':' · no saved payslip');
   }).join('\n')+'\nChange a recurring cutoff in Payroll & Payslips → Edit. Choose exact dates when creating an NBL invoice; its linked draft payslips use those dates. Approved and Paid payslips are not overwritten.','payroll');
 }
 if(ops&&/\b(trips?|loads?|dispatch|imports?)\b/i.test(q)&&/\b(missing|not (?:loaded|loading|showing|there|visible|found)|can.?t (?:see|find)|where (?:is|are)|why|find|search)\b/i.test(q)){
   const candidates=(state.trips||[]).filter(t=>{
     if(truck&&t.truckId!==truck.id)return false;
     if(date&&![t.date,t.deliveredDate,t.completedDate,t.closedDate].some(d=>String(d||'').slice(0,10)===date))return false;
     const specific=/\b(?:trip|tms|order)\s*(?:no\.?|number|#|reference)?\s*([A-Z0-9-]{5,})\b/i.exec(q)?.[1];
     if(specific&&!/^(manual|loaded|missing|showing|import|number|found|where)$/i.test(specific)){
       const fields=[t.number,t.id,t.sourceOrderRef,t.externalTmsId,t.sourceTmsId,t.carrierDetails?.tmsId];
       if(!fields.some(x=>eq(x,specific)))return false;
     }
     return true;
   }).slice(0,40);
   if(!candidates.length)return result('No matching trip was found in the live saved trips'+(truck?' for '+truck.fleetName:'')+(date?' on '+date:'')+'. Check the chosen date/truck filters and Excel Import Centre preview/history; an uncommitted preview is not a saved trip. I cannot confirm why an absent import failed without its import log.','trips');
   const recent=candidates.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,6);
   return result('I found '+candidates.length+' matching saved trip(s)'+(truck?' for '+truck.fleetName:'')+'. '+recent.map(t=>(t.number||t.id)+' · '+(t.date||'?')+' · '+(t.status||'status unknown')+' · '+((state.trucks||[]).find(x=>x.id===t.truckId)?.fleetName||'truck unknown')).join('\n')+'\nIf they do not appear on screen, check the active month/truck filters and reload the dispatch view.','trips',recent.map(t=>({kind:'trip',id:t.id,label:t.number||t.id})));
 }
 if(finance&&payrollAsked&&/\b(why|missing|not|where|show|detail|trip|km|distance|calculated|included|how much)\b/i.test(q)){
   if(!employee)return result('I can check exact trip pay and payslip exclusions, but need a driver name to identify the correct payroll record. Ask, for example, “Why is Josef\'s October 2026 trip pay missing?”','payroll');
   const d=driverFor(state,employee),p=profileFor(state,employee);
   if(!d)return result(employee.name+' does not have an unambiguous linked driver record, so completed trips cannot safely be allocated to their payslip. Check the Drivers & Staff mapping.','driverAccounts');
   const saved=(state.payroll||[]).filter(x=>x.employeeId===employee.id).sort((a,b)=>String(b.period||'').localeCompare(String(a.period||'')));
   const pay=period?saved.find(x=>x.period===period):saved[0];
   if(!pay)return result('No '+(period||'saved')+' payslip exists for '+employee.name+'. Open Payroll & Payslips and generate a draft; confirmed NBL invoice dates also create matching driver drafts.','payroll');
   const eligible=Link.eligibleTrips(state,d,pay.periodStart||'0000-01-01',Cycle.dayAfter(pay.periodEnd||'9999-01-01'),{billingDate:!Cycle.shunterDriver(state,d,p)});
   const lines=[employee.name+' · '+pay.periodStart+' to '+pay.periodEnd+' · '+pay.status,
     'Trip pay: '+fmt(pay.tripPay)+' · counted kilometres: '+Number(pay.tripKm||0)+' km · completed trips: '+(pay.tripCount??eligible.length),
     'Shunter bonus: '+fmt(pay.shunterBonus)+' · '+Number(pay.shunterDays||0)+' driving days.'];
   if(!eligible.length)lines.push('No eligible completed trips were linked to this driver in the saved cutoff dates. Check assignment, delivery/completed status and delivery dates.');
   if(eligible.length&&!Number(pay.tripKm))lines.push('Linked trips have no validated payable kilometres yet. Check trip GPS, depot/arrival odometer and linked diesel slip odometers.');
   if(['Approved','Paid'].includes(pay.status))lines.push('This payslip is finalized. Later imports or trip changes will not rewrite its earnings.');
   else lines.push('Draft payslip can be refreshed after correcting records; invoice-linked dates stay aligned with the invoice.');
   return result(lines.join('\n'),'payroll',eligible.slice(0,5).map(t=>({kind:'trip',id:t.id,label:t.number||t.id})));
 }
 if(ops&&/\b(diesel|fuel|litres?|odometer|km\/?l)\b/i.test(q)&&/\b(why|not|missing|calculat|show|wrong|efficien|km|distance|per)\b/i.test(q)){
   const trips=(state.trips||[]).filter(t=>!truck||t.truckId===truck.id).filter(t=>!date||String(t.date||'').slice(0,10)===date);
   const t=trips.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0];
   if(!t)return result('I cannot find the specified trip in the saved records. Search Trips & Loads by truck, date or trip number first.','trips');
   const slips=(state.diesel||[]).filter(x=>x.tripId===t.id),dist=Metrics.distance(t,slips);
   const lines=['Trip '+(t.number||t.id)+' has '+slips.length+' linked diesel slip(s).',
     'Distance: '+Number(dist.distance||0)+' km · source: '+(dist.distanceSource||'none')+(dist.partial?' (partial, not full journey)':'')+'.'];
   if(slips.length<2)lines.push('A single slip normally cannot establish the full-to-full fuel interval. Consecutive verified odometers, fuel entries and final depot/GPS distance may still be required.');
   if(dist.partial)lines.push('Partial odometer kilometres are not a complete trip distance; confirm departure/arrival or valid continuous GPS evidence.');
   if(!slips.length)lines.push('No diesel receipts are linked to this trip. Check slip assignment before recalculating.');
   return result(lines.join('\n'),'diesel',[{kind:'trip',id:t.id,label:t.number||t.id}]);
 }
 return null;
}
module.exports={answer};
