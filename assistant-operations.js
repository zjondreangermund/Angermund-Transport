'use strict';
const crypto=require('node:crypto');
const T=require('./assistant-trip-actions');
const groups={loan_create:['admin','manager','finance'],loan_update:['admin','manager','finance'],task_create:['admin','manager','dispatcher'],trip_driver:['admin','manager','dispatcher'],trip_truck:['admin','manager','dispatcher'],expense_create:['admin','manager','dispatcher','finance']};
const roleCan=(role,kind)=>(groups[kind]||[]).includes(String(role||''));
const key=x=>String(x||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim();
const has=(text,name)=>(' '+key(text)+' ').includes(' '+key(name)+' ');
const amt=s=>Number(String(s).replace(/,/g,''));
function moneyAmounts(s){const re=/(?:N\s*\$|NAD|ZAR|R\s*)([\d][\d,]*(?:\.\d{1,2})?)/ig;return [...String(s).matchAll(re)].map(m=>amt(m[1])).filter(n=>n>0&&Number.isFinite(n)&&n<1e8)}
const employees=s=>Array.isArray(s.employees)&&s.employees.length?s.employees:s.drivers||[];
function person(s,q,kind='employee'){
 const rows=(kind==='driver'?s.drivers||[]:employees(s)).filter(x=>!['Inactive','Archived','Terminated'].includes(x.status));
 const found=rows.filter(x=>x.name&&has(q,x.name));
 return found.length===1?{row:found[0]}:{error:found.length?'More than one person matched. Specify the full name.':'No unique '+kind+' found. Enter the exact name used in Angermund.'};
}
function ref(s,q){const found=(s.trips||[]).filter(x=>x.number&&T.tokenPresent(q,x.number));return found.length===1?{row:found[0]}:{error:found.length?'Multiple trip numbers detected. Specify one trip.':'Enter the exact trip number.'}}
function truck(s,q){const found=(s.trucks||[]).filter(x=>x.fleetName&&T.tokenPresent(q,x.fleetName)||x.registration&&T.tokenPresent(q,x.registration));return found.length===1?{row:found[0]}:{error:found.length?'Multiple trucks detected. Specify one truck.':'Enter a fleet number, for example ANG 12.'}}
function kind(q){
 if(/\b(?:loan|advance)\b/i.test(q)){
  if(/\b(?:pause|suspend|resume|activate|reactivate|change|update|set|edit)\b/i.test(q))return'loan_update';
  if(/\b(?:add|create|give|record|new|issue)\b/i.test(q))return'loan_create';
 }
 if(/\b(?:create|add|record|remind)\b/i.test(q)&&/\btask\b/i.test(q))return'task_create';
 if(/\b(?:assign|reassign|change|switch|replace)\b/i.test(q)&&/\bdriver\b/i.test(q)&&/\btrip\b/i.test(q))return'trip_driver';
 if(/\b(?:assign|reassign|change|switch|replace)\b/i.test(q)&&/\btruck\b/i.test(q)&&/\btrip\b/i.test(q))return'trip_truck';
 if(/\b(?:record|add|create|capture)\b/i.test(q)&&/\b(?:expense|cost|toll|parking|permit fee)\b/i.test(q))return'expense_create';
 return null;
}
function err(s){return{error:s}}
function plan(message,s,now=Date.now()){
 const q=String(message||'').trim(),k=kind(q);if(!k)return null;
 if(k==='loan_create'){
  const p=person(s,q);if(p.error)return p;const am=moneyAmounts(q);
  if(am.length!==2||!/\b(?:monthly|per month|deduction|repayment|instalment|installment)\b/i.test(q))
   return err('Please give the loan and monthly deduction amounts: Add loan to Josef for N$2000, monthly deduction N$200.');
  if(am[1]>am[0])return err('Monthly deduction must not exceed the loan amount.');
  const start=/\bstart(?:ing)?\s+(20\d{2}-\d{2})\b/i.exec(q)?.[1]||new Date(now+7200000).toISOString().slice(0,7);
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(start))return err('Starting month must be YYYY-MM.');
  return{kind:k,employeeId:p.row.id,old:'No loan',next:'N$'+am[0]+' · N$'+am[1]+'/month',
   values:{amount:am[0],monthlyDeduction:am[1],startPeriod:start},description:'Create loan for '+p.row.name,page:'loans',
   lines:[['Employee',p.row.name],['Loan amount','N$ '+am[0].toFixed(2)],['Monthly deduction','N$ '+am[1].toFixed(2)],['Starts',start]],
   warning:'Records an employee loan, not a bank transfer. Payroll deductions follow the existing loan process.'};
 }
 if(k==='loan_update'){
  const p=person(s,q);if(p.error)return p;const matches=(s.loans||[]).filter(l=>l.employeeId===p.row.id&&!['Paid','Cancelled'].includes(l.status));
  if(matches.length!==1)return err(matches.length?'More than one open loan for '+p.row.name+'. Specify it in Worker Loans.':'No active employee loan found for '+p.row.name+'.');
  const l=matches[0],pause=/\b(?:pause|suspend)\b/i.test(q),resume=/\b(?:resume|activate|reactivate)\b/i.test(q);
  if(pause&&resume)return err('Choose one action: pause or resume.');
  let fields,next;
  if(pause){fields={status:'Paused'};next='Paused'}
  else if(resume){fields={status:'Active'};next='Active'}
  else{const am=moneyAmounts(q);if(am.length!==1||!/\b(?:monthly|per month|deduction|repayment|instalment|installment)\b/i.test(q))return err('Specify one amount: Change Josef loan monthly deduction to N$250.');fields={monthlyDeduction:am[0]};next='N$'+am[0]+'/month'}
  const old=fields.status?l.status:'N$'+Number(l.monthlyDeduction||0)+'/month';
  if(old===next)return err('That loan already has this setting.');
  return{kind:k,entityId:l.id,employeeId:p.row.id,fields,old,next,description:'Update loan for '+p.row.name,page:'loans',
   expected:{updatedAt:l.updatedAt||'',status:l.status,balance:Number(l.balance||0),monthlyDeduction:Number(l.monthlyDeduction||0)},
   lines:[['Employee',p.row.name],['Before',old],['After',next]],
   warning:'Only future loan settings change. No previous payroll payments are edited.'};
 }
 if(k==='task_create'){
  const m=/\b(?:create|add|record|remind(?: me to)?)\s+(?:a\s+)?task\s*(?:to|:|-)?\s*(.+)$/i.exec(q);
  if(!m)return err('Try: Create task to check ANG 12 tomorrow, high priority.');
  const due=/\b(?:due|on)\s+(20\d{2}-\d{2}-\d{2})\b/i.exec(q)?.[1]||(/tomorrow/i.test(q)?new Date(now+7200000+86400000).toISOString().slice(0,10):/\btoday\b/i.test(q)?new Date(now+7200000).toISOString().slice(0,10):'');
  if(due&&new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due)return err('Invalid task due date.');
  let title=m[1].replace(/\b(?:due|on)\s+20\d{2}-\d{2}-\d{2}\b/ig,'').replace(/\b(?:tomorrow|today)\b/ig,'').replace(/[,.;]?\s*(?:high|critical|normal|low)\s*(?:priority)?\b/ig,'').trim();
  if(title.length<5||title.length>180)return err('Provide a task description between 5 and 180 characters.');
  const priority=/\bcritical\b/i.test(q)?'Critical':/\bhigh\b/i.test(q)?'High':/\blow\b/i.test(q)?'Low':'Normal';
  return{kind:k,old:'No task',next:title,values:{title,due,priority},description:'Create task: '+title,page:'tasks',
   lines:[['Task',title],['Due',due||'Not set'],['Priority',priority],['Assignment','Dispatcher role']],
   warning:'The task is saved only after approval. Assign a specific person from Tasks if needed.'};
 }
 if(k==='trip_driver'||k==='trip_truck'){
  const tr=ref(s,q);if(tr.error)return tr;const t=tr.row;
  if(Number(t.stage||1)>=4)return err('Delivered or closed trips cannot be reassigned by the assistant.');
  const target=k==='trip_driver'?person(s,q,'driver'):truck(s,q);
  if(target.error)return target;
  const item=target.row,prop=k==='trip_driver'?'driverId':'truckId',name=item.name||item.fleetName||item.registration;
  if(t[prop]===item.id)return err(name+' is already assigned to '+t.number+'.');
  const active=(s.trips||[]).find(o=>o.id!==t.id&&o[prop]===item.id&&Number(o.stage||1)<5&&/in transit|loading|depart|at loading|at offloading|return journey/i.test(o.status||''));
  if(active)return err(name+' is busy on '+active.number+'. Resolve the conflict first.');
  const prior=(s[k==='trip_driver'?'drivers':'trucks']||[]).find(x=>x.id===t[prop]),old=prior?.name||prior?.fleetName||'Unassigned';
  return{kind:k,entityId:t.id,tripId:t.id,tripNumber:t.number,old,next:name,values:{targetId:item.id},
   expected:{number:t.number,updatedAt:t.updatedAt||'',status:t.status||'',stage:Number(t.stage||1),previousId:t[prop]||''},
   description:'Assign '+name+' to '+t.number,page:'trips',
   lines:[['Trip',t.number],[k==='trip_driver'?'Driver':'Truck',old+' → '+name]],
   warning:'Dispatch assignment changes; trip history, fuel slips and invoices remain linked.'};
 }
 if(k==='expense_create'){
  const tr=ref(s,q);if(tr.error)return tr;const am=moneyAmounts(q);
  if(am.length!==1)return err('Include one amount: Record toll expense N$450 for trip AT-101.');
  const category=/\btolls?\b/i.test(q)?'Toll':/\bparking\b/i.test(q)?'Parking':/\b(?:permit fee|border permit)\b/i.test(q)?'Border permit':null;
  if(!category)return err('For expense entry, specify toll, parking, or permit fee.');
  return{kind:k,tripId:tr.row.id,tripNumber:tr.row.number,old:'No expense',next:'N$'+am[0]+' '+category,
   values:{amount:am[0],category},expected:{number:tr.row.number,updatedAt:tr.row.updatedAt||''},
   description:'Capture '+category+' expense for '+tr.row.number,page:'roadCharges',
   lines:[['Trip',tr.row.number],['Category',category],['Amount','N$ '+am[0].toFixed(2)],['Status','Review – receipt missing']],
   warning:'Creates a Review expense, not approved spending. Receipt and expense approval remain required.'};
 }
 return null;
}
function reject(msg,code=409){const e=Error(msg);e.status=code;throw e}
function apply(s,p,actor='Staff approved',now=new Date().toISOString()){
 if(!p||!roleCan(p.actorRole,p.kind))reject('Not allowed to perform this action',403);
 let id='',t=null;
 if(p.kind==='loan_create'){
  const e=employees(s).find(x=>x.id===p.employeeId);if(!e||['Inactive','Archived','Terminated'].includes(e.status))reject('Employee no longer available.');
  if(!(p.values.amount>0&&p.values.monthlyDeduction>0&&p.values.monthlyDeduction<=p.values.amount))reject('Invalid loan amounts',400);
  id='loan_'+crypto.randomUUID();s.loans??=[];s.loans.unshift({id,employeeId:e.id,date:now.slice(0,10),startPeriod:p.values.startPeriod,
   amount:p.values.amount,balance:p.values.amount,monthlyDeduction:p.values.monthlyDeduction,reference:'',notes:'Entered via approved assistant action',
   status:'Active',repayments:[],createdAt:now,createdBy:actor});
 }else if(p.kind==='loan_update'){
  const l=(s.loans||[]).find(x=>x.id===p.entityId),e=p.expected;
  if(!l||!['Active','Paused'].includes(l.status)||String(l.updatedAt||'')!==String(e.updatedAt||'')||
   l.status!==e.status||Number(l.balance||0)!==e.balance||Number(l.monthlyDeduction||0)!==e.monthlyDeduction)reject('Loan has changed since preview; request a fresh draft.');
  if(p.fields.monthlyDeduction!==undefined){if(!(p.fields.monthlyDeduction>0))reject('Invalid repayment',400);l.monthlyDeduction=p.fields.monthlyDeduction}
  if(p.fields.status)l.status=p.fields.status;l.updatedAt=now;l.updatedBy=actor;id=l.id;
 }else if(p.kind==='task_create'){
  id='task_'+crypto.randomUUID();s.tasks??=[];s.tasks.unshift({id,title:p.values.title,description:'Entered through approved assistant action',
   assignedUserId:'',assignedDriverId:'',ownerRole:'Dispatcher',due:p.values.due,priority:p.values.priority,status:'Open',
   linkedType:'',linkedId:'',createdAt:now,createdBy:actor,updatedAt:now});
 }else if(p.kind==='trip_driver'||p.kind==='trip_truck'){
  t=(s.trips||[]).find(x=>x.id===p.tripId);const e=p.expected,prop=p.kind==='trip_driver'?'driverId':'truckId',group=p.kind==='trip_driver'?'drivers':'trucks';
  if(!t||t.number!==e.number||String(t.updatedAt||'')!==String(e.updatedAt||'')||String(t.status||'')!==String(e.status||'')||
    Number(t.stage||1)!==e.stage||String(t[prop]||'')!==String(e.previousId||''))reject('Trip changed since preview.');
  if(Number(t.stage||1)>=4)reject('Completed trip cannot be reassigned.');
  const item=(s[group]||[]).find(x=>x.id===p.values.targetId);if(!item)reject('Truck or driver no longer exists.');
  if((s.trips||[]).some(x=>x.id!==t.id&&x[prop]===item.id&&Number(x.stage||1)<5&&/in transit|loading|depart|at loading|at offloading|return journey/i.test(x.status||'')))reject('Target already busy on another trip.');
  const old=(s[group]||[]).find(x=>x.id===t[prop]);if(old&&old.status==='Assigned')old.status='Available';
  t[prop]=item.id;item.status=Number(t.stage||1)>=3?'On trip':'Assigned';t.updatedAt=now;t.updatedBy=actor;id=t.id;
 }else if(p.kind==='expense_create'){
  t=(s.trips||[]).find(x=>x.id===p.tripId);if(!t||t.number!==p.expected.number||String(t.updatedAt||'')!==String(p.expected.updatedAt||''))reject('Trip changed since preview.');
  if(!['Toll','Parking','Border permit'].includes(p.values.category)||!(p.values.amount>0))reject('Invalid expense',400);
  id='exp_'+crypto.randomUUID();s.expenses??=[];
  s.expenses.unshift({id,tripId:t.id,truckId:t.truckId||'',driverId:t.driverId||'',date:now.slice(0,10),
   category:p.values.category,amount:p.values.amount,status:'Review',receiptMissing:true,receiptStatus:'Receipt missing',
   notes:'Receipt required; entered via approved assistant action',createdAt:now,createdBy:actor});
  // The existing application recalculates linked trip costs from expense records.
 }else reject('Unsupported assistant action',400);
 s.audit??=[];s.audit.unshift({id:'log_'+crypto.randomUUID(),at:now,actor,action:'Assistant-approved: '+p.description,
  linkedType:t?'trip':p.kind.startsWith('loan')?'loan':p.kind==='task_create'?'task':'expense',linkedId:t?.id||id});
 s.audit=s.audit.slice(0,100);
 return{kind:p.kind,recordType:t?'trip':p.kind.startsWith('loan')?'loan':p.kind==='task_create'?'task':'expense',
  tripId:t?.id||null,entityId:id};
}
module.exports={kind,plan,apply,roleCan,moneyAmounts};