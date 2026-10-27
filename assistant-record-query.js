'use strict';
// Read-only, explicitly scoped business queries. The AI may select an intent,
// but NEVER supplies record facts, database fields, permissions, or SQL.
const Link=require('./payroll-trip-link');
const TripProfit=require('./assistant-trip-profit');
const Cycle=require('./payroll-cycle');
const BusinessAudit=require('./assistant-business-audit');
const Metrics=require('./public/trip-metrics');
const normalize=v=>String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\bang[\s-]*0*(\d+)\b/g,'ang$1').replace(/[^a-z0-9]+/g,' ').trim();
const iso=v=>String(v||'').slice(0,10), cash=n=>'N$ '+Number(n||0).toFixed(2);
const office=new Set(['admin','manager','dispatcher','finance']),finance=new Set(['admin','manager','finance']);
const roster=new Set(['admin','manager','finance']);
const modeNames=new Set([...BusinessAudit.modes,'trip_profit','driver_trips','employee_tenure','worker_loans','vehicle_location','unpaid_invoices','missing_pod','pending_diesel','truck_status','record_totals','driver_payroll','payroll_period','aggregate']);
const writeAction=/^\s*(?:add|create|delete|remove|edit|change|set|assign|move|approve|pay|mark|update|capture|upload|generate|cancel|start|stop|finish)\b/i;
function dayLocal(now=new Date()){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Windhoek',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function safeDate(y,m,d){
 const dt=new Date(Date.UTC(y,m-1,d));
 if(dt.getUTCFullYear()!==y||dt.getUTCMonth()+1!==m||dt.getUTCDate()!==d)return null;
 return dt.toISOString().slice(0,10);
}
const monthNames=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function parseDates(q,now=new Date()){
 const year=Number(dayLocal(now).slice(0,4)),matches=[];
 const re=/\b(20\d{2}-\d{1,2}-\d{1,2}|(?:\d{1,2})\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*20\d{2})?)\b/gi;
 for(const m of String(q||'').matchAll(re)){
  const word=m[0],isoMatch=/^(20\d{2})-(\d{1,2})-(\d{1,2})$/.exec(word);
  let date=null;
  if(isoMatch)date=safeDate(+isoMatch[1],+isoMatch[2],+isoMatch[3]);
  else {const named=/^(\d{1,2})\s*([a-z]+)(?:\s*(20\d{2}))?$/i.exec(word);
   if(named)date=safeDate(+(named[3]||year),monthNames.indexOf(named[2].toLowerCase().slice(0,3))+1,+named[1]);}
  if(date)matches.push(date);
 }
 if(matches.length>=2){const a=matches[0],b=matches[1];
  // "20 Sep to 20 Oct" at early January can refer to previous year,
  // otherwise accept the explicit input calendar years.
  return{from:a,to:b,kind:'range'};}
 if(matches.length===1)return{from:matches[0],to:matches[0],kind:'date'};
 const period=/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/.exec(q);
 if(period){const y=+period[1],m=+period[2];return{from:safeDate(y,m,1),to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),kind:'month'};}
 const namedMonth=/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/i.exec(q);
 if(namedMonth){const y=Number(namedMonth[2]||year),m=monthNames.indexOf(namedMonth[1].slice(0,3).toLowerCase())+1;return{from:safeDate(y,m,1),to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),kind:'month'};}
 if(/\b(?:this month|current month)\b/i.test(q)){const y=+dayLocal(now).slice(0,4),m=+dayLocal(now).slice(5,7);return{from:safeDate(y,m,1),to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),kind:'month'}}
 if(/\b(?:last month|previous month)\b/i.test(q)){const x=new Date(Date.UTC(+dayLocal(now).slice(0,4),+dayLocal(now).slice(5,7)-2,1));return{from:x.toISOString().slice(0,10),to:new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).toISOString().slice(0,10),kind:'month'}}
 return{from:null,to:null,kind:'all'};
}
function resolvePerson(q,state,{target=null}={}){
 const people=[...(state.employees||[]),...(state.drivers||[])],text=normalize(q),targetText=normalize(target||'');
 const candidates=people.filter(p=>{
  const names=[p.name,[p.firstName,p.lastName].filter(Boolean).join(' ')].filter(Boolean);
  return names.some(name=>{
   const n=normalize(name),tokens=n.split(' ');
   const query=' '+text+' ',explicit=' '+targetText+' ';
   return n.length>=3&&(query.includes(' '+n+' ')||targetText&&explicit.includes(' '+n+' ')||
    tokens.some(t=>t.length>=4&&(query.includes(' '+t+' ')||targetText&&explicit.includes(' '+t+' '))));
  });
 });
 const identities=new Map();
 for(const p of candidates){
  const driver=Link.resolveDriver(state,p)||((state.drivers||[]).find(d=>d.id===p.id)||null);
  const entity=(state.employees||[]).find(e=>e.id===p.id||e.driverId===driver?.id||normalize(e.name)===normalize(p.name))||p;
  const key=driver?.id||'employee:'+entity.id;
  if(!identities.has(key))identities.set(key,{person:entity,driver});
 }
 const found=[...identities.values()];
 return{match:found.length===1?found[0]:null,ambiguous:found.length>1,candidates:found.slice(0,5).map(x=>x.person.name||x.driver?.name)};
}
function resolveTruck(q,state,target=null){
 const m=/\bang[\s-]*0?(\d{1,2})\b/i.exec(q+' '+(target||''));if(!m)return null;
 const num=Number(m[1]);
 return(state.trucks||[]).find(t=>{const code=/\bang[\s-]*0?(\d{1,2})\b/i.exec(String(t.fleetName||''));return code&&Number(code[1])===num||normalize(t.id)==='trk ang'+num||normalize(t.id)==='trkang'+num;})||null;
}
function parse(q){
 const x=String(q||'').trim(),n=normalize(x);if(!x||writeAction.test(x))return null;
 if(TripProfit.detects(x))return{mode:'trip_profit'};
 const investigation=BusinessAudit.detect(x);
 if(investigation)return{mode:investigation};
 // Direct routing is free and independent of a model. Unknown read questions
 // can be classified by the inexpensive planner and resolved by this same tool.
 if(/\b(where|location|position|locate|gps)\b/i.test(x)&&(/\bang[\s-]*\d+/i.test(x)||/\btruck\b/i.test(x)))return{mode:'vehicle_location'};
 if(/\b(?:payslip|payroll|driver salaries|shunter salary)\b/i.test(x)&&/\b(?:cut.?off|pay period|covered|dates?|include|september|october|month|calendar)\b/i.test(x))return{mode:'payroll_period'};
 if(/\b(how many|number of|count|total)\b/i.test(x)&&/\b(trips?|loads?|journeys?)\b/i.test(x)&&/\b(?:drove|driven|drive|did|made|completed|handled|by|for)\b/i.test(x))return{mode:'driver_trips'};
 if(/\b(how long|how many years|how many months|since when|when did)\b/i.test(x)&&/\b(work|working|employ|joined|started|with us|been here|service)\b/i.test(x))return{mode:'employee_tenure'};
 if(/\b(loans?|borrowed|borrowing|outstanding advances?)\b/i.test(x)&&/\b(who|which|how many|balance|this month|current|active|outstanding|has|have)\b/i.test(x))return{mode:'worker_loans'};
 if(/\b(unpaid|overdue|outstanding|not paid)\b/i.test(x)&&/\b(invoices?|clients?|debtors?)\b/i.test(x))return{mode:'unpaid_invoices'};
 if(/\b(?:missing|outstanding|not uploaded|not received|without)\b/i.test(x)&&/\bPODs?\b/i.test(x))return{mode:'missing_pod'};
 if(/\b(?:pending|unverified|unapproved|awaiting)\b/i.test(x)&&/\b(diesel|fuel|slips?|receipts?)\b/i.test(x))return{mode:'pending_diesel'};
 if(/\b(?:status|doing|on trip|on route|where)\b/i.test(x)&&/\bang[\s-]*\d+\b/i.test(x))return{mode:'truck_status'};
 if(/\b(?:how many|total number|count)\b/i.test(x)&&/\b(trucks?|drivers?|employees?|invoices?|loans?|trips?)\b/i.test(x))return{mode:'record_totals'};
 if(/\b(?:payslip|payroll|salary|trip pay)\b/i.test(x)&&/\b(?:how much|amount|total|did|earned|pay|balance)\b/i.test(x))return{mode:'driver_payroll'};
 return null;
}
function allowed(mode,role){
 if(!modeNames.has(mode))return false;
 if(BusinessAudit.modes.has(mode))return role==='admin'||role==='manager'||role==='finance'||role==='dispatcher';
 if(mode==='aggregate')return office.has(role);
 if(mode==='payroll_period')return finance.has(role);
 if(['vehicle_location','truck_status','driver_trips','missing_pod','pending_diesel','record_totals'].includes(mode))return office.has(role);
 return finance.has(role);
}
const result=(answer,page,records=[])=>({answer,page,records:records.slice(0,12),source:'verified-business-records',aiEnabled:false});
function personError(q,s,target){
 const x=resolvePerson(q,s,{target});
 return{x,answer:x.ambiguous?'Multiple staff records match that name: '+x.candidates.join(', ')+'. Please specify the full name.':'No matching staff or driver record was found for the name in this question. Check Drivers & Staff for the correct name.'};
}

const aggregateCatalog={
 trips:{role:'office',fields:['distance','income','tons'],date:'date',page:'trips'},
 diesel:{role:'office',fields:['litres','printedTotal','total','odometer'],date:'date',page:'diesel'},
 expenses:{role:'finance',fields:['amount'],date:'date',page:'roadCharges'},
 invoices:{role:'finance',fields:['amount','balance','paidAmount'],date:'date',page:'invoices'},
 loans:{role:'finance',fields:['amount','balance','monthlyDeduction'],date:'date',page:'loans'},
 payroll:{role:'finance',fields:['tripKm','tripPay','gross','net','shunterBonus'],date:'period',page:'payroll'},
 maintenance:{role:'office',fields:['amount','cost'],date:'date',page:'workshop'},
 trucks:{role:'office',fields:[],date:null,page:'fleet'},
 drivers:{role:'office',fields:[],date:null,page:'driverAccounts'},
 employees:{role:'finance',fields:[],date:'dateEmployed',page:'driverAccounts'},
 tasks:{role:'office',fields:[],date:'due',page:'tasks'}
};
function aggregate(p,q,s,role,extra){
 const spec=aggregateCatalog[p.collection],metric=p.metric||'count';
 if(!spec||!['count','sum','list'].includes(metric))return null;
 if(spec.role==='finance'&&!finance.has(role))return result('You cannot access those finance records.',null);
 if(metric==='sum'&&!spec.fields.includes(p.field))return result('That amount cannot be safely calculated from this data field. Specify litres, amount, tripKm or another supported quantity.',spec.page);
 const period=p.from&&p.to&&parseDates(p.from+' to '+p.to,extra.now)?.from?parseDates(p.from+' to '+p.to,extra.now):parseDates(q,extra.now);
 const person=resolvePerson(q,s,{target:p.person}),truck=resolveTruck(q,s,p.truck);
 if(p.person&&!person.match)return result('The employee or driver named in your question could not be uniquely matched. Check the exact saved name.',spec.page);
 if(p.truck&&!truck)return result('The truck number is not uniquely matched in saved fleet records.',spec.page);
 const employees=s.employees||[],drivers=s.drivers||[],dateKey=spec.date,
     wantedDriver=person.match?.driver?.id,employeeId=person.match?.person?.id;
 const records=(s[p.collection]||[]).filter(x=>{
   if(p.status&&normalize(x.status)!==normalize(p.status))return false;
   if(dateKey&&period?.from){
     const value=String(x[dateKey]||'');
     const d=dateKey==='period'?value.slice(0,7)+'-01':iso(value);
     if(d<period.from||d>period.to)return false;
   }
   if(truck){
     if(p.collection==='trucks')return x.id===truck.id;
     if(p.collection==='drivers')return false;
     if(![x.truckId,x.vehicleId].some(id=>id===truck.id)){
       if(p.collection==='diesel'&&x.tripId&&(s.trips||[]).find(t=>t.id===x.tripId)?.truckId===truck.id)return true;
       return false;
     }
   }
   if(person.match){
     if(p.collection==='employees')return x.id===employeeId;
     if(p.collection==='drivers')return x.id===wantedDriver;
     if(['loans','payroll'].includes(p.collection))return x.employeeId===employeeId;
     if(['trips','diesel','expenses','tasks'].includes(p.collection)){
       const linkedDriver=p.collection==='diesel'&&(s.trips||[]).find(t=>t.id===x.tripId)?.driverId;
       return wantedDriver&&[x.driverId,linkedDriver].some(id=>id===wantedDriver);
     }
   }
   return true;
 });
 const summary=(metric==='sum'?records.reduce((a,r)=>a+Number(r[p.field]||0),0):records.length);
 const suffix=period?.from?' from '+period.from+' to '+period.to:' across saved history';
 const label=metric==='sum'?p.field+' total':metric==='list'?'records found':'records';
 const answer='Saved '+p.collection+' '+label+': '+(metric==='sum'?(p.field==='amount'||p.field==='balance'||p.field==='paidAmount'||p.field==='gross'||p.field==='net'||p.field==='tripPay'||p.field==='income'||p.field==='printedTotal'||p.field==='total'?cash(summary):summary.toFixed(2)):summary)+
   suffix+(p.status?' · status '+p.status:'')+
   (p.person?' · '+p.person:'')+(p.truck?' · '+p.truck:'')+'.'+
   (metric==='list'&&records.length?'\n'+records.slice(0,12).map(x=>
      String(x.number||x.name||x.fleetName||x.reference||x.id||'Record')+' · '+String(x.status||'')+' · '+String(x.date||x.period||'')
    ).join('\n'):'')+
    '\nOnly saved app records were counted. Imported-but-uncommitted or external data are not included.';
 return result(answer,spec.page,p.collection==='trips'?records.slice(0,12).map(t=>({kind:'trip',id:t.id,label:t.number||t.id})):[]);
}

function run(plan,q,s={},user={},extra={}){
 const mode=plan?.mode,role=String(user.role||'');
 if(!allowed(mode,role))return result('You do not have permission to view these business records.',null);
 if(BusinessAudit.modes.has(mode))return BusinessAudit.run(mode,q,s,user,{...extra,person:plan.person});
 if(mode==='trip_profit')return TripProfit.run(q,s,{dates:parseDates(q,extra.now||new Date()),truck:resolveTruck(q,s,plan.truck),truckRequested:/\bang[\s-]*\d+\b/i.test(q+' '+(plan.truck||'')),person:resolvePerson(q,s,{target:plan.person})});
 if(mode==='aggregate')return aggregate(plan,q,s,role,extra);
 const dates=parseDates(q,extra.now||new Date());
 if(mode==='payroll_period'){
  const word=/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(20\d{2})\b/i.exec(q);
  const specified=/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/.exec(q);
  const period=specified?specified[1]+'-'+specified[2].padStart(2,'0'):word?word[2]+'-'+String(monthNames.indexOf(word[1].toLowerCase().slice(0,3))+1).padStart(2,'0'):dayLocal(extra.now||new Date()).slice(0,7);
  const named=resolvePerson(q,s,{target:plan?.person});
  if(named.ambiguous)return result('Several driver records match. Specify the exact employee name.','payroll');
  const records=named.match?[named.match.person]:[];
  if(!records.length){
    const sampleDriver={id:'reference'},transport=Cycle.bounds(period,sampleDriver,false,null,{cutoffDay:20}),monthly=Cycle.bounds(period,sampleDriver,true,null,{});
    const saved=(s.payroll||[]).filter(p=>p.period===period);
    const listed=saved.slice(0,8).map(p=>((s.employees||[]).find(e=>e.id===p.employeeId)?.name||p.employeeId)+': '+p.periodStart+' to '+p.periodEnd+' ('+p.status+')');
    return result('Payroll label '+period+' does not imply only that calendar month.'+
      '\nTransport default: '+transport.start+' to '+transport.periodEnd+' (21st to 20th, including the final days of the previous month).'+
      '\nANG 4/5 shunter: '+monthly.start+' to '+monthly.periodEnd+' (full calendar month).'+
      '\nCustom driver cutoff dates and saved NBL invoice dates take priority.'+
      (listed.length?'\nSaved '+period+' individual pay periods:\n'+listed.join('\n'):'\nNo individual '+period+' payslip was found. Generate Draft payroll to store exact periods.'),'payroll');
  }
  const employee=records[0],driver=Link.resolveDriver(s,employee),profile=(s.payProfiles||[]).find(p=>p.employeeId===employee.id)||{};
  const shunter=Cycle.shunterDriver(s,driver,profile),existing=(s.payroll||[]).find(p=>p.employeeId===employee.id&&p.period===period);
  const cycle=Cycle.bounds(period,driver,shunter,existing,profile);
  return result(employee.name+' · '+period+' ('+(shunter?'ANG 4/5 monthly shunter':'transport cutoff-to-cutoff')+'):\n'+cycle.start+' to '+cycle.periodEnd+
   (existing?' · saved payslip '+existing.status+' (exact saved dates).':' · expected dates before payslip creation.')+
   (shunter?'\nShunter monthly base and daily driving bonus apply to ANG 4/ANG 5 assignments.':'\nNBL invoice dates override any default/custom transport cutoff.')+
   '\nThe month displayed in the payslip picker is a label; check the exact dates for that driver.','payroll');
 }
 if(mode==='driver_trips'||mode==='employee_tenure'||mode==='driver_payroll'){
  const{ x,answer:error}=personError(q,s,plan?.person);
  if(!x.match)return result(error,'driverAccounts');
  const {person,driver}=x.match,name=person.name||driver?.name||'Driver';
  if(mode==='employee_tenure'){
   const employed=iso(person.dateEmployed||person.employmentStartDate||person.hireDate||person.startDate);
   if(!/^\d{4}-\d\d-\d\d$/.test(employed)||!Number.isFinite(Date.parse(employed+'T00:00:00Z')))
    return result(name+' has a saved employee record, but the Date Employed field is empty or invalid. Open Drivers & Staff → '+name+' → Edit to record the verified employment start date.','driverAccounts');
   const until=dayLocal(extra.now||new Date()),start=new Date(employed+'T00:00:00Z'),end=new Date(until+'T00:00:00Z');
   if(end<start)return result(name+' has a future Date Employed ('+employed+'). Check this date in Drivers & Staff.','driverAccounts');
   let years=end.getUTCFullYear()-start.getUTCFullYear(),months=end.getUTCMonth()-start.getUTCMonth(),days=end.getUTCDate()-start.getUTCDate();
   if(days<0){months--;days+=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),0)).getUTCDate();}
   if(months<0){years--;months+=12;}
   return result(name+' started on '+employed+'. As of '+until+', recorded employment duration is '+years+' year(s), '+months+' month(s) and '+days+' day(s).'+(person.status?' Staff status: '+person.status+'.':''),'driverAccounts');
  }
  if(!driver)return result(name+' is saved as an employee, but no unique driver ID is linked. Check Drivers & Staff before counting or paying trips.','driverAccounts');
  if(mode==='driver_trips'){
   const rows=(s.trips||[]).filter(t=>String(t.driverId)===String(driver.id) && !/cancelled|canceled|deleted/i.test(String(t.status||'')) &&
    (Number(t.stage||0)>=3||/delivered|completed|invoiced|closed/i.test(String(t.status||''))) &&
    (!dates.from||iso(t.date||t.startedAt||t.deliveredDate)>=dates.from && iso(t.date||t.startedAt||t.deliveredDate)<=dates.to))
     .sort((a,b)=>iso(a.date).localeCompare(iso(b.date))||String(a.number||'').localeCompare(String(b.number||'')));
   const all=(s.trips||[]).filter(t=>String(t.driverId)===String(driver.id)),planned=all.filter(t=>!rows.includes(t)&&(!dates.from||iso(t.date)>=dates.from&&iso(t.date)<=dates.to));
   const trips=rows.slice(0,12),dateLabel=dates.from?(' from '+dates.from+' through '+dates.to):' across saved history';
   return result(name+' has '+rows.length+' saved completed/delivered trip(s)'+dateLabel+'.'+
     (trips.length?'\n'+trips.map(t=>(t.number||t.id)+' · '+iso(t.date)+' · '+((s.trucks||[]).find(x=>x.id===t.truckId)?.fleetName||'truck unassigned')+' · '+(t.status||'Delivered')).join('\n'):'\nNo completed/delivered trips were found in the saved records for that selection.')+
     (planned.length?'\n'+planned.length+' other assigned trip(s) were not counted because they may be planned, active or otherwise not completed.':'')+
     '\nThis counts saved driver assignments, not proof that every real-world trip was imported.','trips',trips.map(t=>({kind:'trip',id:t.id,label:t.number||t.id})));
  }
  const pay=(s.payroll||[]).filter(p=>p.employeeId===person.id).sort((a,b)=>String(b.period||'').localeCompare(String(a.period||'')))[0];
  if(!pay)return result('No saved payslip was found for '+name+'.','payroll');
  return result(name+' · '+pay.period+' ('+pay.status+') · '+(pay.periodStart||'?')+' to '+(pay.periodEnd||'?')+
   '\n'+Number(pay.tripKm||0)+' trip km · '+cash(pay.tripPay)+' trip pay · '+Number(pay.tripCount||0)+' saved payable trips · '+cash(pay.net)+' net salary.','payroll');
 }
 if(mode==='worker_loans'){
  const workers=s.employees||[],personId=plan?.person?personError(q,s,plan.person).x.match?.person?.id:null;
  const today=dayLocal(extra.now||new Date()),month=today.slice(0,7);
  const active=(s.loans||[]).filter(l=>Number(l.balance||0)>0&&!/paid|cancelled|closed|written off/i.test(String(l.status||''))&&(!personId||l.employeeId===personId));
  const opened=(s.loans||[]).filter(l=>iso(l.date).slice(0,7)===(dates.from?dates.from.slice(0,7):month));
  const list=active.slice(0,16).map(l=>{
   const employee=workers.find(x=>x.id===l.employeeId)||(s.drivers||[]).find(x=>x.id===l.employeeId);
   return (employee?.name||'Unmatched employee ID')+' · '+cash(l.balance)+' outstanding · '+cash(l.monthlyDeduction)+' monthly · reference '+String(l.reference||l.id||'').slice(0,50);
  });
  return result('As of '+today+', '+active.length+' worker loan(s) have a positive outstanding balance'+(personId?' for the specified employee':'')+'.'+
    (list.length?'\n'+list.join('\n'):'\nNo active outstanding worker loans appear in the saved records.')+
    '\n'+opened.length+' loan record(s) dated '+(dates.from?dates.from.slice(0,7):month)+'. Active balances and loans newly issued this month are different measures.','loans');
 }
 if(mode==='vehicle_location'||mode==='truck_status'){
  const truck=resolveTruck(q,s,plan?.truck);if(!truck)return result('No uniquely matching ANG truck in the fleet records. Include the fleet number, e.g. ANG10.','fleet');
  const matching=(s.trips||[]).filter(t=>t.truckId===truck.id&&!/cancelled|deleted/i.test(String(t.status||'')));
  const active=matching.filter(t=>!(/closed|completed|delivered|invoiced/i.test(String(t.status||''))||Number(t.stage||0)>=4))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const gps=(extra.gps||[]).find(x=>String(x.vehicleId||'')===String(truck.id));
  const latest=active[0],status=latest?'Saved dispatch: '+(latest.number||latest.id)+' · '+(latest.status||'status not set')+' · '+(latest.date||'date unknown'):'No active trip in saved dispatch.';
  if(mode==='truck_status')return result((truck.fleetName||truck.id)+' · '+status+
   (gps?'\nLatest GPS timestamp: '+String(gps.recordedAt||'not recorded'):'\nNo live position verified.'),'dispatch');
  if(!gps)return result((truck.fleetName||truck.id)+': no GPS fix is saved in the tracking data available to this assistant. '+status+
    ' This cannot confirm its physical location. Check the tracker connection and GPS page.','tracking');
  const at=Date.parse(gps.recordedAt),age=Number.isFinite(at)?Math.max(0,(extra.now||new Date()).getTime()-at):Infinity,valid=Number.isFinite(Number(gps.latitude))&&Number.isFinite(Number(gps.longitude));
  if(!valid)return result((truck.fleetName||truck.id)+': the saved position has no usable coordinates. '+status,'tracking');
  const recent=age<=15*60_000,lat=Number(gps.latitude),lng=Number(gps.longitude);
  const link='https://www.google.com/maps?q='+lat+','+lng;
  return result((truck.fleetName||truck.id)+(recent?' · recent reported GPS fix':' · LAST KNOWN position (not confirmed current)')+
   '\nCoordinates: '+lat.toFixed(6)+', '+lng.toFixed(6)+' · recorded '+String(gps.recordedAt||'time unknown')+
   ' · '+String(gps.source||'tracking source unknown')+
   (Number.isFinite(Number(gps.accuracy))?' · accuracy '+Number(gps.accuracy)+' m':'')+
   '\nMap: '+link+'\n'+status+(recent?'\nA recent fix does not guarantee real-time continuous tracking.':'\nThis signal is stale; do not interpret this as where the truck is now.'),'tracking');
 }
 if(mode==='unpaid_invoices'){
  const rows=(s.invoices||[]).filter(i=>!/cancelled|void|draft/i.test(String(i.status||''))&&
   ((Number.isFinite(Number(i.balance))&&Number(i.balance)>0.005)||!(/paid|settled/i.test(String(i.status||''))))) ;
  const list=rows.slice(0,12).map(i=>(i.number||i.id)+' · '+(i.status||'status not set')+' · '+cash(i.balance??i.amount)+' balance');
  return result(rows.length+' outstanding/unpaid invoice(s) in saved records.'+(list.length?'\n'+list.join('\n'):'')+
    '\nBalances are based on saved invoice status/amounts, not external bank reconciliation.','invoices');
 }
 if(mode==='missing_pod'){
  const rows=(s.trips||[]).filter(t=>Number(t.stage||0)>=3&&!/cancelled/i.test(String(t.status||'')) &&
   !(t.legs?.length?(t.legs||[]).every(x=>x.pod||t.pod):t.pod));
  return result(rows.length+' saved trips at delivery stage or later have missing POD evidence.'+
   (rows.length?'\n'+rows.slice(0,12).map(t=>(t.number||t.id)+' · '+(t.status||'status unknown')).join('\n'):'')+
   '\nCheck the original signed POD before confirming delivery.','trips',rows.slice(0,12).map(t=>({kind:'trip',id:t.id,label:t.number||t.id})));
 }
 if(mode==='pending_diesel'){
  const rows=(s.diesel||[]).filter(d=>d.verified!==true&&!/cancelled|deleted/i.test(String(d.status||'')));
  return result(rows.length+' diesel record(s) are awaiting verification.'+
   (rows.length?'\n'+rows.slice(0,12).map(d=>(d.slip||d.id)+' · '+iso(d.date)+' · '+(s.trips||[]).find(t=>t.id===d.tripId)?.number).join('\n'):'')+
   '\nUnverified fuel receipts require checking against original slips.','diesel');
 }
 if(mode==='record_totals'){
  const maps=[['trucks','trucks'],['drivers','drivers'],['employees','employees'],['invoices','invoices'],['loans','loans'],['trips','trips']];
  const match=maps.find(([word])=>new RegExp('\\b'+word.replace(/s$/,'')+'s?\\b','i').test(q));
  const collection=match?.[1]||'trips';if(['loans','invoices'].includes(collection)&&!finance.has(role))
   return result('Your role cannot view finance record totals.',null);
  return result('Saved '+collection+': '+(s[collection]||[]).length+'. This counts records in the application, not unimported external activity.',collection==='employees'?'driverAccounts':collection==='loans'?'loans':collection==='invoices'?'invoices':'trips');
 }
 return null;
}
module.exports={parse,run,allowed,parseDates,resolvePerson,resolveTruck,dayLocal,modeNames};
