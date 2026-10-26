'use strict';
// Plans contain data only. The server owns permissions, resolution and execution.
const crypto=require('node:crypto');
const TruckTrip=require('./assistant-trip-resolver');
const TripSearch=require('./trip-search');
const Records=require('./record-management');
const Diesel=require('./manual-diesel');
const Costing=require('./public/quote-costing');
const {iso}=require('./assistant-extra-actions');
const key=v=>String(v||'').trim().toLowerCase();
const fail=(m,status=400)=>{const e=Error(m);e.status=status;throw e};
const pages={quotes:'rates',invoices:'invoices',diesel:'diesel',expenses:'roadCharges',maintenance:'workshop',monthlyCosts:'monthlyPnl',trips:'trips',loans:'loans',payroll:'payroll',tyres:'tyres',inspections:'inspections',incidents:'incidents',payments:'invoices',tripIssues:'trips',advances:'advances',shunterRecons:'shunterRecon'};
const singular={quote:'quotes',quotation:'quotes',invoice:'invoices',diesel:'diesel',fuel:'diesel',expense:'expenses',part:'expenses',maintenance:'maintenance',trip:'trips',loan:'loans',payroll:'payroll',tyre:'tyres',inspection:'inspections',incident:'incidents',payment:'payments',overhead:'monthlyCosts'};
const finance=['admin','manager','finance'],office=['admin','manager','dispatcher','finance'];
function can(role,op,collection){
 if(op==='delete'||op==='edit')return Records.allowed(collection,role)&&!(collection==='invoices'&&!finance.includes(role));
 if(op==='invoice'||op==='nbl_invoice'||op==='shunter_invoice')return finance.includes(role);
 if(op==='quote')return office.includes(role);
 if(op==='trip')return ['admin','manager','dispatcher'].includes(role);
 if(op==='maintenance')return ['admin','manager','workshop'].includes(role);
 if(['expense','diesel','pod','receipt_assign'].includes(op))return office.includes(role);
 return false;
}
function catalog(role){
 return [
 ['trip','trips','Create a planned trip with named route, client, truck, driver, date and income.'],
 ['maintenance','maintenance','Create an open workshop work order against a named truck with date, type, supplier, cost and notes.'],
 ['quote','quotes','Create saved quotations using the existing per-km costing engine; client, route, selling amount excl VAT, actual and Namibia km required; saved defaults are shown for review.'],
 ['invoice','invoices','Invoice one delivered, unbilled journey leg, using existing POD, MDC and VAT rules.'],
 ['nbl_invoice','invoices','Generate NBL consolidated invoice for explicit cycleMonth YYYY-MM or periodStart and periodEnd.'],
 ['shunter_invoice','invoices','Generate NBL shunter invoice for explicit period YYYY-MM.'],
 ['expense','expenses','Capture parts, repairs, tolls, parking and other purchases against a truck or trip; amounts remain in Review. Attach a slip in chat.'],
 ['diesel','diesel','Capture diesel litres, total or price, date, odometer, supplier against a truck/trip, optionally with a slip.'],
 ['pod','trips','Attach a real POD file to a named trip and explicit leg if multiple loads; never confirms depot arrival.'],
 ['receipt_assign','expenses','Move a posted expense/diesel slip to an explicitly named truck or trip using its receipt/slip reference.'],
 ...Object.keys(pages).flatMap(c=>[['edit',c,'Edit supported fields on one exact reference or ID.'],['delete',c,'Delete one exact reference or ID, archiving history and enforcing existing dependency/payment checks.']])
 ].filter(([o,c])=>can(role,o,c)&&(o!=='edit'||Records.schema[c]||['invoices','trips'].includes(c))).map(([operation,collection,description])=>({operation,collection,page:pages[collection],description}));
}
function resolve(state,collection,text){
 if(collection==='trips')return TruckTrip.resolve(state,text);
 const rows=state[collection]||[],s=key(text);
 if(!s)fail('Specify the exact '+collection+' reference or record ID.');
 const matches=rows.filter(r=>[r.id,r.number,r.slip,r.receiptNo,r.reference,r.fleetName,r.registration,r.name,r.serial].some(v=>v&&(key(v)===s||(collection==='trucks'&&(key(v).replace(/[^a-z0-9]/g,'')===s.replace(/[^a-z0-9]/g,'')||/^\d+$/.test(s)&&/^ang[\s-]*\d+$/i.test(String(v))&&Number(String(v).match(/\d+/)[0])===Number(s))))));
 if(matches.length!==1)fail(matches.length?'More than one record matches '+text+'. Use its exact record ID.':'No '+collection+' record matches '+text+'. Use the exact saved reference or record ID.');
 return matches[0];
}
function snapshot(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex')}
function safeValues(v){if(!v||typeof v!=='object'||Array.isArray(v))return{};return Object.fromEntries(Object.entries(v).filter(([k])=>!['__proto__','prototype','constructor'].includes(k)))}
function positive(n,label){n=Number(n);if(!Number.isFinite(n)||n<=0)fail('Enter '+label+' greater than zero.');return n}
function date(v){if(!iso(String(v||'')))fail('Include a valid date (YYYY-MM-DD).');return String(v)}
function linked(s,v){
 let t=v.trip?resolve(s,'trips',v.trip):null;
 const truck=v.truck?resolve(s,'trucks',v.truck):null;
 if(t&&truck&&t.truckId!==truck.id)fail('The specified truck is not assigned to that trip.');
 if(!t&&!truck)fail('Specify a truck such as ANG 12, or an exact trip number.');
 return{tripId:t?.id||'',truckId:t?.truckId||truck.id,driverId:t?.driverId||'',...(t?{trip:t}:{})};
}
function parse(text){
 const q=String(text||'').trim();let m;
 if(m=/^(?:delete|remove)\s+(quotation|quote|invoice|diesel|fuel|expense|maintenance|trip|loan|payroll|tyre|inspection|incident|payment|overhead)\s+(.+)$/i.exec(q))return{operation:'delete',collection:singular[key(m[1])],target:m[2].trim(),values:{}};
 if(m=/^(?:edit|change|set|update)\s+(quotation|quote|invoice|diesel|fuel|expense|maintenance|trip|tyre|inspection|incident|payment|overhead)\s+(.+?)\s+(date|due|notes|supplier|litres|total|amount|odometer|reference|number|description|cost|load|tons|pallets|distance|namibiaKm|agreedAmount)\s+(?:to\s+)?(.+)$/i.exec(q))return key(m[1])==='trip'&&key(m[3])==='number'?null:{operation:'edit',collection:singular[key(m[1])],target:m[2],values:{[key(m[3])]:m[4]}};
 if(m=/^invoice\s+(?:for\s+)?(?:truck\s+)?(ANG[\s-]*\d+)(?:\s+leg\s+(\d+))?$/i.exec(q))return{operation:'invoice',collection:'invoices',target:m[1],values:{leg:m[2]||''}};
 if(m=/^(?:create|generate|make)\s+(?:an?\s+)?invoice\s+(?:for\s+)?(?:trip|truck)\s+(.+?)(?:\s+leg\s+(\S+))?$/i.exec(q))return{operation:'invoice',collection:'invoices',target:m[1],values:{leg:m[2]||''}};
 if(m=/^(?:create|generate|make)\s+NBL\s+(consolidated|shunter)\s+invoice\s+(?:for\s+)?(20\d{2}-\d{2})$/i.exec(q))return{operation:m[1].toLowerCase()==='shunter'?'shunter_invoice':'nbl_invoice',collection:'invoices',values:{period:m[2],cycleMonth:m[2]}};
 if(m=/^(?:assign|move|link)\s+(?:slip|receipt)\s+(\S+)\s+to\s+(truck|trip)\s+(.+)$/i.exec(q))return{operation:'receipt_assign',collection:'expenses',target:m[1],values:{[key(m[2])]:m[3]}};
 const target=/\b(truck|trip)\s+([A-Za-z0-9][A-Za-z0-9 ._/-]*?)(?=\s+(?:on|date|for|from|supplier|odometer|total|litres|at|slip|leg)\b|[,;]|$)/i.exec(q);
 const values={};if(target)values[key(target[1])]=target[2].trim();
 const fleet=/\btruck\s+(ANG[ -]*\d+)\b/i.exec(q);if(fleet)values.truck=fleet[1];
 const d=/\b(20\d{2}-\d{2}-\d{2})\b/.exec(q);if(d)values.date=d[1];
 const a=/(?:N\s*\$|NAD\s*|R\s*)([\d,]+(?:\.\d{1,2})?)/i.exec(q);if(a)values.amount=Number(a[1].replace(/,/g,''));
 const od=/\bodometer\s+(\d+)/i.exec(q);if(od)values.odometer=Number(od[1]);
 const supplier=/\b(?:from|supplier)\s+"([^"]+)"/i.exec(q);if(supplier)values.supplier=supplier[1];
 if(/\b(?:create|generate|make)\b/i.test(q)&&/\b(?:quote|quotation|tender)\b/i.test(q)){
  return{operation:'quote',collection:'quotes',values:{...values,client:/\bclient\s+"([^"]+)"/i.exec(q)?.[1],route:/\broute\s+"([^"]+)"/i.exec(q)?.[1]}};
 }
 if(/\b(?:attach|upload|link|assign|add)\b/i.test(q)&&/\bPOD\b/i.test(q))return{operation:'pod',collection:'trips',target:values.trip||values.truck,values:{...values,leg:/\bleg\s+(\S+)/i.exec(q)?.[1]||''}};
 if(/\b(?:record|capture|add|bought|filled)\b/i.test(q)&&/\b(?:diesel|disel|fuel)\b/i.test(q)){
  values.litres=Number(/\b(\d+(?:\.\d+)?)\s*(?:L\b|litres?\b|liters?\b)/i.exec(q)?.[1]||0);if(values.litres===0)delete values.litres;values.total=values.amount;delete values.amount;if(values.total===undefined)delete values.total;
  values.slip=/\bslip\s+(\S+)/i.exec(q)?.[1]||'';
  return{operation:'diesel',collection:'diesel',values};
 }
 if(/\b(?:record|capture|add|bought|purchased)\b/i.test(q)&&/\b(?:part|parts|repair|repairs|expense|toll|parking|tyre|tyres)\b/i.test(q)){
  values.category=/\bparts?\b/i.test(q)?'Parts':/\brepairs?\b/i.test(q)?'Repairs':/\btyres?\b/i.test(q)?'Tyres':/\btolls?\b/i.test(q)?'Toll':/\bparking\b/i.test(q)?'Parking':'Other';values.notes=q;
  return{operation:'expense',collection:'expenses',values};
 }
 return null;
}
function plan(request,s,role,attachment=false){
 if(!request)return null;
 const op=request.operation,c=request.collection||({quote:'quotes',invoice:'invoices',nbl_invoice:'invoices',shunter_invoice:'invoices',trip:'trips',maintenance:'maintenance',pod:'trips',diesel:'diesel',expense:'expenses',receipt_assign:'expenses'}[op]);
 const canonical={quote:'quotes',invoice:'invoices',nbl_invoice:'invoices',shunter_invoice:'invoices',trip:'trips',maintenance:'maintenance',pod:'trips',diesel:'diesel',expense:'expenses'}[op];
 if(canonical&&c!==canonical)fail('Unsupported record type for '+op+'.');
 if(!can(role,op,c))fail('Your account cannot perform this operation.',403);
 const v=safeValues(request.values);
 const fields={trip:['route','client','truck','driver','date','income','load','tons','pallets','startKm'],maintenance:['truck','date','type','supplier','cost','odometer','notes'],expense:['trip','truck','date','amount','category','supplier','receiptNo','notes'],diesel:['trip','truck','date','litres','total','price','odometer','supplier','slip','receiptNo','notes'],pod:['trip','truck','date','leg'],receipt_assign:['trip','truck'],invoice:['trip','truck','date','leg'],nbl_invoice:['cycleMonth','period','periodStart','periodEnd'],shunter_invoice:['period','cycleMonth'],quote:['route','client','date','amount','actualKm','namibiaKm','tenderKm','load','costInputs']};
 if(fields[op]&&Object.keys(v).some(k=>!fields[op].includes(k)))fail('Unsupported input for '+op+'.');
 const p={kind:'platform',operation:op,collection:c,actorRole:role,page:pages[c],values:v,checks:[],old:'No record',next:'New record',warning:'Review all details before saving. Nothing is saved until approval.'};
 const check=(collection,row)=>{p.checks.push({collection,id:row.id,hash:snapshot(row)});return row};
 const link=()=>{const ctx=linked(s,v);if(ctx.trip)check('trips',ctx.trip);check('trucks',resolve(s,'trucks',ctx.truckId));return ctx};
 if(op==='delete'||op==='edit'){
  const row=check(c,resolve(s,c,request.target));p.entityId=row.id;p.old=row.number||row.slip||row.reference||row.id;
  if(op==='edit'){
   const permitted=c==='invoices'?['number','date','due','reference','notes','amount']:c==='quotes'?['number','date','status','notes','amount']:c==='trips'?['date','plannedDropDate','load','tons','pallets','distance','namibiaKm','agreedAmount','sourceOrderRef','legId']:Records.schema[c]||[];
   // Status and relationship changes have dedicated workflows; no arbitrary approval/payment edits.
   const blocked=['status','tripId','truckId','driverId','mdcKm','mdcRatePer100km'];
   if(!Object.keys(v).length||Object.keys(v).some(k=>!permitted.includes(k)||blocked.includes(k)))fail('Unsupported field. Edit dates, notes, references or amounts; use dedicated commands for assignments and workflow status.');
   if(c==='trips'&&(row.legs||[]).length>1&&!v.legId)fail('Specify the exact legId when editing a multi-load trip.');
   if(c==='quotes'&&v.number&&(s.quotes||[]).some(q=>q.id!==row.id&&key(q.number)===key(v.number)))fail('Quotation number already exists.');
   p.next=JSON.stringify(v);
  }else{if(Object.keys(v).length)fail('Delete requires only a record reference.');p.next='Deleted (history retained)';p.warning='Deletes this record after approval. Existing linked invoice, payment and dependency checks still apply.'}
  p.description=(op==='delete'?'Delete ':'Edit ')+c+' '+p.old;
 }else if(op==='trip'){
  const route=check('routes',resolve(s,'routes',v.route)),client=check('clients',resolve(s,'clients',v.client)),truck=check('trucks',resolve(s,'trucks',v.truck)),driver=check('drivers',resolve(s,'drivers',v.driver));
  if(['Inactive','Archived','Terminated'].includes(driver.status))fail('Driver is not active.');
  if((s.trips||[]).some(t=>(t.truckId===truck.id||t.driverId===driver.id)&&Number(t.stage||1)<5&&!/cancelled/i.test(t.status||'')))fail('Truck or driver already has an open trip. Resolve the assignment first.');
  p.values={date:date(v.date),routeId:route.id,clientId:client.id,truckId:truck.id,driverId:driver.id,income:positive(v.income,'trip income'),load:String(v.load||''),tons:Number(v.tons||0),pallets:Number(v.pallets||0),startKm:Number(v.startKm||0),status:'Planned'};
  for(const n of ['tons','pallets','startKm'])if(!Number.isFinite(p.values[n])||p.values[n]<0)fail('Invalid '+n);
  p.description='Create planned trip: '+truck.fleetName+' · '+route.name+' · '+driver.name;
 }else if(op==='maintenance'){
  const truck=check('trucks',resolve(s,'trucks',v.truck));
  if(!String(v.type||'').trim())fail('Specify the work order type, such as Service or Repairs.');
  p.values={truckId:truck.id,date:date(v.date),type:String(v.type).slice(0,80),supplier:String(v.supplier||'').slice(0,160),cost:Number(v.cost||0),odometer:Number(v.odometer||0),notes:String(v.notes||'').slice(0,1000)};
  if(!Number.isFinite(p.values.cost)||p.values.cost<0||!Number.isFinite(p.values.odometer)||p.values.odometer<0)fail('Invalid workshop cost or odometer.');
  p.description='Create workshop work order for '+truck.fleetName;
 }else if(op==='expense'||op==='diesel'){
  const ctx=link();p.values={...v,tripId:ctx.tripId,truckId:ctx.truckId,driverId:ctx.driverId,date:date(v.date)};
  if(op==='expense'){p.values.amount=positive(v.amount,'purchase amount');p.values.category=String(v.category||'Other').slice(0,80);}
  else{p.values.litres=positive(v.litres,'diesel litres');if(!(Number(v.total)>0||Number(v.price)>0))fail('Include diesel total paid or price per litre.');}
  if(p.values.receiptNo&&(s.expenses||[]).some(r=>key(r.receiptNo)===key(p.values.receiptNo)&&key(r.supplier)===key(p.values.supplier)))fail('That supplier receipt number is already recorded.');
  if(op==='diesel'&&v.slip&&(s.diesel||[]).some(r=>key(r.slip)===key(v.slip)&&r.truckId===ctx.truckId))fail('That diesel slip is already recorded for this truck.');
  p.description='Record '+(op==='diesel'?'diesel':p.values.category+' purchase')+' for '+(v.trip||v.truck);
  p.warning='Captured as '+(attachment?'Review with attached slip.':'Receipt missing; attach proof later.')+' This does not approve spending or make a payment.';
 }else if(op==='pod'){
  if(!attachment)fail('Attach the POD photo or PDF in chat.');
  const t=check('trips',TruckTrip.resolve(s,(request.target||v.trip||v.truck||'')+(v.date?' on '+v.date:''),'pod'));p.tripId=t.id;
  const ls=t.legs||[];const l=v.leg?ls.find(l=>[l.id,String(l.sequence),l.label].some(x=>key(x)===key(v.leg))):ls.length===1?ls[0]:null;
  if(ls.length>1&&!l)fail('This trip has multiple loads. Include leg number or exact leg ID.');
  if(t.pod&&!ls.length||l?.pod)fail('POD already recorded. Use the trip document editor to replace it.');
  p.values={legId:l?.id||''};p.description='Attach POD to '+((s.trucks||[]).find(x=>x.id===t.truckId)?.fleetName||t.number)+' · '+(t.date||'')+(l?' · '+l.label:'');p.warning='Records delivery evidence. Trip completion still requires arrival at Angermund depot.';
 }else if(op==='receipt_assign'){
  const matches=['diesel','expenses'].flatMap(c=>(s[c]||[]).filter(r=>[r.id,r.slip,r.receiptNo].some(x=>x&&key(x)===key(request.target))).map(row=>({c,row})));
  if(matches.length!==1)fail('Specify one exact posted slip/receipt number or record ID.');
  const {c:source,row}=matches[0];if(!row.receiptUploadId&&!row.receiptUploadIds?.length)fail('This record has no attached slip to assign.');
  if(row.mdc)fail('Use the MDC workflow for this receipt.');
  check(source,row);const ctx=link();if(ctx.trip?.legs?.length>1)fail('Select the exact destination load in the slip editor for a multi-load trip.');p.collection=source;p.entityId=row.id;p.values={tripId:ctx.tripId,truckId:ctx.truckId,driverId:ctx.driverId};p.description='Assign '+(row.slip||row.receiptNo||row.id)+' to '+(v.trip||v.truck);p.old=row.tripId||row.truckId;p.next=v.trip||v.truck;
 }else if(op==='invoice'){
  const t=check('trips',TruckTrip.resolve(s,(request.target||v.trip||v.truck||'')+(v.date?' on '+v.date:''),'invoice'));const ls=t.legs||[];
  const l=v.leg?ls.find(l=>[l.id,String(l.sequence),l.label].some(x=>key(x)===key(v.leg))):ls.length===1?ls[0]:null;
  if(ls.length>1&&!l)fail('Specify the journey leg number for this multi-load trip.');
  p.tripId=t.id;p.values={legId:l?.id||''};p.description='Generate invoice for '+((s.trucks||[]).find(x=>x.id===t.truckId)?.fleetName||t.number)+' · '+(t.date||'')+(l?' · '+l.label:'');
 }else if(op==='nbl_invoice'||op==='shunter_invoice'){
  if(op==='shunter_invoice'&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v.period||''))fail('Specify shunter billing period YYYY-MM.');
  if(op==='nbl_invoice'&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v.cycleMonth||'')){date(v.periodStart);date(v.periodEnd);if(v.periodStart>v.periodEnd)fail('Invalid billing range.');}
  // Consolidations depend on all eligible trips, receipts and existing invoices.
  for(const collection of ['trips','invoices','expenses','shunterRecons','clients'])p.checks.push({collection,hash:snapshot(s[collection]||[])});
  p.description='Generate '+(op==='shunter_invoice'?'NBL shunter':'NBL consolidated')+' invoice';
 }else if(op==='quote'){
  const route=check('routes',resolve(s,'routes',v.route)),client=check('clients',resolve(s,'clients',v.client));
  const actualKm=positive(v.actualKm??route.distance,'actual kilometres'),na=Number(v.namibiaKm??(route.crossBorder?route.namibiaKm:actualKm));
  if(!Number.isFinite(na)||na<0||na>actualKm)fail('Specify valid Namibia kilometres, no greater than actual km.');
  const defaults=s.settings?.quoteCostDefaults;if(!defaults)fail('Save your quotation costing defaults in Rates & Quotations first, so I use your operating costs.');
  p.checks.push({collection:'settings',hash:snapshot(s.settings)});
  const inputs={...defaults,...safeValues(v.costInputs)};
  const allowedInputs=['kml','dieselNA','dieselForeign','driverRate','mdcRate','maintenanceRate','tyreRate','insuranceRate','ownershipRate','days','foodRate','tolls','waitingDays','standingRate','other','margin','minimum','rounding','vatRate','terms'];
  if(Object.keys(inputs).some(k=>!allowedInputs.includes(k)))fail('Unknown quotation cost input.');
  const amount=positive(v.amount,'selling price excluding VAT');date(v.date);
  const leg={id:'qleg_'+crypto.randomUUID(),sequence:1,routeId:route.id,routeName:route.name,clientId:client.id,clientName:client.name,actualKm,namibiaKm:na,tenderKm:Number(v.tenderKm??actualKm),distanceBasis:'Explicit total',amount,quotedAmount:amount,pricingMethod:'Manual negotiated',manualAmount:amount,load:String(v.load||''),empty:false};
  const costing=Costing.calculate([leg],inputs);
  p.values={date:v.date,legs:[leg],costInputs:inputs,costing};p.description='Create quotation for '+client.name+' · '+route.name;
  p.warning='Draft estimate. Distance is the explicit journey total; include empty travel. Review fuel, border costs, margin and VAT before sending.';
 }else fail('Unsupported operation.');
 const labels={tripId:'Trip',truckId:'Truck',driverId:'Driver',routeId:'Route',clientId:'Client',legId:'Load',date:'Date',amount:'Amount',litres:'Litres',total:'Total paid',price:'Price per litre',odometer:'Odometer',receiptNo:'Slip reference',slip:'Slip reference',supplier:'Supplier',category:'Category',notes:'Notes',income:'Income excl VAT',tons:'Tons',pallets:'Pallets',startKm:'Start odometer',status:'Status',type:'Work type',cost:'Cost',period:'Billing month',cycleMonth:'Billing cycle',periodStart:'Billing start',periodEnd:'Billing end'};
 const display=(k,val)=>{const collection={tripId:'trips',truckId:'trucks',driverId:'drivers',routeId:'routes',clientId:'clients'}[k];if(!collection)return String(val);const r=(s[collection]||[]).find(x=>x.id===val);return r?.number||r?.fleetName||r?.name||'Not assigned'};
 p.lines=[['Action',p.description],...(p.entityId?[['Record',p.old],['After',p.next]]:[]),...Object.entries(p.values).filter(([k,val])=>typeof val!=='object'&&val!==undefined&&val!=='').map(([k,val])=>[labels[k]||k,display(k,val)]),...(p.values.costing?[['Operating cost',p.values.costing.totalCost.toFixed(2)],['Selling price excl VAT',p.values.costing.quotedIncome.toFixed(2)],['Recommended',p.values.costing.recommended.toFixed(2)],['Cost assumptions',JSON.stringify(p.values.costInputs)]]:[])];
 return p;
}
function validate(s,p,role){
 if(!can(role,p.operation,p.collection))fail('Your role cannot perform this action.',403);
 for(const c of p.checks||[]){const group=s[c.collection]||[],row=c.id?group.find(r=>r.id===c.id):group;if(!row||snapshot(row)!==c.hash)fail('Records changed after preview. Ask again for a fresh draft.',409);}
}
async function apply(s,p,actor,role,h={},document=null){
 validate(s,p,role);const v=p.values;let row,result={},tripIds=[];
 const now=new Date().toISOString();
 if(p.operation==='delete'){const out=Records.deleteRecord(s,p.collection,p.entityId,actor);tripIds=[out.tripId];result={deleted:true,entityId:p.entityId};}
 else if(p.operation==='edit'){
  if(p.collection==='trips'){row=s.trips.find(r=>r.id===p.entityId);h.editLoad(s,row,v);result.tripId=row.id;}
  else if(p.collection==='invoices'){row=s.invoices.find(r=>r.id===p.entityId);h.editInvoice(s,row,v);}
  else if(p.collection==='quotes'&&v.amount!==undefined){
   row=s.quotes.find(r=>r.id===p.entityId);if(row.legs?.length!==1||!row.costInputs)fail('Revise this multi-leg or legacy quotation in Rates & Quotations.');
   const amount=positive(v.amount,'quotation amount'),before=structuredClone(row),leg=row.legs[0];
   leg.amount=amount;leg.quotedAmount=amount;leg.manualAmount=amount;leg.pricingMethod='Manual negotiated';
   const x=Costing.calculate([{...leg,amount}],row.costInputs);Object.assign(row,{costing:x,quotedIncome:x.quotedIncome,expectedProfit:x.profit,vatAmount:x.vat,totalInclVat:x.total,updatedAt:now});
   const rest={...v};delete rest.amount;if(Object.keys(rest).length)Records.editRecord(s,p.collection,row.id,rest,actor);
   s.recordHistory??=[];s.recordHistory.unshift({id:crypto.randomUUID(),kind:'quotes',record:before,action:'Edited',actor,at:now});
  }else{const out=Records.editRecord(s,p.collection,p.entityId,v,actor);row=out.record;tripIds=out.tripIds;}
 }else if(p.operation==='trip'){
  if((s.trips||[]).some(t=>(t.truckId===v.truckId||t.driverId===v.driverId)&&Number(t.stage||1)<5&&!/cancelled/i.test(t.status||'')))fail('Truck or driver now has an open trip.',409);
  row=await h.trip(s,v,actor);result.tripId=row.id;
 }else if(p.operation==='maintenance'){
  row={id:'maint_'+crypto.randomUUID(),...v,status:'Open',createdAt:now,createdBy:actor};s.maintenance??=[];s.maintenance.unshift(row);
 }else if(p.operation==='expense'){
  row={id:'expense_'+crypto.randomUUID(),...v,status:document?'Review':'Receipt missing',companyPaid:true,reimbursable:false,createdAt:now,createdBy:actor};s.expenses??=[];s.expenses.unshift(row);tripIds=[v.tripId];
 }else if(p.operation==='diesel'){
  row=Diesel.createManualDiesel(s,{...v,receiptStatus:v.slip?'Reference available':'Slip missing'},'fuel_'+crypto.randomUUID(),actor,now);tripIds=[v.tripId];
 }else if(p.operation==='receipt_assign'){
  row=s[p.collection].find(r=>r.id===p.entityId);tripIds=[row.tripId,v.tripId];Records.editRecord(s,p.collection,row.id,v,actor);row.legId='';
  if(v.tripId){const t=s.trips.find(t=>t.id===v.tripId);if(t.legs?.length===1)row.legId=t.legs[0].id;}
 }else if(p.operation==='quote'){
  const x=v.costing,highest=(s.quotes||[]).reduce((n,q)=>Math.max(n,Number(String(q.number).replace(/^Q-/,''))||0),1000);
  row={id:'quote_'+crypto.randomUUID(),number:'Q-'+(highest+1),date:v.date,legs:v.legs,costInputs:v.costInputs,costing:x,distance:x.distance,namibiaKm:x.namibiaKm,quotedIncome:x.quotedIncome,estimatedCost:x.totalCost,recommendedIncome:x.recommended,expectedProfit:x.profit,companySnapshot:structuredClone(s.company||{}),terms:v.costInputs.terms||'',vatRate:x.vatRate,vatAmount:x.vat,totalInclVat:x.total,status:'Draft',createdAt:now};s.quotes??=[];s.quotes.unshift(row);
 }else if(p.operation==='invoice'){row=h.invoice(s,p.tripId,v.legId).invoice;}
 else if(p.operation==='nbl_invoice'){row=h.nblInvoice(s,v.cycleMonth||'',v).invoice;}
 else if(p.operation==='shunter_invoice'){row=h.shunterInvoice(s,v.period,v).invoice;}
 else if(p.operation==='pod'){if(!document)fail('POD file expired. Attach it again.');result=h.pod(s,p,document,now);}
 else fail('Unsupported operation');
 if(document&&['expense','diesel'].includes(p.operation)){
  Object.assign(row,{receiptUploadId:document.id,receiptUploadIds:[document.id],receiptCount:1,receiptMissing:false,receiptStatus:'Attached',status:'Review',verified:false});
 }
 for(const id of new Set(tripIds.filter(Boolean))){const t=(s.trips||[]).find(t=>t.id===id);if(t)h.recalc(s,t);}
 s.audit??=[];s.audit.unshift({id:'log_'+crypto.randomUUID(),at:now,actor,action:'Assistant-approved: '+p.description,linkedType:p.collection,linkedId:row?.id||p.entityId||p.tripId});s.audit=s.audit.slice(0,200);
 return{...result,entityId:row?.id||p.entityId||p.tripId,recordType:({quotes:'quote',invoices:'invoice',expenses:'expense',trips:'trip'})[p.collection]||p.collection,tripId:result.tripId||p.tripId||'',page:p.page};
}
function read(message,s,role){
 if(TripSearch.isQuery(message))return Records.allowed('trips',role)?TripSearch.reply(s,message):{answer:'Your account cannot view those records.',source:'record-permission'};
 const m=/^(?:show|find|list|search|view)\s+(?:my\s+)?(invoices?|quotations?|quotes?|diesel|expenses?|maintenance|trips?|loans?|payroll|tyres?|inspections?|incidents?|overheads?)(?:\s+(.+?))?[?.!]*$/i.exec(String(message||'').trim());
 const tender=/\b(?:tender|tendering)\b/i.test(message)&&!/\b(?:create|generate|delete|edit|change|make)\b/i.test(message);
 if(!m&&!tender)return null;
 const noun=m?key(m[1]).replace(/s$/,''):'quote',c=singular[noun]||({maintenance:'maintenance',payroll:'payroll',diesel:'diesel'})[noun];
 if(!c||!Records.allowed(c,role))return{answer:'Your account cannot view those records.',page:null,source:'record-permission'};
 const term=key(m?.[2]||'');
 if(c==='trips'&&/\bang[\s-]*\d+\b|\btruck\b/i.test(term)){try{const t=TruckTrip.resolve(s,term),truck=(s.trucks||[]).find(x=>x.id===t.truckId),route=(s.routes||[]).find(x=>x.id===t.routeId);return{answer:[truck?.fleetName,t.date,route?.name||t.load,t.status].filter(Boolean).join(' · '),page:'trips',source:'live-records'}}catch(e){return{answer:e.message,page:'trips',source:'operation-clarification'}}}
 const search=TripSearch.terms(term),related=(k,id)=>(s[k]||[]).find(x=>x.id===id)||{};
 const rows=(s[c]||[]).filter(r=>{
   const t=related('trips',r.tripId),date=String(r.date||r.period||'');
   if(search.date&&!(date.slice(5,7)===search.date.month&&date.slice(8,10)===search.date.day&&(!search.date.year||date.slice(0,4)===search.date.year)))return false;
   const text=key([r.id,r.number,r.slip,r.receiptNo,r.reference,r.supplier,r.status,r.date,r.period,r.description,r.notes,r.category,r.title,t.number,t.load,related('trucks',r.truckId||t.truckId).fleetName,related('drivers',r.driverId||t.driverId).name,related('clients',r.clientId||t.clientId).name,related('routes',t.routeId).name].join(' ')).replace(/\bang[\s-]*0*(\d+)\b/g,'ang$1');
   return search.tokens.every(v=>text.includes(v));
 }).slice(0,12);
 const lines=rows.map(r=>[r.number||r.slip||r.receiptNo||r.id,r.date||r.period,r.status,r.supplier,r.amount!==undefined?'N$ '+r.amount:r.quotedIncome!==undefined?'Quote N$ '+r.quotedIncome:r.litres!==undefined?r.litres+' L':'',r.costing?'Cost N$ '+r.estimatedCost+'; profit N$ '+r.expectedProfit+'; '+r.distance+' actual km':'',r.id].filter(Boolean).join(' · '));
 return{answer:(tender?'Tender pricing uses saved route quotations with diesel, Namibia MDC, driver, maintenance, tyres, overhead and margin breakdowns. Confirm distances, empty travel and costs before submission. Saved quotations:\n':'Current '+c+':\n')+(lines.join('\n')||'No matching records.')+'\nUse an exact reference or ID when requesting a change.',page:pages[c],source:'live-records'};
}
module.exports={read,can,catalog,resolve,parse,plan,validate,apply,snapshot};
