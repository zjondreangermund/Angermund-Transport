'use strict';
// NBL invoices close on the 20th. Transport driver payroll uses exactly that
// inclusive 21st-through-20th delivery cycle; basic salaries remain monthly.
const SHUNTER_IDS=new Set(['trk_ang4','trk_ang5']);
const DAY_BONUS_POOL=8000,STANDARD_WORKDAYS=20,DAILY_BONUS=DAY_BONUS_POOL/STANDARD_WORKDAYS;
const iso=v=>String(v||'').slice(0,10);
const inRange=(v,start,endExclusive)=>iso(v)>=start&&iso(v)<endExclusive;
const validMonth=period=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period||''));
function bounds(period){
 if(!validMonth(period))throw Error('Period must be YYYY-MM');
 const [y,m]=period.split('-').map(Number),at=(yr,mon,day)=>new Date(Date.UTC(yr,mon,day)).toISOString().slice(0,10);
 return {monthStart:at(y,m-1,1),monthEndExclusive:at(y,m,1),
  tripStart:at(y,m-2,21),tripEndInclusive:at(y,m-1,20),tripEndExclusive:at(y,m-1,21)};
}
function completionDate(t){
 return iso(t.deliveredDate||t.completedDate||t.closedDate||t.depotArrival?.at||t.date);
}
function isShunter(tripOrTruck){
 const id=typeof tripOrTruck==='object'?tripOrTruck?.truckId:tripOrTruck;
 return SHUNTER_IDS.has(String(id||''));
}
function tripWorked(t){
 return !/cancelled|canceled|deleted/i.test(String(t.status||''))&&
  (Number(t.stage||0)>=3||Boolean(t.startedAt)||Boolean(t.depotArrival?.at)||
   /in transit|delivered|returning|completed|closed|invoiced/i.test(String(t.status||'')));
}
function reconWorked(r){
 return !/cancelled|canceled|deleted/i.test(String(r.status||''))&&
  (Number(r.charge)>0||(r.tmsIds||[]).length>0||Number(r.movements)>0);
}
function assignmentForDay(state,truckId,date){
 const trips=(state.trips||[]).filter(t=>String(t.truckId)===String(truckId)&&iso(t.date)===date&&tripWorked(t));
 const tripDrivers=[...new Set(trips.map(t=>String(t.driverId||'')).filter(Boolean))];
 if(tripDrivers.length>1)return null; // same truck, conflicting drivers; manual review
 if(tripDrivers.length===1)return{driverId:tripDrivers[0],source:'Trip assignment',tripIds:trips.map(t=>t.id)};
 const truck=(state.trucks||[]).find(x=>String(x.id)===String(truckId));
 // Explicit per-day assignment on the recon beats the fleet default.
 const recons=(state.shunterRecons||[]).filter(r=>String(r.truckId)===String(truckId)&&iso(r.date)===date&&reconWorked(r));
 const reconDrivers=[...new Set(recons.map(r=>String(r.driverId||'')).filter(Boolean))];
 if(reconDrivers.length>1)return null;
 if(reconDrivers.length===1)return{driverId:reconDrivers[0],source:'Shunter recon assignment',tripIds:[]};
 const fallback=String(truck?.defaultDriverId||'');
 return fallback?{driverId:fallback,source:'Truck default driver + verified shunter recon',tripIds:[]}:null;
}
function workdays(state,driver,start,endExclusive){
 if(!driver?.id)return[];
 const candidates=new Map();
 for(const r of state.shunterRecons||[]){
  if(!isShunter(r.truckId)||!inRange(r.date,start,endExclusive)||!reconWorked(r))continue;
  candidates.set(String(r.truckId)+'|'+iso(r.date),{truckId:String(r.truckId),date:iso(r.date),evidence:'Shunter reconciliation'});
 }
 for(const t of state.trips||[]){
  if(!isShunter(t)||!inRange(t.date,start,endExclusive)||!tripWorked(t))continue;
  const key=String(t.truckId)+'|'+iso(t.date);
  if(!candidates.has(key))candidates.set(key,{truckId:String(t.truckId),date:iso(t.date),evidence:'Started/completed local trip'});
 }
 const byDay=new Map();
 for(const c of candidates.values()){
  const ass=assignmentForDay(state,c.truckId,c.date);
  if(!ass||String(ass.driverId)!==String(driver.id))continue;
  const prior=byDay.get(c.date);
  if(prior&&prior.truckId!==c.truckId){ // one bonus per driver each day
   prior.truckId=prior.truckId+' + '+c.truckId;
   prior.evidence+=' + '+c.evidence;
   continue;
  }
  byDay.set(c.date,{date:c.date,truckId:c.truckId,evidence:c.evidence,
   assignmentSource:ass.source,driverId:driver.id,amount:DAILY_BONUS});
 }
 return [...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function isDefaultShunterDriver(state,driver){
 return Boolean(driver&&(state.trucks||[]).some(t=>isShunter(t.id)&&String(t.defaultDriverId||'')===String(driver.id)));
}
module.exports={bounds,completionDate,isShunter,tripWorked,reconWorked,assignmentForDay,workdays,isDefaultShunterDriver,DAILY_BONUS,DAY_BONUS_POOL,STANDARD_WORKDAYS};
