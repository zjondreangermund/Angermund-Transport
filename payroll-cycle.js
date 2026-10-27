'use strict';
const Link=require('./payroll-trip-link');
const dayAfter=d=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
function isShunter(state,t){
 // Truck assignment is authoritative. Old shunter flags and payroll profile
 // choices must never convert a long-distance trip into shunter work.
 const truck=(state.trucks||[]).find(x=>String(x.id)===String(t.truckId))||{};
 return ['trk_ang4','trk_ang5'].includes(String(t.truckId||''))||/^ang\s*0?[45]$/i.test(String(truck.fleetName||''));
}
function shunterDriver(state,driver,profile={}){
 if(!driver)return false;
 // Only designated ANG 4/ANG 5 drivers receive monthly shunter payroll.
 // In particular, payBasis='shunter' on an unrelated driver is stale data.
 return(state.trucks||[]).some(t=>isShunter(state,{truckId:t.id})&&String(t.defaultDriverId||'')===String(driver.id));
}
function cutoffDate(year,month,day){
 const last=new Date(Date.UTC(year,month,0)).getUTCDate();
 return new Date(Date.UTC(year,month-1,Math.min(day,last))).toISOString().slice(0,10);
}
function bounds(period,driver,shunter,existing,profile={}){
 // NBL invoice dates, or explicitly entered legacy dates, take priority.
 // Ordinary draft cycles are recalculated when their recurring cutoff changes.
 if(existing?.periodStart&&existing?.periodEnd&&!['nbl-cycle','configured-cutoff','calendar-month'].includes(existing.payrollBasis))
   return{start:existing.periodStart,end:dayAfter(existing.periodEnd),periodEnd:existing.periodEnd,basis:existing.payrollBasis||'invoice-cycle'};
 const [y,m]=String(period).split('-').map(Number);
 if(shunter||!driver){
   const start=new Date(Date.UTC(y,m-1,1)).toISOString().slice(0,10);
   const periodEnd=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
   return{start,end:dayAfter(periodEnd),periodEnd,basis:'calendar-month'};
 }
 const entered=Number(profile.cutoffDay??20);
 const day=Number.isInteger(entered)&&entered>=1&&entered<=31?entered:20;
 const previousEnd=cutoffDate(y,m-1,day),periodEnd=cutoffDate(y,m,day);
 return{start:dayAfter(previousEnd),end:dayAfter(periodEnd),periodEnd,basis:day===20?'nbl-cycle':'configured-cutoff'};
}
function bonus(state,driver,start,end,profile={}){
 const amount=profile.shunterBonusAmount===undefined?8000:Number(profile.shunterBonusAmount),divisor=profile.shunterWorkingDays===undefined?20:Number(profile.shunterWorkingDays),rate=amount/divisor,dates=new Map();
 if(!driver)return{amount:0,rate,days:[],count:0};
 const add=(date,truckId,reference)=>{date=String(date||'').slice(0,10);if(date<start||date>=end)return;const row=dates.get(date)||{date,truckIds:[],references:[]};if(!row.truckIds.includes(truckId))row.truckIds.push(truckId);if(reference&&!row.references.includes(reference))row.references.push(reference);dates.set(date,row);};
 for(const t of Link.eligibleTrips(state,driver,start,end))if(isShunter(state,t))add(t.date,t.truckId,t.number||t.id);
 for(const r of state.shunterRecons||[]){if(!isShunter(state,r)||/cancel/i.test(r.status||''))continue;const trips=(state.trips||[]).filter(t=>t.truckId===r.truckId&&String(t.date||'').slice(0,10)===String(r.date||'').slice(0,10));const truck=(state.trucks||[]).find(t=>t.id===r.truckId);const assigned=r.driverId||(trips.length?'':truck?.defaultDriverId);if(assigned===driver.id)add(r.date,r.truckId,r.id);}
 const days=[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,amount:Number(rate.toFixed(2))}));
 return{amount:Number((days.length*rate).toFixed(2)),rate,days,count:days.length};
}
module.exports={bounds,bonus,isShunter,shunterDriver,dayAfter};
