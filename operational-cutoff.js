'use strict';
const CUTOFF='2026-09-20',VERSION='owner-cutoff-2026-09-20-v1';
const TRANSACTIONS=['trips','diesel','expenses','invoices','payments','payroll','loans','advances','inspections','incidents','maintenance','tyres','tasks','approvals','tripIssues','driverActions','shunterRecons','monthlyPnlSnapshots','monthlyCosts','monthlyPnl','notifications','scanJobs','driverUploads','companyReceipts','tripDocuments','gpsPositions','importHistory','importBatches','excelImports','pnlSnapshots','audit'];
function isoDate(v){
 const s=String(v||'').trim(),m=s.match(/^(20\d{2})-(\d{2})-(\d{2})(?:$|T| )/);if(!m)return'';
 const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?m[0].slice(0,10):'';
}
function businessDate(x){
 for(const key of ['date','receiptDate','transactionDate','issuedDate','startDate','recordedAt','at']){const d=isoDate(x[key]);if(d)return d}
 // Monthly totals cover the whole month. September overlaps the operational period.
 const p=String(x.period||x.month||'');if(/^20\d{2}-\d{2}$/.test(p)){const d=new Date(Date.UTC(+p.slice(0,4),+p.slice(5),0));return d.toISOString().slice(0,10)}
 for(const key of ['createdAt','created_at','importedAt']){const d=isoDate(x[key]);if(d)return d}
 return'';
}
function importAllowed(v){const d=isoDate(v);return Boolean(d&&d>=CUTOFF)}
function linkedIds(x){return [x.tripId,x.invoiceId,x.loanId,x.expenseId,x.dieselId,x.approvalId,x.linkedId].filter(Boolean)}
function pruneOperationalHistory(state,{initial=false}={}){
 const removed={},removedIds=new Set(),byId=new Map(),counts={},unknown={};
 for(const key of TRANSACTIONS)for(const x of Array.isArray(state[key])?state[key]:[])if(x&&x.id)byId.set(x.id,x);
 const dateOf=(x,seen=new Set())=>{const explicit=['date','receiptDate','transactionDate','issuedDate','startDate'].some(k=>isoDate(x[k]))||x.period||x.month;if(explicit)return businessDate(x);if(seen.has(x))return'';seen.add(x);for(const id of linkedIds(x)){const parent=byId.get(id);if(parent){const d=dateOf(parent,seen);if(d)return d}}return businessDate(x)};
 for(const key of TRANSACTIONS){if(!Array.isArray(state[key]))continue;removed[key]=[];state[key]=state[key].filter(x=>{if(!x||typeof x!=='object')return true;const d=dateOf(x);const partialSnapshot=['monthlyPnlSnapshots','pnlSnapshots'].includes(key)&&String(x.period||'')===CUTOFF.slice(0,7)&&!importAllowed(x.periodStart||x.startDate);if(!d)unknown[key]=(unknown[key]||0)+1;if(partialSnapshot||(d&&d<CUTOFF)){removed[key].push(x);if(x.id)removedIds.add(x.id);return false}return true});counts[key]=removed[key].length}
 for(const t of state.trips||[]){
  const cost=x=>Number(x.printedTotal)||Number(x.total)||Number(x.litres||0)*Number(x.price||0);
  const fuel=(removed.diesel||[]).filter(x=>x.tripId===t.id).reduce((n,x)=>n+cost(x),0),expense=(removed.expenses||[]).filter(x=>x.tripId===t.id).reduce((n,x)=>n+Number(x.amount||0),0);
  if(fuel||expense){t.dieselCost=Math.max(0,Number(t.dieselCost||0)-fuel);t.expenseCost=Math.max(0,Number(t.expenseCost||0)-expense);t.routeExpenseCost=Math.max(0,Number(t.routeExpenseCost||0)-expense);t.actualTripCost=Math.max(0,Number(t.actualTripCost||0)-fuel-expense);t.actualProfit=Number(t.income||0)-t.actualTripCost;if(t.costBreakdown){t.costBreakdown.diesel=t.dieselCost;t.costBreakdown.routeExpenses=t.expenseCost}}
 }
 // Newer costs remain on their vehicle when their historical trip is removed.
 for(const key of TRANSACTIONS)for(const x of Array.isArray(state[key])?state[key]:[]){
  if(!x||typeof x!=='object')continue;
  for(const field of ['tripId','invoiceId','loanId','expenseId','dieselId','approvalId','shunterReconId','linkedId'])if(removedIds.has(x[field])){x[field]='';if(field==='tripId'){x.legId='';if(key==='diesel'||key==='expenses')x.scope='company'}}
  if(Array.isArray(x.tripIds))x.tripIds=x.tripIds.filter(id=>!removedIds.has(id));
  for(const line of [...(x.lines||[]),...(x.legs||[])])for(const field of ['tripId','invoiceId','shunterReconId'])if(removedIds.has(line[field]))line[field]='';
 }
 if(initial){state.lastImportBackup=null;for(const h of state.importHistory||[])h.canUndo=false;state.recordDeletionVersion=VERSION;state.operationalCutoffVersion=VERSION;state.operationalCutoffAt=new Date().toISOString()}
 state.operationalStartDate=CUTOFF;
 return{cutoff:CUTOFF,counts,unknownDates:unknown,removed,removedIds:[...removedIds],retainedTrips:(state.trips||[]).length};
}
module.exports={CUTOFF,VERSION,TRANSACTIONS,isoDate,businessDate,importAllowed,pruneOperationalHistory};
