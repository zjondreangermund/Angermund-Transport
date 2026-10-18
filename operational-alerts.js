const {isWorkbookTest}=require('./workbook-test-cleanup');
'use strict';
const done=t=>Number(t.stage)>=4||/delivered|invoiced|closed/i.test(String(t.status||''));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
function collectOperationalAlerts(state,cursor={},users=[],now=Date.now()){
  const first=!cursor.initialized;cursor.initialized=true;cursor.assignments??={};cursor.conditions??={};const events=[],active=new Set();
  const add=(key,condition,alert)=>{if(!condition)return;active.add(key);const record=cursor.conditions[key]||{active:false,episode:0};if(!record.active){record.episode++;events.push({...alert,key:key+':'+record.episode})}record.active=true;cursor.conditions[key]=record};
  const role=(role,linkedType,linkedId)=>({role,linkedType,linkedId});
  const inactive=t=>isWorkbookTest(t)||(t.date&&String(t.date).slice(0,10)<(state.operationalStartDate||'2026-09-20'));
  for(const t of state.trips||[]){
    if(inactive(t))continue;
    const previous=cursor.assignments[t.id],driver=String(t.driverId||'');cursor.assignments[t.id]={driver,sequence:(previous?.sequence||0)+(previous&&previous.driver!==driver?1:0)};
    if(!first&&driver&&!done(t)&&(!previous||previous.driver!==driver))events.push({key:'assign:'+t.id+':'+driver+':'+cursor.assignments[t.id].sequence,title:'Trip assigned: '+t.number,message:'You are assigned to '+t.number+' on '+(t.date||'the planned date')+'. Open Driver Workspace for the load details.',type:'trip-assigned',severity:'info',driverId:driver,linkedType:'trip',linkedId:t.id});
    const legs=t.legs?.length?t.legs:[t],missing=legs.filter(l=>!l.pod&&(done(l)||done(t)));
    const ended=Date.parse(t.arrivedAt||t.deliveredDate||t.completedDate||t.date||'');
    const podDue=missing.length>0&&Number.isFinite(ended)&&now-ended>=60*60*1000;
    const podAlert={title:'POD missing: '+t.number,message:t.number+' has '+missing.length+' delivered load(s) without POD.',type:'missing-pod',severity:'warning',linkedType:'trip',linkedId:t.id};
    add('pod:'+t.id,podDue,{...podAlert,role:'dispatcher'});
    if(driver)add('pod-driver:'+t.id+':'+driver,podDue,{...podAlert,driverId:driver});
    const shunter=t.shunter===true||/shunter/i.test(String(t.tripType||''));
    const fuel=(state.diesel||[]).filter(x=>x.tripId===t.id),litres=fuel.reduce((a,x)=>a+n(x.litres),0),actualKm=n(t.endKm)>n(t.startKm)&&n(t.startKm)>0?n(t.endKm)-n(t.startKm):0;
    const target=n(state.settings?.targetKml)||2,kml=litres>0?actualKm/litres:0;
    add('fuel-use:'+t.id,!shunter&&done(t)&&actualKm>0&&litres>0&&kml<target*.8,{...role('admin','trip',t.id),type:'fuel-consumption',severity:'warning',title:'Fuel consumption needs review: '+t.number,message:t.number+' recorded '+kml.toFixed(2)+' km/L against a '+target.toFixed(2)+' km/L target. Check fuel and odometer entries.'});
    const expenses=(state.expenses||[]).filter(x=>x.tripId===t.id),fuelCost=fuel.reduce((a,x)=>a+(n(x.printedTotal)||n(x.total)||n(x.litres)*n(x.price)),0),cost=fuelCost+expenses.reduce((a,x)=>a+n(x.amount),0)+n(t.allowance)+n(t.other)+(expenses.some(x=>/^toll$/i.test(String(x.category)))?0:n(t.tolls));
    const income=n(t.income),margin=income>0?(income-cost)/income*100:0,minMargin=state.settings?.defaultMargin===undefined?20:n(state.settings.defaultMargin);
    add('profit:'+t.id,!shunter&&done(t)&&income>0&&cost>0&&margin<minMargin,{...role('admin','trip',t.id),type:'low-trip-profit',severity:margin<0?'critical':'warning',title:'Low trip profit: '+t.number,message:t.number+' has a recorded margin of '+margin.toFixed(1)+'%, below the '+minMargin+'% target. Costs may still need reconciliation.'});
  }
  for(const f of state.diesel||[]){
    if(f.tripId){const trip=(state.trips||[]).find(t=>t.id===f.tripId);if(!trip||inactive(trip))continue;}
    const noProof=!(f.receiptUploadId||(f.receiptUploadIds||[]).length),missing=f.receiptMissing===true||/missing|lost|unavailable/i.test(String(f.receiptStatus||f.status||''));
    const t=(state.trips||[]).find(t=>t.id===f.tripId),alert={...role('finance','diesel',f.id),type:'missing-diesel-slip',severity:'warning',title:'Diesel slip missing',message:(t?.number||'Company fuel')+' · '+n(f.litres).toFixed(2)+' L · '+(f.date||'date not recorded')+' · '+(f.supplier||'supplier not recorded')+'. Add the slip when available.'};
    add('slip:'+f.id,noProof&&missing,alert);
    if(f.driverId)add('slip-driver:'+f.id+':'+f.driverId,noProof&&missing,{...alert,role:undefined,driverId:f.driverId});
  }
  for(const p of state.payroll||[]){
    add('pay-review:'+p.id,p.status==='Draft',{...role('finance','payroll',p.id),type:'payslip-review',severity:'info',title:'Payslips ready for review',message:'Payslip records for '+p.period+' are awaiting approval.'});
    const recipients=users.filter(u=>u.active!==false&&(String(u.staffId||u.staff_id||'')===String(p.employeeId)||String(u.driverId||u.driver_id||'')===String(p.employeeId)));
    for(const u of recipients)add('pay-ready:'+p.id+':'+u.id,['Approved','Paid'].includes(p.status),{userId:u.id,linkedType:'payroll',linkedId:p.id,type:'payslip-ready',severity:'info',title:'Your payslip is available',message:'Your payslip for '+p.period+' is ready. Open Payslips to view it.'});
  }
  for(const [key,r] of Object.entries(cursor.conditions))if(!active.has(key))r.active=false;
  return{cursor,events};
}
function groupAlerts(events){
  const groups=new Map();for(const event of events){const target=event.userId?'user:'+event.userId:event.driverId?'driver:'+event.driverId:'role:'+event.role;if(!groups.has(target))groups.set(target,[]);groups.get(target).push(event)}
  return [...groups.values()].map(items=>{
    const first=items[0];if(items.length===1)return{...first,eventKeys:items.map(x=>x.key)};
    const counts={};for(const e of items)counts[e.type]=(counts[e.type]||0)+1;
    return{userId:first.userId,driverId:first.driverId,role:first.role,type:'operations-summary',severity:items.some(x=>x.severity==='critical')?'critical':'warning',title:items.length+' new operations updates',message:Object.entries(counts).map(([k,v])=>v+' '+k.replace(/-/g,' ')).join('; ')+'. '+items.slice(0,3).map(x=>x.title).join(' · ')+(items.length>3?' · Open Alerts & Notifications for the affected records.':''),linkedType:'alerts',linkedId:'',eventKeys:items.map(x=>x.key),items};
  });
}
function expandOfficeRecipients(events,users){
  return events.flatMap(e=>{
    if(!e.role||e.userId||e.driverId)return[e];
    const recipients=users.filter(u=>u.active!==false&&(u.role===e.role||u.role==='admin'));
    return recipients.length?recipients.map(u=>({...e,userId:u.id,key:e.key+':user:'+u.id})):[e];
  });
}
module.exports={collectOperationalAlerts,groupAlerts,expandOfficeRecipients};
