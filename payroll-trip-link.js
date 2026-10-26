'use strict';
const normalize=value=>String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ');
function resolveDriver(state,employee){
  const drivers=state.drivers||[];
  // Prefer explicit identity mappings; never infer an assignment from a truck alone.
  const explicit=[employee.driverId,employee.driver_id,employee.linkedDriverId,employee.id].filter(Boolean).map(String);
  const match=drivers.find(d=>explicit.includes(String(d.id)));
  if(match)return match;
  const name=normalize(employee.name||[employee.firstName,employee.lastName].filter(Boolean).join(' '));
  if(!name)return null;
  const matches=drivers.filter(d=>normalize(d.name)===name);
  return matches.length===1?matches[0]:null;
}
function eligibleTrips(state,driver,periodStart,periodEnd){
  if(!driver)return [];
  return(state.trips||[]).filter(t=>{
    if(String(t.driverId||'')!==String(driver.id))return false;
    if(/cancelled|canceled|deleted/i.test(String(t.status||'')))return false;
    const date=String(t.date||'').slice(0,10);
    if(date<periodStart||date>=periodEnd)return false;
    // Do not pay planned/active trips early. Some completed legacy records
    // have a textual status without a populated numeric stage.
    return Number(t.stage||0)>=3||/delivered|completed|complete/i.test(String(t.status||''));
  });
}
module.exports={resolveDriver,eligibleTrips};
