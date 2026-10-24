'use strict';
const {syncJourneyWorkflow}=require('./load-edit');
const schema={
 quotes:['number','date','status','notes'],diesel:['date','supplier','litres','price','total','odometer','truckId','driverId','tripId','notes','receiptStatus'],expenses:['date','supplier','category','amount','truckId','driverId','tripId','notes','status','mdcKm','mdcRatePer100km'],monthlyCosts:['period','startPeriod','endPeriod','category','description','amount','truckId','recurring','notes'],monthlyPnlSnapshots:['period','sourceSheet','notes'],maintenance:['date','truckId','type','supplier','odometer','cost','nextService','status','notes'],tyres:['serial','truckId','position','brand','fittedKm','currentKm','cost','status'],inspections:['date','truckId','driverId','tripId','type','score','defects','status'],incidents:['date','truckId','driverId','tripId','type','severity','description','status','action'],advances:['date','driverId','tripId','type','amount','status'],payments:['date','amount','method','reference','proof'],tripIssues:['date','truckId','driverId','tripId','description','status'],shunterRecons:['date','notes'],loans:['notes','reference']
};
const kinds=new Set([...Object.keys(schema),'invoices','payroll','trips']);
const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e};
const num=v=>Number(v||0),round=v=>Math.round((v+Number.EPSILON)*100)/100;
function allowed(kind,role){if(!kinds.has(kind))return false;if(['admin','manager'].includes(role))return true;if(role==='finance')return !['inspections','incidents','tyres'].includes(kind);if(role==='dispatcher')return ['trips','quotes','inspections','incidents','tripIssues','shunterRecons'].includes(kind);if(role==='workshop')return ['maintenance','tyres','inspections'].includes(kind);return false}
function find(state,kind,id){if(!kinds.has(kind))fail('Unsupported record type');const row=(state[kind]||[]).find(x=>x.id===id);if(!row)fail('Record no longer exists. Refresh the page.',404);return row}
function archive(state,kind,row,actor,action,related=[]){state.recordHistory??=[];state.recordHistory.unshift({id:require('node:crypto').randomUUID(),kind,record:structuredClone(row),related:structuredClone(related),actor,action,at:new Date().toISOString()});state.audit??=[];state.audit.unshift({id:require('node:crypto').randomUUID(),at:new Date().toISOString(),actor,action:action+' '+kind+' '+(row.number||row.reference||row.id),linkedType:kind,linkedId:row.id});state.audit=state.audit.slice(0,100)}
function refreshInvoice(state,inv){const paid=Math.max(num(inv.paidAmount),(state.payments||[]).filter(p=>p.invoiceId===inv.id).reduce((a,p)=>a+num(p.amount),0));if(inv.amount<paid-.005)fail('Updated invoice would be below payments received');inv.paidAmount=paid;inv.balance=round(inv.amount-paid);inv.status=inv.balance<=.005?'Paid':paid?'Part Paid':inv.due&&inv.due<new Date().toISOString().slice(0,10)?'Overdue':'Unpaid'}
function deleteRecord(state,kind,id,actor='Admin'){
 const row=find(state,kind,id),related=[];
 if(kind==='invoices'){
  if(num(row.paidAmount)>0||(state.payments||[]).some(p=>p.invoiceId===id&&num(p.amount)>0))fail('Remove or reverse the invoice payments first. This invoice has recorded payments.');
  for(const t of state.trips||[]){let changed=t.invoiceId===id||(t.invoiceIds||[]).includes(id);for(const l of t.legs||[])if(l.invoiceId===id){related.push({kind:'leg',record:structuredClone(l)});l.invoiceId='';delete l.invoiceStatus;l.status='Delivered';changed=true}if(changed){related.push({kind:'trip',record:structuredClone(t)});if(t.invoiceId===id)t.invoiceId='';t.invoiceIds=(t.invoiceIds||[]).filter(x=>x!==id);if(t.legs?.length)syncJourneyWorkflow(t);else{t.status='Delivered';t.stage=4}}}
  for(const r of state.shunterRecons||[])if(r.invoiceId===id){related.push({kind:'shunterRecons',record:structuredClone(r)});r.invoiceId=''}
 }
 if(kind==='trips'){
  // Protect invoices before removing any costs. Invoiced MDC rows can be
  // referenced through mdcLines rather than the main invoice tripId.
  if(row.invoiceId||(row.invoiceIds||[]).length||(row.legs||[]).some(l=>l.invoiceId)||
    (state.invoices||[]).some(i=>i.tripId===id||(i.tripIds||[]).includes(id)||
      (i.lines||[]).some(l=>l.tripId===id)||(i.mdcLines||[]).some(l=>l.tripId===id)))
    fail('Delete the linked invoice first; its loads and invoiced road charges will be released.');
  // Keep existing protections for other business records outside this
  // request. They must be resolved before the trip can be removed.
  for(const key of ['advances','inspections','incidents','tripIssues'])
    if((state[key]||[]).some(x=>x.tripId===id))fail('Remove linked '+key+' records before deleting this trip.');
  const refs=[row.externalTmsId,row.sourceTmsId,row.carrierDetails?.tmsId,String(row.number||'').replace(/^NBL[-\s]*/i,'')].filter(Boolean).map(String);
  if((state.shunterRecons||[]).some(r=>(r.id===row.shunterReconId)||((!r.truckId||r.truckId===row.truckId)&&(r.tmsIds||[]).some(ref=>refs.includes(String(ref))))))
    fail('Remove this trip reference from Shunter Recon first, so its charges are not left behind.');

  // Atomic cascade: all matching diesel/expense/MDC records disappear with
  // the trip; unaffected trips retain their own records. Keep full snapshots
  // in recordHistory for an accountable deletion trail.
  const legIds=new Set((row.legs||[]).map(leg=>String(leg.id||'')).filter(Boolean));
  const belongsToTrip=x=>x.tripId===id||(!x.tripId&&x.legId&&legIds.has(String(x.legId)));
  const deletedDiesel=(state.diesel||[]).filter(belongsToTrip);
  const deletedExpenses=(state.expenses||[]).filter(belongsToTrip);
  const deletedExpenseIds=new Set(deletedExpenses.map(x=>x.id));
  for(const item of deletedDiesel)related.push({kind:'diesel',record:structuredClone(item)});
  for(const item of deletedExpenses)related.push({kind:'expenses',record:structuredClone(item)});
  state.diesel=(state.diesel||[]).filter(x=>!belongsToTrip(x));
  state.expenses=(state.expenses||[]).filter(x=>!belongsToTrip(x));
  // The related expense may originate from a task or approval; clear any
  // links which would otherwise point to a now-deleted expense.
  for(const task of state.tasks||[]){
    if(deletedExpenseIds.has(task.expenseId)){
      related.push({kind:'task',record:structuredClone(task)});
      task.expenseId='';task.expenseAmount=0;task.fundsUsed=false;
    }
    if(task.linkedType==='trip'&&task.linkedId===id){task.linkedType='';task.linkedId=''}
  }
  if(Array.isArray(state.approvals)){
    for(const approval of state.approvals){
      if(approval.linkedType==='expense'&&deletedExpenseIds.has(approval.linkedId)){
        related.push({kind:'approval',record:structuredClone(approval)});
        approval.linkedType='';approval.linkedId='';
        if(approval.status==='Pending')approval.status='Cancelled';
      }
    }
  }
 }
 if(kind==='shunterRecons'&&(row.invoiceId||(state.invoices||[]).some(i=>(i.lines||[]).some(l=>l.shunterReconId===id))))fail('Delete the linked shunter invoice first.');
 if(kind==='shunterRecons')for(const trip of state.trips||[])if(trip.shunterReconId===id)delete trip.shunterReconId;
 if(kind==='loans'&&(row.repayments||[]).length)fail('This loan has posted repayments. Reverse the linked payslips before deleting the loan.');
 if(kind==='payroll'){
  for(const loan of state.loans||[]){const repayments=(loan.repayments||[]).filter(p=>p.payrollId===id);if(repayments.length){related.push({kind:'loans',record:structuredClone(loan)});loan.balance=round(num(loan.balance)+repayments.reduce((a,p)=>a+num(p.amount),0));loan.repayments=loan.repayments.filter(p=>p.payrollId!==id);if(loan.status==='Paid')loan.status='Active'}}
  state.deletedPayrollPeriods??=[];const key=row.period+':'+row.employeeId;if(!state.deletedPayrollPeriods.includes(key))state.deletedPayrollPeriods.push(key);
 }
 if(kind==='maintenance'&&(state.expenses||[]).some(e=>e.maintenanceId===id))fail('Remove the linked maintenance expense first.');
 archive(state,kind,row,actor,'Deleted',related);state[kind]=state[kind].filter(x=>x.id!==id);
 if(kind==='payments'){const inv=(state.invoices||[]).find(i=>i.id===row.invoiceId);if(inv){inv.paidAmount=(state.payments||[]).filter(p=>p.invoiceId===inv.id).reduce((a,p)=>a+num(p.amount),0);refreshInvoice(state,inv)}}
 if(kind==='diesel'){const t=(state.trips||[]).find(t=>t.id===row.tripId);if(t&&!(state.diesel||[]).some(f=>f.tripId===t.id))t.dieselCost=0}
 for(const task of state.tasks||[])if(task.expenseId===id&&kind==='expenses'){task.expenseId='';task.expenseAmount=0;task.fundsUsed=false}
 state.recordDeletionVersion=require('node:crypto').randomUUID();
 return{deleted:true,kind,id,tripId:row.tripId||'',record:row,removedDiesel:kind==='trips'?related.filter(x=>x.kind==='diesel').length:0,removedExpenses:kind==='trips'?related.filter(x=>x.kind==='expenses').length:0};
}
function editRecord(state,kind,id,body,actor='Admin'){
 const row=find(state,kind,id);if(!schema[kind])fail('Use the linked record editor for this item.');
 if(body.expectedUpdatedAt!==undefined&&String(row.updatedAt||'')!==String(body.expectedUpdatedAt))fail('Record changed. Reopen it before saving.',409);
 const before=structuredClone(row),oldTrip=row.tripId;
 if(kind==='shunterRecons'&&row.invoiceId)fail('Edit the linked invoice or remove it before changing this recon.');
 if(kind==='expenses'&&row.mdc&&(state.invoices||[]).some(i=>(i.mdcLines||[]).some(l=>l.tripId===row.tripId)))fail('Edit the invoice before changing an invoiced MDC charge.');
 const numbers=new Set(['litres','price','total','amount','odometer','mdcKm','mdcRatePer100km','cost','nextService','fittedKm','currentKm','score']);
 for(const key of schema[kind])if(body[key]!==undefined){let v=body[key];if(numbers.has(key)){v=Number(v);if(!Number.isFinite(v)||v<0)fail('Enter a valid non-negative '+key)}else if(key==='recurring')v=v===true||v==='true';else v=String(v??'').slice(0,2000);
  if(key==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))fail('Enter a valid date');
  if(['period','startPeriod','endPeriod'].includes(key)&&v&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))fail('Enter a valid month');
  const lookup={tripId:'trips',truckId:'trucks',driverId:'drivers'}[key];if(lookup&&v&&!(state[lookup]||[]).some(x=>x.id===v))fail('Selected '+key+' no longer exists');row[key]=v;
 }
 if(row.tripId&&(kind==='diesel'||kind==='expenses')){const t=state.trips.find(t=>t.id===row.tripId);row.truckId=t.truckId;row.driverId=t.driverId}
 if(kind==='diesel'){if(num(row.litres)<=0)fail('Litres must be greater than zero');if(body.total===undefined)row.total=round(num(row.litres)*num(row.price));row.printedTotal=num(row.total);if(row.total<=0)fail('Fuel total must be greater than zero');row.price=num(row.total)/num(row.litres)}
 if(kind==='expenses'&&row.mdc)row.amount=round(num(row.mdcKm)/100*num(row.mdcRatePer100km));
 if(kind==='quotes'&&body.lineAmounts){for(const [index,leg] of (row.legs||[]).entries()){const value=Number(body.lineAmounts[index]);if(!Number.isFinite(value)||value<0)fail('Enter valid quotation line amounts');leg.pricingMethod='Manual negotiated';leg.manualAmount=round(value)}row.quotedIncome=round(row.legs.reduce((a,l)=>a+num(l.manualAmount),0));row.expectedProfit=round(row.quotedIncome-num(row.estimatedCost))}
 if(kind==='payments'){const inv=(state.invoices||[]).find(i=>i.id===row.invoiceId);if(!inv)fail('Invoice not found');const paid=(state.payments||[]).filter(p=>p.invoiceId===inv.id).reduce((a,p)=>a+num(p.amount),0);if(paid>num(inv.amount)+.005)fail('Payments cannot exceed invoice total');inv.paidAmount=paid;refreshInvoice(state,inv)}
 if(oldTrip&&oldTrip!==row.tripId&&kind==='diesel'){const t=(state.trips||[]).find(t=>t.id===oldTrip);if(t&&!(state.diesel||[]).some(f=>f.tripId===oldTrip))t.dieselCost=0}
 row.updatedAt=new Date().toISOString();archive(state,kind,before,actor,'Edited');return{record:row,tripIds:[oldTrip,row.tripId].filter(Boolean)};
}
module.exports={schema,kinds,allowed,deleteRecord,editRecord};
