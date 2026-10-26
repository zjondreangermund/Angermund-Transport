'use strict';
const Link=require('./payroll-trip-link');
const dayAfter=d=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
function isShunter(state,t){const truck=(state.trucks||[]).find(x=>x.id===t.truckId)||{};return t.shunter===true||t.tripType==='Shunter'||['trk_ang4','trk_ang5'].includes(t.truckId)||/^ang\s*0?[45]$/i.test(truck.fleetName||'');}
function shunterDriver(state,driver,profile={}){if(!driver)return false;if(profile.payBasis)return profile.payBasis==='shunter';return(state.trucks||[]).some(t=>isShunter(state,{truckId:t.id})&&t.defaultDriverId===driver.id);}
function bounds(period,driver,shunter,existing){
 if(existing?.periodStart&&existing?.periodEnd)return{start:existing.periodStart,end:dayAfter(existing.periodEnd),periodEnd:existing.periodEnd,basis:existing.payrollBasis||'invoice-cycle'};
 const [y,m]=period.split('-').map(Number),start=new Date(Date.UTC(y,driver&&!shunter?m-2:m-1,driver&&!shunter?21:1)),end=new Date(Date.UTC(y,driver&&!shunter?m-1:m,driver&&!shunter?21:1));
 return{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),periodEnd:new Date(end-86400000).toISOString().slice(0,10),basis:driver&&!shunter?'nbl-cycle':'calendar-month'};
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
