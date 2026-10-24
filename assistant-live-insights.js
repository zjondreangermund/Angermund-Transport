'use strict';
const Trip=require('./assistant-trip-actions');
const key=x=>String(x||'').trim().toLowerCase();
const office=['admin','manager','dispatcher','finance'];
const finance=['admin','manager','finance'];
function available(user,k){
 if(!user||!office.includes(user.role))return false;
 if(['loans','expenses'].includes(k)&&!finance.includes(user.role))return false;
 return true;
}
function fmt(n){return 'N$ '+Number(n||0).toLocaleString('en-NA',{minimumFractionDigits:2,maximumFractionDigits:2})}
function promptKind(q){
 const s=String(q||'');
 if(!/^\s*(?:which|what|show|list|tell|how many|are there|find|check|give me)\b/i.test(s))return null;
 if(/\b(?:available|free)\s+(?:trucks|vehicles|fleet)\b/i.test(s)||/\b(?:trucks|vehicles)\s+(?:are\s+)?(?:available|free)\b/i.test(s))return'available_trucks';
 if(/\b(?:planned|not departed|still waiting)\s+trips\b/i.test(s)||/\btrips\b.*\b(?:planned|not departed)\b/i.test(s))return'planned_trips';
 if(/\b(?:missing|without|outstanding)\s+POD\b/i.test(s)||/\bPOD\b.*\b(?:missing|outstanding)\b/i.test(s))return'missing_pod';
 if(/\b(?:overdue|late|outstanding)\s+tasks\b/i.test(s)||/\btasks\b.*\boverdue\b/i.test(s))return'overdue_tasks';
 if(/\b(?:loans?|advances?)\b/i.test(s)&&/\b(?:balance|outstanding|have|owe|owed|loans?|advances?)\b/i.test(s))return'loans';
 if(/\b(?:expenses?|receipts?)\b.*\b(?:pending|review|approval|missing)\b/i.test(s)||/\b(?:pending|review)\s+expenses?\b/i.test(s))return'expenses';
 if(/\b(?:status|details|progress|where is|what happened)\b/i.test(s)&&/\btrip\b/i.test(s))return'trip_status';
 return null;
}
function summary(query,s,user,now=new Date().toISOString()){
 const k=promptKind(query);if(!k)return null;
 if(!available(user,k))return{answer:'Your account cannot access that operational or financial information. Please use an authorized management account.',source:'restricted',page:null};
 const trips=s.trips||[],trucks=s.trucks||[],tasks=s.tasks||[],name=x=>String(x||'');
 const list=(title,rows,page)=>({answer:title+'\n'+(rows.length?rows.slice(0,8).map(x=>'• '+x).join('\n'):'No matching records found.')+
    (rows.length>8?'\n… and '+(rows.length-8)+' more. Open the page for the full list.':''),page,source:'live-records'});
 const truck=x=>trucks.find(t=>t.id===x)?.fleetName||trucks.find(t=>t.id===x)?.registration||'Unassigned';
 const driver=x=>(s.drivers||[]).find(d=>d.id===x)?.name||'Unassigned';
 if(k==='available_trucks'){
  const assigned=new Set(trips.filter(t=>Number(t.stage||1)>=2&&Number(t.stage||1)<5&&
    !/cancelled|closed/i.test(t.status||'')).map(t=>t.truckId));
  const rows=trucks.filter(t=>!assigned.has(t.id)&&['available','idle',''].includes(key(t.status)))
   .map(t=>(t.fleetName||t.registration||t.id)+' · '+(t.status||'No status'));
  return list('Trucks recorded as available ('+rows.length+'). Availability is based on saved dispatch records, not live GPS:',rows,'fleet');
 }
 if(k==='planned_trips'){
  const rows=trips.filter(t=>Number(t.stage||1)<3&&/planned|assigned|booked|loading/i.test(t.status||'Planned'))
    .map(t=>t.number+' · '+truck(t.truckId)+' · '+driver(t.driverId)+' · '+(t.status||'Planned'));
  return list('Trips awaiting departure ('+rows.length+'):',rows,'dispatch');
 }
 if(k==='missing_pod'){
  const rows=trips.filter(t=>Number(t.stage||1)>=4&&Number(t.stage||1)<6&&
    (!t.pod||Array.isArray(t.legs)&&t.legs.some(l=>!l.pod))).map(t=>t.number+' · '+truck(t.truckId)+' · '+(t.status||''));
  return list('Delivered/offloading trips with missing POD ('+rows.length+'):',rows,'driverUploads');
 }
 if(k==='overdue_tasks'){
  const day=now.slice(0,10);
  const rows=tasks.filter(t=>!['Completed','Cancelled'].includes(t.status)&&t.due&&t.due<day)
   .map(t=>t.title+' · due '+t.due+' · '+(t.priority||'Normal'));
  return list('Overdue open tasks ('+rows.length+'):',rows,'tasks');
 }
 if(k==='loans'){
  const employees=(s.employees||[]).length?s.employees:s.drivers||[];
  const target=employees.filter(e=>e.name&&(' '+key(query)+' ').includes(' '+key(e.name)+' '));
  const partial=target.length?target:employees.filter(e=>e.name&&(' '+key(query)+' ').includes(' '+key(e.name).split(/\s+/)[0]+' '));
  if(partial.length>1)return{answer:'Multiple employees match. Include the full employee name.',page:'loans',source:'live-records'};
  if(!partial.length)return{answer:'Give the name of the employee whose loan balance you want to check.',page:'loans',source:'live-records'};
  const employee=partial[0],rows=(s.loans||[]).filter(l=>l.employeeId===employee.id).map(l=>
    'Loan '+(l.reference||l.id)+' · balance '+fmt(l.balance)+' · '+fmt(l.monthlyDeduction)+'/month · '+l.status);
  return list('Loan records for '+employee.name+':',rows,'loans');
 }
 if(k==='expenses'){
  const rows=(s.expenses||[]).filter(e=>/review|pending/i.test(e.status||''))
   .map(e=>(e.category||'Expense')+' · '+fmt(e.amount)+' · trip '+(trips.find(t=>t.id===e.tripId)?.number||'Unlinked')+
     (e.receiptMissing?' · receipt missing':''));
  return list('Expenses awaiting review ('+rows.length+'):',rows,'expenses');
 }
 if(k==='trip_status'){
  const xs=trips.filter(t=>t.number&&Trip.tokenPresent(query,t.number));
  if(xs.length!==1)return{answer:'Mention one exact trip number to look up its current saved status.',page:'trips',source:'live-records'};
  const t=xs[0];
  return{answer:'Trip '+t.number+' · '+(t.status||'Unknown status')+
   '\nTruck: '+truck(t.truckId)+' · Driver: '+driver(t.driverId)+
   '\nStage: '+Number(t.stage||1)+' · Legs: '+(t.legs?.length||1)+
   '\nLast saved update: '+(t.updatedAt||'Not recorded')+
   '\nThis is dispatch status, not confirmed real-time GPS.',page:'trips',source:'live-records'};
 }
 return null;
}
module.exports={promptKind,summary,available};
