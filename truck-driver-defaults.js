'use strict';
const MAPPINGS={4:'Marakia',5:'Elia',12:'Josef',11:'Rudolf',3:'Victon',2:'Joel',10:'Anton'};
const VERSION='truck-drivers-2026-10-17';
const words=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(Boolean);
function configureTruckDriverDefaults(state){
  const unresolved=[];
  for(const truck of state.trucks||[]){
    const match=String(truck.fleetName||truck.id||'').match(/(?:ang\s*|trk_ang)(\d+)\b/i),name=MAPPINGS[Number(match?.[1])];if(!name)continue;
    const candidates=(state.drivers||[]).filter(d=>d.active!==false&&!d.historical&&!/inactive|terminated|archived/i.test(String(d.status||''))&&words(d.name).includes(name.toLowerCase()));
    truck.defaultDriverName=name;
    if(candidates.length!==1){unresolved.push({truck:truck.fleetName||truck.id,driver:name,reason:candidates.length?'Ambiguous name':'Driver not found'});continue}
    if(truck.defaultDriverDefaultsVersion!==VERSION||!(state.drivers||[]).some(d=>d.id===truck.defaultDriverId)){truck.defaultDriverId=candidates[0].id;truck.defaultDriverDefaultsVersion=VERSION}
  }
  return unresolved;
}
function defaultDriverId(state,truckId){const t=(state.trucks||[]).find(x=>x.id===truckId);return (state.drivers||[]).some(d=>d.id===t?.defaultDriverId&&d.active!==false)?t.defaultDriverId:''}
function syncDriverReferences(state,trip){
  for(const key of ['diesel','expenses','advances','inspections','tripIssues'])for(const row of state[key]||[])if(row.tripId===trip.id)row.driverId=trip.driverId;
  for(const task of state.tasks||[])if(task.linkedType==='trip'&&task.linkedId===trip.id&&(!task.assignedUserId)&&(/driver/i.test(String(task.ownerRole||''))||task.assignedDriverId))task.assignedDriverId=trip.driverId;
  const name=(state.drivers||[]).find(d=>d.id===trip.driverId)?.name||'';
  for(const inv of state.invoices||[])for(const line of inv.lines||[])if(line.tripId===trip.id)line.driver=name;
}
function applyTruckDriverDefaults(state,{backfill=false}={}){
  const unresolved=configureTruckDriverDefaults(state);let assigned=0;
  for(const trip of state.trips||[]){
    const id=defaultDriverId(state,trip.truckId);if(!id)continue;
    const initial=backfill&&trip.truckDriverBackfillVersion!==VERSION;
    if(!trip.driverAssignmentOverride&&!trip.assignedDriverAt&&(initial||!trip.driverId)){
      if(trip.driverId!==id){trip.driverId=id;trip.driverAssignmentSource='truck-default';trip.driverDefaultTruckId=trip.truckId;syncDriverReferences(state,trip);assigned++}
    }
    if(initial)trip.truckDriverBackfillVersion=VERSION;
  }
  return{assigned,unresolved};
}
module.exports={configureTruckDriverDefaults,defaultDriverId,applyTruckDriverDefaults,syncDriverReferences};
