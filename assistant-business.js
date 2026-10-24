'use strict';
const crypto=require('node:crypto'),P=require('./assistant-platform'),D=require('./daily-platform-actions'),{iso}=require('./assistant-extra-actions');
const key=v=>String(v??'').trim().toLowerCase();
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const financial=r=>['admin','manager','finance'].includes(r),admin=r=>['admin','manager'].includes(r);
const masterFields={trucks:['fleetName','registration','make','type','odometer','serviceDue','licenseExpiry','roadworthyExpiry','trackerId','trackerModel'],employees:['name','jobTitle','category','phone','email','idNumber','licenseExpiry'],clients:['name','contact','email','phone','address','vat','terms'],routes:['name','distance','namibiaKm','rate','crossBorder','roundTrip','loadName','offloadName'],permits:['type','ownerType','ownerId','reference','issued','expiry','notes']};
const settings=['dieselPrice','vat','targetKml','standingFee','mdcRatePer100km'];
function can(role,op,c){const target={payment:'payments',payroll:'payroll',payroll_profile:'payProfiles',overhead:'monthlyCosts',settings:'settings'}[op];if(target&&c!==target)return false;if(['payment','payroll','payroll_profile','overhead'].includes(op))return financial(role);if(op==='master_create'||op==='master_edit'||op==='master_archive')return admin(role)&&!!masterFields[c];if(op==='settings')return role==='admin';return false}
function catalog(role){return[
 {operation:'payment',collection:'payments',description:'Record money ALREADY received on an invoice: target invoice reference, values date,amount,method,reference. Does not transfer money.'},
 {operation:'payroll_profile',collection:'payProfiles',description:'Update an employee payroll profile: target exact employee name, allowed baseSalary,tripRatePerKm,payeDefault,sscDefault,overtimeRate,standardDays,otherDeductionDefault,taxNumber,autoGenerate. Does not change already approved/paid payslips.'},
 {operation:'payroll',collection:'payroll',description:'Generate or refresh draft payroll for explicit period YYYY-MM using existing payroll rules. Never approve/pay.'},
 {operation:'overhead',collection:'monthlyCosts',description:'Create overhead: period YYYY-MM, category,description,amount, optional truck reference, recurring true/false.'},
 ...Object.keys(masterFields).flatMap(c=>['master_create','master_edit','master_archive'].map(op=>({operation:op,collection:c,description:(op==='master_archive'?'Archive (deactivate) one master record, never delete its history.':'Allowed fields: '+masterFields[c].join(', '))+'. target exact name/ID for edits. Truck/driver cannot archive with open trips.'}))),
 {operation:'settings',collection:'settings',description:'Update explicit operational setting values only: '+settings.join(', ')}
].filter(x=>can(role,x.operation,x.collection))}
function parse(q){let m;
 if(m=/^(?:change|set|update)\s+(.+?)\s+(?:salary|base salary)\s+to\s+(?:N\$|NAD\s*|R\s*)?([\d,.]+)$/i.exec(q))return{operation:'payroll_profile',collection:'payProfiles',target:m[1],values:{baseSalary:Number(m[2].replace(/,/g,''))}};
 if(m=/^(?:record|add)\s+payment\s+(?:of\s+)?(?:N\$|NAD\s*|R\s*)?([\d,.]+)\s+(?:for|on|to)\s+(?:invoice\s+)?(\S+)\s+(?:on\s+)?(20\d{2}-\d{2}-\d{2})(?:\s+reference\s+(.+))?$/i.exec(q))return{operation:'payment',collection:'payments',target:m[2],values:{amount:Number(m[1].replace(/,/g,'')),date:m[3],reference:m[4]||'',method:'Recorded receipt'}};
 if(m=/^(?:generate|prepare|create)\s+(?:draft\s+)?payroll\s+(?:for\s+)?(20\d{2}-\d{2})$/i.exec(q))return{operation:'payroll',collection:'payroll',values:{period:m[1]}};
 if(m=/^(?:set|change|update)\s+setting\s+(dieselPrice|vat|targetKml|standingFee|mdcRatePer100km)\s+(?:to\s+)?(\d+(?:\.\d+)?)$/i.exec(q))return{operation:'settings',collection:'settings',values:{[settings.find(s=>key(s)===key(m[1]))]:Number(m[2])}};
 if(m=/^(?:archive|deactivate)\s+(truck|employee|client|route|permit)\s+(.+)$/i.exec(q))return{operation:'master_archive',collection:{truck:'trucks',employee:'employees',client:'clients',route:'routes',permit:'permits'}[key(m[1])],target:m[2],values:{}};
 return null;
}
function plan(req,s,role){
 const {operation:op,collection:c}=req;if(!can(role,op,c))fail('Your account cannot perform this business operation.',403);
 const v=req.values||{},p={kind:'business',operation:op,collection:c,actorRole:role,values:structuredClone(v),checks:[],page:({payments:'invoices',payProfiles:'payroll',payroll:'payroll',monthlyCosts:'monthlyPnl',trucks:'fleet',employees:'driverAccounts',clients:'clients',routes:'routes',permits:'documents',settings:'settings'})[c],warning:'Review before saving. Financial entries record platform data; no bank transfer is performed.'};
 const check=(c,r)=>p.checks.push({collection:c,id:r?.id,hash:P.snapshot(r||s[c]||[])});
 if(op==='payment'){
  const i=P.resolve(s,'invoices',req.target);check('invoices',i);check('payments');
  const amount=Number(v.amount),paid=Math.max(Number(i.paidAmount||0),(s.payments||[]).filter(p=>p.invoiceId===i.id).reduce((n,p)=>n+Number(p.amount||0),0));
  if(!iso(v.date)||!Number.isFinite(amount)||amount<=0||amount>Number(i.amount)-paid+.005)fail('Use a valid receipt date and an amount within the invoice outstanding balance.');
  p.values={invoiceId:i.id,date:v.date,amount,method:String(v.method||'Recorded receipt').slice(0,80),reference:String(v.reference||'').slice(0,120)};p.description='Record received payment on '+i.number;
 }else if(op==='payroll_profile'){
  const c=(s.employees||[]).length?'employees':'drivers',employee=P.resolve(s,c,req.target);check(c,employee);check('payProfiles');
  const fields=['baseSalary','tripRatePerKm','payeDefault','sscDefault','overtimeRate','standardDays','otherDeductionDefault','taxNumber','autoGenerate'];
  if(!Object.keys(v).length||Object.keys(v).some(k=>!fields.includes(k)))fail('Unsupported payroll profile field.');
  p.values={};for(const [k,x] of Object.entries(v)){if(k==='taxNumber')p.values[k]=String(x).slice(0,80);else if(k==='autoGenerate'){if(typeof x!=='boolean')fail('Use true/false for autoGenerate');p.values[k]=x;}else{if(!Number.isFinite(Number(x))||Number(x)<0||k==='standardDays'&&Number(x)<=0)fail('Invalid '+k);p.values[k]=Number(x);}}
  p.employeeId=employee.id;p.description='Update payroll profile for '+employee.name;p.warning='Changes future payroll calculations only. Existing approved and paid payslips remain unchanged.';
 }else if(op==='payroll'){
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v.period||''))fail('Specify payroll period YYYY-MM.');
  for(const c of ['employees','drivers','payProfiles','payroll','loans','trips','advances','settings'])check(c);
  p.values={period:v.period};p.description='Generate payroll drafts for '+v.period;p.warning='Uses existing payroll calculation. Approved/paid payslips stay protected. Review drafts before payroll approval.';
 }else if(op==='overhead'){
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v.period||'')||!(Number(v.amount)>0)||!Number.isFinite(Number(v.amount))||!v.category||!v.description)fail('Include overhead period YYYY-MM, category, description and amount.');
  p.values={period:v.period,startPeriod:v.period,category:String(v.category).slice(0,80),description:String(v.description).slice(0,250),amount:Number(v.amount),recurring:v.recurring===true,truckId:v.truck?P.resolve(s,'trucks',v.truck).id:''};p.description='Record overhead: '+p.values.description;
 }else if(op==='settings'){
  if(!Object.keys(v).length||Object.keys(v).some(k=>!settings.includes(k)))fail('Unsupported operational setting.');
  for(const [k,x] of Object.entries(v)){const n=Number(x);if(!Number.isFinite(n)||n<0||(['vat'].includes(k)&&n>100)||(k==='targetKml'&&n<=0))fail('Invalid '+k);p.values[k]=n;}check('settings');p.description='Update operational settings';
 }else{
  let row=op==='master_create'?null:P.resolve(s,c,req.target);if(row){check(c,row);p.entityId=row.id;}
  if(op==='master_archive'){
   if(['trucks','employees'].includes(c)&&(s.trips||[]).some(t=>(c==='trucks'?t.truckId===row.id:t.driverId===row.id)&&Number(t.stage||1)<5&&!/cancelled/i.test(t.status||'')))fail('Resolve open trips before archiving this truck/employee.');
   if(c==='employees'&&(s.loans||[]).some(l=>l.employeeId===row.id&&Number(l.balance)>0))fail('Resolve the employee outstanding loan first.');
   p.values={};p.description='Archive '+c+' '+(row.name||row.fleetName||row.reference||row.id);
  }else{
   if(!Object.keys(v).length||Object.keys(v).some(k=>!masterFields[c].includes(k)))fail('Unsupported master record field.');
   p.values={};for(const [k,x] of Object.entries(v)){
    if(['odometer','serviceDue','distance','namibiaKm','rate','terms'].includes(k)){if(!Number.isFinite(Number(x))||Number(x)<0)fail('Invalid '+k);p.values[k]=Number(x);}
    else if(['crossBorder','roundTrip'].includes(k)){if(typeof x!=='boolean')fail('Use true/false for '+k);p.values[k]=x;}
    else{p.values[k]=String(x??'').trim().slice(0,500);if(/Expiry$|^(issued|expiry)$/.test(k)&&x&&!iso(x))fail('Invalid '+k);}
   }
   const combined={...row,...p.values};
   if(c==='trucks'&&(!combined.fleetName||!combined.registration))fail('Fleet name and registration are required.');
   if(['employees','clients','routes'].includes(c)&&!combined.name)fail('Record name is required.');
   const unique=c==='trucks'?['fleetName','registration']:['employees','clients','routes'].includes(c)?['name']:['reference'];
   for(const k of unique)if(combined[k]&&(s[c]||[]).some(x=>x.id!==row?.id&&key(x[k])===key(combined[k])))fail('Another '+c+' record already uses '+combined[k]);
   if(c==='permits'){
    if(!combined.type||!['truck','driver','trailer','company'].includes(combined.ownerType))fail('Permit type and valid ownerType required.');
    const owner={truck:'trucks',driver:'drivers',trailer:'trailers'}[combined.ownerType];if(owner&&!(s[owner]||[]).some(r=>r.id===combined.ownerId))fail('Permit ownerId must identify an existing owner.');
   }
   if(c==='routes'&&Number(combined.namibiaKm||0)>Number(combined.distance||0))fail('Namibia kilometres cannot exceed distance.');
   check(c);p.description=(row?'Update ':'Create ')+c+' '+(combined.fleetName||combined.name||combined.reference||combined.type);
  }
 }
 p.lines=[['Action',p.description],...Object.entries(p.values).map(([k,v])=>[k,String(v)])];return p;
}
function validate(s,p,role){if(!can(role,p.operation,p.collection))fail('Your role cannot approve this change.',403);for(const c of p.checks){const group=s[c.collection]||[],r=c.id?group.find(r=>r.id===c.id):group;if(!r||P.snapshot(r)!==c.hash)fail('Records changed since preview. Prepare a new job.',409);}}
async function apply(s,p,actor,role,h){validate(s,p,role);const v=p.values,now=new Date().toISOString();let r;
 if(p.operation==='payment'){
  const inv=s.invoices.find(i=>i.id===v.invoiceId),baseline=Math.max(Number(inv.paidAmount||0),(s.payments||[]).filter(p=>p.invoiceId===inv.id).reduce((n,p)=>n+Number(p.amount||0),0));
  r={id:'payment_'+crypto.randomUUID(),...v,createdAt:now,createdBy:actor};s.payments??=[];s.payments.unshift(r);const i=s.invoices.find(i=>i.id===v.invoiceId);i.paidAmount=baseline+v.amount;i.balance=Math.round((i.amount-i.paidAmount)*100)/100;i.status=i.balance<=.005?'Paid':'Part Paid';i.updatedAt=now;
 }else if(p.operation==='payroll_profile'){r=h.profile(s,p.employeeId);Object.assign(r,v,{updatedAt:now,updatedBy:actor});const employee=(s.employees||[]).find(e=>e.id===p.employeeId)||(s.drivers||[]).find(e=>e.id===p.employeeId);if(!h.isDriver(employee,s.drivers||[]))r.tripRatePerKm=0;return{entityId:p.employeeId,recordType:'payroll',page:'payroll'};
 }else if(p.operation==='payroll'){const rows=h.payroll(s,v.period,false);return{entityId:v.period,recordType:'payroll',page:'payroll',count:rows.length};}
 else if(p.operation==='settings'){s.settings={...s.settings,...v};return{page:'settings'};}
 else if(p.operation==='overhead'){r={id:'overhead_'+crypto.randomUUID(),...v,createdAt:now};s.monthlyCosts??=[];s.monthlyCosts.unshift(r);}
 else if(p.operation==='master_archive'){r=s[p.collection].find(r=>r.id===p.entityId);r.status=p.collection==='trucks'?'Out of service':'Inactive';r.active=false;r.updatedAt=now;}
 else if(p.operation==='master_edit'){r=s[p.collection].find(r=>r.id===p.entityId);Object.assign(r,v,{updatedAt:now});}
 else{r={id:p.collection+'_'+crypto.randomUUID(),...v,status:p.collection==='trucks'?'Available':'Active',createdAt:now};s[p.collection]??=[];s[p.collection].unshift(r);}
 if(p.collection==='employees'&&r){
  const d=(s.drivers||[]).find(d=>d.id===r.id);if(d){d.name=r.name;if(r.active===false){d.status='Inactive';d.active=false;}}
  else if(/driver/i.test(r.category||r.jobTitle||'')){s.drivers??=[];s.drivers.push({id:r.id,name:r.name,role:'Driver',status:'Available',phone:r.phone||'',licenseExpiry:r.licenseExpiry||''});}
 }
 if(p.collection==='permits'&&r&&r.ownerType==='truck'){
  const t=(s.trucks||[]).find(t=>t.id===r.ownerId);if(t){if(/roadworthy/i.test(r.type))t.roadworthyExpiry=r.expiry||'';else if(/licen[cs]e/i.test(r.type))t.licenseExpiry=r.expiry||'';}
 }
 if(p.collection==='trucks'&&r)for(const [field,type] of [['licenseExpiry','Vehicle licence'],['roadworthyExpiry','Roadworthy']])if(p.values[field]!==undefined){s.permits??=[];let permit=s.permits.find(x=>x.ownerType==='truck'&&x.ownerId===r.id&&(field==='licenseExpiry'?/licen[cs]e/i.test(x.type):/roadworthy/i.test(x.type)));if(permit)permit.expiry=r[field];else if(r[field])s.permits.unshift({id:'doc_'+crypto.randomUUID(),type,ownerType:'truck',ownerId:r.id,expiry:r[field],status:'Active'});}
 return{entityId:r?.id,recordType:p.collection,page:p.page};
}
function briefing(s,role,now=Date.now()){
 if(!D.office.includes(role))return{answer:'Business checks are available to office staff.',items:[],count:0};
 const groups=D.collect(s,now).filter(g=>D.allowed(g,role));
 const items=groups.flatMap(g=>g.items.map(i=>({title:g.title||g.label||g.key,detail:i.message||i.reason||i.detail||i.title||i.name||'',page:g.page||i.page||'command',id:i.id}))).slice(0,40);
 return{answer:items.length?'Needs attention:\n'+items.slice(0,12).map(i=>i.title+(i.detail?' — '+i.detail:'')).join('\n'):'No outstanding issues were found by the current platform checks.',items,count:items.length,source:'business-checks',page:'command'};
}
function profit(s,q,role){
 if(!financial(role))fail('Financial analysis is restricted to finance/management.',403);
 const period=/\b(20\d{2}-(?:0[1-9]|1[0-2]))\b/.exec(q)?.[1];if(!period)fail('Specify the month as YYYY-MM to compare recorded truck profit.');
 const matches=(s.trucks||[]).filter(t=>[t.fleetName,t.registration].some(v=>v&&key(q).includes(key(v))));if(matches.length!==1)fail('Name one exact truck for the profit comparison.');const truck=matches[0];
 const prev=new Date(period+'-01T12:00:00Z');prev.setUTCMonth(prev.getUTCMonth()-1);const previous=prev.toISOString().slice(0,7);
 const calc=period=>{const trips=(s.trips||[]).filter(t=>t.truckId===truck.id&&String(t.date||'').startsWith(period)),ids=new Set(trips.map(t=>t.id)),fuel=(s.diesel||[]).filter(r=>ids.has(r.tripId)||r.truckId===truck.id&&String(r.date||'').startsWith(period)&&!r.tripId),expenses=(s.expenses||[]).filter(r=>ids.has(r.tripId)||r.truckId===truck.id&&String(r.date||'').startsWith(period)&&!r.tripId),revenue=trips.reduce((n,t)=>n+Number(t.income||0),0),diesel=fuel.reduce((n,r)=>n+Number(r.printedTotal||r.total||Number(r.litres||0)*Number(r.price||0)),0),other=expenses.reduce((n,r)=>n+Number(r.amount||0),0),overhead=(s.monthlyCosts||[]).filter(r=>r.truckId===truck.id&&(r.period===period||r.recurring&&r.startPeriod<=period&&(!r.endPeriod||r.endPeriod>=period))).reduce((n,r)=>n+Number(r.amount||0),0);return{period,trips:trips.length,revenue,diesel,expenses:other,overhead,profit:revenue-diesel-other-overhead};};
 const current=calc(period),prior=calc(previous),rows=[current,prior].map(x=>x.period+': '+x.trips+' trips; revenue N$'+x.revenue.toFixed(2)+'; diesel N$'+x.diesel.toFixed(2)+'; expenses N$'+x.expenses.toFixed(2)+'; allocated overhead N$'+x.overhead.toFixed(2)+'; contribution N$'+x.profit.toFixed(2));
 return{answer:truck.fleetName+' recorded operational comparison:\n'+rows.join('\n')+'\nContribution changed by N$'+(current.profit-prior.profit).toFixed(2)+'. Based on recorded trip income, linked fuel/expenses and allocated overheads; excludes unrecorded costs and shared overheads. This is not cash received or audited net profit.',page:'monthlyPnl',source:'profit-comparison',figures:{current,previous:prior}};
}
module.exports={can,catalog,parse,plan,validate,apply,briefing,profit,masterFields};
