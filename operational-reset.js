'use strict';
const VERSION='clean-start-2026-10-17-cutoff-2026-09-20';
const CUTOFF='2026-09-20';
const CLEAR=['diesel','expenses','invoices','payments','payroll','loans','advances','inspections','incidents','maintenance','tyres','tasks','approvals','tripIssues','driverActions','shunterRecons','monthlyPnlSnapshots','monthlyCosts','monthlyPnl','notifications','scanJobs','driverUploads','companyReceipts','tripDocuments','gpsPositions','importBatches','excelImports','pnlSnapshots'];
function retainedTrip(t){const date=String(t.date||'').slice(0,10);return Boolean(t.sourceWorkbook||t.sourceSheet||t.importBatchId||t.importedAt&&t.externalTmsId)&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=CUTOFF}
function clearTripTesting(t){
  for(const row of [t,...(t.legs||[])]){
    for(const key of Object.keys(row))if(/^(invoice|pod|settlement|driverAccepted|driverCompleted|driverComplete|startedAt|arrivedAt|completedDate|closedDate|deliveredDate|geo$|loadEditedAt|driverComplete|shunterRecon|driverReported)/i.test(key))delete row[key];
    row.pod=false;row.invoiceId='';
    for(const key of ['dieselCost','tolls','allowance','other','expenseCost','routeExpenseCost','actualTripCost','totalCost','importedCost','importedDieselCost','importedExpenseCost'])row[key]=0;
  }
  const c=t.carrierDetails||{};
  let status='Planned',stage=1;if(c.pickActualArrival){status='Loading';stage=2}if(c.pickActualDeparture){status='In transit';stage=3}if(c.dropActualArrival||c.dropActualDeparture){status='Delivered';stage=4}
  t.status=status;t.stage=stage;t.actualProfit=Number(t.income||0);t.costBreakdown={diesel:0,routeExpenses:0,legacyToll:0,allowance:0,other:0};
  for(const leg of t.legs||[])leg.status=status;
  return t;
}
function resetOperationalState(state,now=new Date().toISOString()){
  if(state.operationalResetVersion===VERSION)return{skipped:true,...state.operationalResetSummary};
  const before=(state.trips||[]).length,keep=(state.trips||[]).filter(retainedTrip);
  if(!keep.length)throw Error('Cleanup stopped: no Excel trips on or after '+CUTOFF+' were found');
  const removed={};for(const key of CLEAR){removed[key]=(state[key]||[]).length||0;state[key]=[]}
  state.trips=keep.map(clearTripTesting);
  for(const truck of state.trucks||[])if(/on trip|reserved|on duty/i.test(String(truck.status||'')))truck.status='Available';
  for(const driver of state.drivers||[])if(/on trip|assigned|on duty/i.test(String(driver.status||'')))driver.status='Available';
  state.operationalResetVersion=VERSION;state.operationalStartDate=CUTOFF;state.operationalResetAt=now;
  state.operationalResetSummary={cutoff:CUTOFF,retainedTrips:keep.length,deletedTrips:before-keep.length,removed,quotesPreserved:(state.quotes||[]).length};
  state.audit=[{id:'clean_start_'+now,at:now,actor:'Owner-authorized cleanup',action:'Testing records cleared; Excel trips from '+CUTOFF+' retained; quotations preserved',linkedType:'system',linkedId:VERSION}];
  return{skipped:false,...state.operationalResetSummary};
}
module.exports={VERSION,CUTOFF,resetOperationalState,retainedTrip};
