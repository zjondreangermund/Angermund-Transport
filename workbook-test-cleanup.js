'use strict';
const VERSION='remove-at-xls-tests-2026-10-18';
const isWorkbookTest=t=>/^AT-XLS-\d+$/i.test(String(t.number||''))||/^trip_xlsx_\d+$/.test(String(t.id||''));
function removeWorkbookTests(state){
  const removed=(state.trips||[]).filter(isWorkbookTest),ids=new Set([...removed.map(t=>t.id),...Array.from({length:7},(_,i)=>'trip_xlsx_'+String(i+1).padStart(2,'0'))]);
  const linked=x=>ids.has(x.tripId)||(x.linkedType==='trip'&&ids.has(x.linkedId));
  if(Array.isArray(state.trips))state.trips=state.trips.filter(t=>!isWorkbookTest(t));
  const counts={trips:removed.length};
  for(const key of ['diesel','expenses','invoices','payments','advances','tripIssues','inspections','tasks','approvals','notifications','driverActions','tripDocuments','driverUploads','companyReceipts'])if(Array.isArray(state[key])){const before=state[key].length;state[key]=state[key].filter(x=>!linked(x));counts[key]=before-state[key].length}
  for(const x of state.incidents||[])if(ids.has(x.tripId))x.tripId='';
  state.workbookTestCleanupVersion=VERSION;
  return{removedTrips:removed.map(t=>({id:t.id,number:t.number,date:t.date})),ids:[...ids],counts};
}
module.exports={VERSION,isWorkbookTest,removeWorkbookTests};
