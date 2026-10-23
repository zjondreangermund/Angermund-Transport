'use strict';
const number=v=>Number(v)||0;
const day=now=>new Date(Number(now)+7200000).toISOString().slice(0,10);
const office=['admin','manager','dispatcher','finance','workshop'];
function collect(state,now=Date.now()){
 const date=day(now),groups=new Map(),closed=t=>number(t.stage)>=4||/delivered|closed|invoiced/i.test(t.status||''),cutoff=state.operationalStartDate||'2026-09-20';
 const add=(key,title,roles,record,message,page,type='trip')=>{
  if(!groups.has(key))groups.set(key,{key,title,roles,items:[]});
  groups.get(key).items.push({id:record.id,title:record.number||record.registration||record.name||record.reference||record.id,message,page,linkedType:type,linkedId:record.id});
 };
 const due=(expiry)=>expiry&&expiry<=new Date(Number(now)+30*86400000+7200000).toISOString().slice(0,10);
 const permits=state.permits||[],trucks=state.trucks||[],drivers=state.drivers||[];
 for(const p of permits)if(due(p.expiry))add('document-renewal','Renew expiring or expired documents',['dispatcher'],p,(p.type||'Document')+' · expires '+p.expiry,'documents','permit');
 for(const p of permits)if(!p.expiry&&/licen[cs]e|prdp|roadworthy|permit/i.test(p.type||'')&&!/registration certificate/i.test(p.type||''))add('document-dates','Complete missing document dates',['dispatcher'],p,(p.type||'Document')+' has no expiry date','documents','permit');
 for(const t of state.trailers||[]){
  const permit=permits.find(p=>p.ownerId===t.id&&/licen[cs]e/i.test(p.type||'')&&p.expiry);
  if(!t.licenseExpiry&&!permit)add('trailer-licence','Capture trailer licence dates',['dispatcher'],t,'Licence expiry is missing','documents','trailer');
 }
 for(const t of trucks){
  if(!t.licenseExpiry&&!permits.some(p=>p.ownerId===t.id&&/licen[cs]e|operator/i.test(p.type||'')&&p.expiry))add('vehicle-licence','Capture vehicle licence dates',['dispatcher'],t,'Licence expiry is missing','documents','truck');
  if(!number(t.odometer)||!number(t.serviceDue))add('fleet-service-details','Complete fleet service readings',['workshop'],t,'Odometer or next-service kilometres are missing','fleet','truck');
  if(number(t.serviceDue)>0&&number(t.serviceDue)-number(t.odometer)<=5000)add('service-due','Arrange vehicle services',['workshop'],t,'Next service '+t.serviceDue+' km · odometer '+number(t.odometer),'workshop','truck');
 }
 for(const d of drivers.filter(x=>!['Archived','Inactive','Terminated'].includes(x.status)&&x.isDriver!==false&&(!x.role||/driver/i.test(x.role)))){
  if(!d.licenseExpiry&&!d.licenceExpiry&&!permits.some(p=>p.ownerId===d.id&&/licen[cs]e/i.test(p.type||'')&&p.expiry))add('driver-licence','Capture driver licence dates',['dispatcher'],d,'Driver licence expiry is missing','driverAccounts','driver');
 }
 for(const t of state.trips||[]){
  if(t.sourceTest||t.testRecord||t.date&&t.date<cutoff||/cancelled/i.test(t.status||''))continue;
  const shunter=t.shunter||/shunter/i.test(t.tripType||'')||['trk_ang4','trk_ang5'].includes(t.truckId),legs=t.legs?.length?t.legs:[t],ended=closed(t);
  if(!t.truckId||!t.driverId)add('trip-assignment','Complete trip assignments',['dispatcher'],t,'Missing '+[!t.truckId?'vehicle':'',!t.driverId?'driver':''].filter(Boolean).join(' and '),'trips');
  if(!shunter&&(t.ratePending||legs.some(l=>number(l.income||l.agreedAmount)<=0&&!l.emptyLeg&&!l.isEmpty&&!/empty|reposition/i.test(l.label||''))))add('trip-rate','Capture or confirm trip rates',['dispatcher','finance'],t,'Load rate is pending or missing','trips');
  if(!shunter&&legs.some(l=>number(l.distance)<=0))add('route-distance','Capture route kilometres',['dispatcher'],t,'A journey leg has no distance','trips');
  if(ended&&legs.some(l=>!l.pod))add('missing-pod','Upload outstanding PODs',['dispatcher'],t,'Delivered load has no proof of delivery','trips');
  const fuel=(state.diesel||[]).filter(f=>f.tripId===t.id);
  if(ended&&!shunter&&!fuel.length)add('trip-diesel','Capture trip diesel',['finance'],t,'Completed delivery has no diesel entry','trips');
  if(ended&&!shunter){
   const litres=fuel.reduce((n,f)=>n+number(f.litres),0),km=number(t.endKm)-number(t.startKm),target=number(state.settings?.targetKml)||2;
   if(number(t.startKm)>0&&km>0&&litres>0&&km/litres<target*.8)add('fuel-review','Review high fuel consumption',['dispatcher','finance'],t,(km/litres).toFixed(2)+' km/L · check fuel and odometer entries','trips');
   const expenses=(state.expenses||[]).filter(e=>e.tripId===t.id),cost=fuel.reduce((n,f)=>n+(number(f.printedTotal)||number(f.total)||number(f.litres)*number(f.price)),0)+expenses.reduce((n,e)=>n+number(e.amount),0)+number(t.allowance)+number(t.other)+(expenses.some(e=>/^toll$/i.test(e.category||''))?0:number(t.tolls)),income=number(t.income),min=state.settings?.defaultMargin===undefined?20:number(state.settings.defaultMargin);
   if(income>0&&cost>0&&(income-cost)/income*100<min)add('profit-review','Review low trip profit',['finance'],t,'Recorded margin '+((income-cost)/income*100).toFixed(1)+'% · check rates and costs','trips');
  }

  if(ended&&!shunter&&(!number(t.startKm)||number(t.endKm)<=number(t.startKm)))add('trip-odometer','Complete trip odometers',['dispatcher'],t,'Start/end odometer readings need checking','trips');
  const route=(state.routes||[]).find(r=>r.id===t.routeId)||{};
  if(!shunter&&(number(t.stage)>=3||ended)&&number(t.namibiaKm||route.namibiaKm||legs.reduce((n,l)=>n+number(l.namibiaKm),0))<=0)add('namibia-km','Capture Namibia kilometres for MDC',['dispatcher'],t,'Namibia kilometres are missing','trips');
  if(!shunter&&(number(t.stage)>=3||ended)&&!(state.expenses||[]).some(e=>e.tripId===t.id&&e.mdc))add('mdc','Capture MDC records',['finance'],t,'No linked MDC record','roadCharges');
  if(ended&&!shunter&&legs.some(l=>l.pod&&!l.invoiceId)&&!t.invoiceId)add('invoice-loads','Invoice delivered loads',['finance'],t,'POD is recorded; a load still needs invoicing','invoices');
 }
 for(const f of state.diesel||[])if(!(f.receiptUploadId||f.receiptUploadIds?.length)&&(/missing|lost|unavailable/i.test(f.receiptStatus||f.status||'')||f.receiptMissing))add('diesel-proof','Attach missing diesel slips',['finance'],f,'Diesel proof is missing','diesel','diesel');
 for(const e of state.expenses||[])if(['Review','Receipt missing','Pending'].includes(e.status))add('expense-review','Review expenses and supporting proof',['finance'],e,e.status+' · '+(e.category||'Expense'),'roadCharges','expense');
 for(const i of state.invoices||[])if(i.due&&i.due<date&&!['Paid','Cancelled'].includes(i.status)&&number(i.amount)>number(i.paidAmount))add('invoice-overdue','Follow up overdue invoices',['finance'],i,'Payment due '+i.due,'invoices','invoice');
 for(const p of state.payroll||[])if(p.status==='Draft')add('payroll-review','Review draft payslips',['finance'],p,'Payroll '+p.period+' needs review','payroll','payroll');
 for(const m of state.maintenance||[])if(!['Completed','Cancelled'].includes(m.status))add('workshop-open','Complete workshop work orders',['workshop'],m,m.type||'Open service record','workshop','maintenance');
 for(const i of state.inspections||[])if(i.defects&&!['Resolved','Completed','Passed'].includes(i.status))add('inspection-defects','Resolve inspection defects',['workshop'],i,i.defects,'inspections','inspection');
 for(const t of state.tyres||[])if(['Replace','Monitor'].includes(t.status))add('tyre-review','Review flagged tyres',['workshop'],t,t.status+' · '+(t.position||t.serial||''),'tyres','tyre');
 for(const t of state.tasks||[])if(!['Completed','Cancelled'].includes(t.status)&&t.due&&t.due<=date)add('manual-tasks','Complete due or overdue assigned tasks',['dispatcher'],t,'Due '+t.due,'tasks','task');
 return [...groups.values()];
}

function reconcileLinkedTasks(state,now){
 let count=0;
 for(const task of state.tasks||[]){
  if(['Completed','Cancelled'].includes(task.status)||task.fundsUsed||task.expenseId)continue;
  const title=String(task.title||''),trip=(state.trips||[]).find(t=>task.linkedType==='trip'&&t.id===task.linkedId);
  let resolved=false;
  if(trip&&/^(upload|attach|add|capture)\s+.*\bPOD\b/i.test(title)){
   resolved=trip.legs?.length?trip.legs.every(l=>l.pod):Boolean(trip.pod);
  }else if(trip&&/^(upload|attach|add)\s+.*diesel.*slip/i.test(title)){
   const fuel=(state.diesel||[]).filter(f=>f.tripId===trip.id);
   resolved=fuel.length>0&&fuel.every(f=>f.receiptUploadId||f.receiptUploadIds?.length);
  }
  if(resolved){task.status='Completed';task.completedAt=new Date(now).toISOString();task.completedBy='System';task.completionReason='Required proof is present on the linked trip';count++}
 }
 return count;
}
function taskPriority(group,state,date){
 if(group.status==='Completed')return 'Completed';
 const open=group.items.filter(x=>!x.completed);
 if(group.key==='document-renewal'&&open.some(x=>(state.permits||[]).some(p=>p.id===x.id&&p.expiry<date)))return 'Critical';
 if(group.key==='manual-tasks'&&open.some(x=>(state.tasks||[]).some(t=>t.id===x.id&&t.priority==='Critical')))return 'Critical';
 if(group.key==='inspection-defects'&&open.some(x=>(state.inspections||[]).some(i=>i.id===x.id&&i.status==='Failed')))return 'Critical';
 if(group.key==='tyre-review'&&open.some(x=>(state.tyres||[]).some(t=>t.id===x.id&&t.status==='Replace')))return 'Critical';
 return 'Open';
}

function reconcile(state,now=Date.now()){
 reconcileLinkedTasks(state,now);
 const date=day(now),current=collect(state,now);state.dailyPlatformTasks??=[];
 // Resolve older snapshots as well; they remain history instead of reopening.
 for(const task of state.dailyPlatformTasks){
  const group=current.find(x=>x.key===task.key),active=new Set((group?.items||[]).map(x=>x.id));
  task.items=task.items.map(x=>({...x,completed:!active.has(x.id)}));
  task.status=task.items.every(x=>x.completed)?'Completed':'Open';
 }
 for(const group of current){
  let task=state.dailyPlatformTasks.find(x=>x.date===date&&x.key===group.key);
  if(!task){task={...group,id:'daily:'+date+':'+group.key,date,status:'Open'};state.dailyPlatformTasks.push(task)}
  else{const prior=new Map(task.items.map(x=>[x.id,x]));for(const item of group.items)prior.set(item.id,{...item,completed:false});task.items=[...prior.values()];task.status='Open';task.roles=group.roles}
 }
 state.dailyPlatformTasks=state.dailyPlatformTasks.filter(x=>x.date>=new Date(Number(now)-30*86400000).toISOString().slice(0,10));
 for(const group of state.dailyPlatformTasks)group.priority=taskPriority(group,state,date);
 return state.dailyPlatformTasks.filter(x=>x.date===date);
}
const allowed=(group,role)=>['admin','manager'].includes(role)||(group.roles||[]).includes(role);
module.exports={collect,reconcile,day,allowed,office,reconcileLinkedTasks,taskPriority};
