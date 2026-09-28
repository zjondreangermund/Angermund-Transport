const STORE='angermund_transport_ops_v2',LEGACY_STORE='angermund_transport_erp_v1';
const $=id=>document.getElementById(id),today=()=>new Date().toISOString().slice(0,10),uid=(p='id')=>`${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
let authToken=localStorage.getItem('angermund_token')||'',sessionUser=null,liveGps=[],geofences=[],serverNotifications=[],providerConfig={},pushDeviceStatus={supported:false,permission:typeof Notification!=='undefined'?Notification.permission:'unsupported',subscribed:false,serverCount:0},mapInstance=null,mapLayers=[],geofencePickerMap=null,geofencePickerMarker=null,geofencePickerCircle=null,geofenceDraftPoint=null,appUsers=[],usersLoaded=false,driverUploads=[],driverUploadsLoaded=false,activeUploadObjectUrl='',driverPreviewId='',driverGeoWatchId=null,lastDriverGpsSentAt=0,lastDriverGpsPoint=null,payrollPeriodFilter=new Date().toISOString().slice(0,7),mdcTripPrefill='',journeyQuoteLegs=[],crossBorderPackTripId='',crossBorderDocs=[],crossBorderDocsLoadedFor='';
async function api(url,options={}){const headers={...(options.headers||{})};if(authToken)headers.Authorization=`Bearer ${authToken}`;if(options.body&&!(options.body instanceof FormData))headers['Content-Type']='application/json';const res=await fetch(url,{...options,headers,body:options.body&&!(options.body instanceof FormData)&&typeof options.body!=='string'?JSON.stringify(options.body):options.body});const data=await res.json().catch(()=>({}));if(res.status===401){logout();throw Error(data.error||'Session expired')}if(!res.ok)throw Error(data.error||`Request failed (${res.status})`);return data}
function logout(){stopDriverGpsWatch();authToken='';sessionUser=null;localStorage.removeItem('angermund_token');try{sessionStorage.removeItem('driver_gps_session');sessionStorage.removeItem('driver_gps_denied')}catch{};window.location.replace('/login?logout='+Date.now())}
async function syncState(){if(!authToken||role==='driver')return;try{await api('/api/state',{method:'PUT',body:db})}catch(e){notify(`Sync pending: ${e.message}`)}}
const num=v=>Number(v||0),money=v=>`N$ ${num(v).toLocaleString('en-NA',{minimumFractionDigits:2,maximumFractionDigits:2})}`,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const daysUntil=d=>d?Math.ceil((new Date(d+'T23:59:59')-new Date())/86400000):9999;
const base={version:2,supplierCategoryRules:{},settings:{dieselPrice:26.77,vat:15,targetKml:1.5,defaultMargin:20,standingFee:6000,weekendStandingFee:7500,freeStandingHours:4,mdcRatePer100km:73.30,currentDriver:'drv_johannes'},company:{name:'Angermund Transport CC',registration:'CC/2006/0146',vat:'4118289-015',email:'angermundtransport@iway.na',phone:'+264 81 129 9942',address:'Erf 10494 Bernabe De La Bat Street, Katutura, Windhoek',postal:'P.O. Box 2253, Windhoek'},
trucks:[{id:'trk_134',registration:'N 134 WH',make:'Scania',type:'Truck',status:'Available',odometer:645200,serviceDue:650000,licenseExpiry:'2026-12-15',roadworthyExpiry:'2026-11-20',gps:'Online'},{id:'trk_127',registration:'N 127 WH',make:'MAN',type:'Truck',status:'On trip',odometer:511700,serviceDue:520000,licenseExpiry:'2027-02-10',roadworthyExpiry:'2027-01-15',gps:'Online'},{id:'trk_nbl1',registration:'NBL SHUNTER 1',make:'Scania',type:'Shunter',status:'On duty',odometer:184200,serviceDue:190000,licenseExpiry:'2026-11-30',roadworthyExpiry:'2026-10-28',gps:'Online'},{id:'trk_nbl2',registration:'NBL SHUNTER 2',make:'MAN',type:'Shunter',status:'Available',odometer:162900,serviceDue:170000,licenseExpiry:'2027-03-18',roadworthyExpiry:'2027-02-04',gps:'Online'}],
trailers:[{id:'trl_flat1',registration:'Flat Deck 1',type:'Flat deck',status:'Available'},{id:'trl_taut1',registration:'Tautliner 1',type:'Tautliner',status:'Assigned'}],
drivers:[{id:'drv_johannes',name:'Johannes',phone:'',license:'CE',prdpExpiry:'2027-02-15',passportExpiry:'2028-06-01',status:'On trip',role:'Driver',score:92},{id:'drv_peter',name:'Peter',phone:'',license:'CE',prdpExpiry:'2026-11-12',passportExpiry:'2027-08-22',status:'Available',role:'Driver',score:86},{id:'drv_silverius',name:'Silverius Raymond Angermund',phone:'+264 81 451 4545',license:'CE',prdpExpiry:'2027-05-10',passportExpiry:'2028-01-14',status:'Available',role:'Driver / Mechanic',score:95}],
clients:[{id:'cli_nbl',name:'Namibian Breweries Limited',terms:30,contact:'NBL Operations',email:'',status:'Active'},{id:'cli_rf',name:'R&F Logistics',terms:30,contact:'',email:'',status:'Active'},{id:'cli_la',name:'LA Transport',terms:30,contact:'',email:'',status:'Active'}],
routes:[{id:'rte_durban',name:'Durban → Windhoek',distance:1900,rate:66000,crossBorder:true,notes:'Furniture / general cargo'},{id:'rte_oshakati',name:'Windhoek ↔ Oshakati',distance:1420,rate:52000,crossBorder:false,notes:'710 km each way; 36 pallets beer / empty returns'},{id:'rte_walvis',name:'Windhoek → Walvis Bay',distance:395,rate:16800,crossBorder:false,notes:'General cargo'},{id:'rte_maltahohe',name:'Windhoek ↔ Maltahöhe',distance:420,rate:17500,crossBorder:false,notes:'Beer / return load'},{id:'rte_rehoboth',name:'Windhoek → Rehoboth (Lowbed)',distance:90,rate:25000,crossBorder:false,notes:'Grader transport, excl. VAT/permits/escorts'},{id:'rte_shunter',name:'Windhoek Local Shunter',distance:0,rate:0,crossBorder:false,notes:'Hours-based'}],
trips:[{id:'trip_1001',number:'AT-1001',date:today(),routeId:'rte_oshakati',truckId:'trk_127',trailerId:'trl_taut1',driverId:'drv_johannes',clientId:'cli_nbl',load:'36 pallets beer / empty bottle returns',tons:36,pallets:36,startKm:510990,endKm:512410,distance:1420,income:52000,dieselCost:17700,tolls:0,allowance:600,other:250,status:'In transit',stage:3,pod:false,invoiceId:'',approved:true},{id:'trip_1000',number:'AT-1000',date:today(),routeId:'rte_walvis',truckId:'trk_134',trailerId:'trl_flat1',driverId:'drv_peter',clientId:'cli_rf',load:'General cargo',tons:28,pallets:0,startKm:644805,endKm:645200,distance:395,income:16800,dieselCost:6900,tolls:0,allowance:400,other:0,status:'Delivered',stage:4,pod:true,invoiceId:'inv_1000',approved:true}],
diesel:[{id:'fuel_1',tripId:'trip_1001',date:today(),truckId:'trk_127',driverId:'drv_johannes',litres:655,price:26.77,odometer:511700,supplier:'Puma',slip:'DS-1042',verified:true},{id:'fuel_2',tripId:'trip_1000',date:today(),truckId:'trk_134',driverId:'drv_peter',litres:258,price:26.77,odometer:645200,supplier:'Shell',slip:'DS-1041',verified:true}],expenses:[],tripIssues:[],maintenance:[{id:'mnt_1',date:today(),truckId:'trk_134',type:'Scheduled inspection',supplier:'Angermund Workshop',odometer:645200,cost:0,nextService:650000,status:'Completed'}],tyres:[{id:'ty_1',serial:'TY-8821',truckId:'trk_134',position:'Front left',brand:'Bridgestone',fittedKm:610000,currentKm:645200,cost:6900,status:'Good'}],
permits:[{id:'doc_1',type:'Roadworthy',ownerType:'truck',ownerId:'trk_nbl1',reference:'RW-NBL1',issued:'2025-10-28',expiry:'2026-10-28',status:'Active'},{id:'doc_2',type:'PrDP',ownerType:'driver',ownerId:'drv_peter',reference:'PRDP-PETER',issued:'2024-11-12',expiry:'2026-11-12',status:'Active'}],invoices:[{id:'inv_1000',number:'INV-1000',date:today(),clientId:'cli_rf',tripId:'trip_1000',amount:16800,due:'2026-10-24',status:'Unpaid'}],payments:[],advances:[{id:'adv_1',date:today(),driverId:'drv_johannes',tripId:'trip_1001',type:'Food / trip advance',amount:600,status:'Issued'}],inspections:[{id:'ins_1',date:today(),truckId:'trk_127',driverId:'drv_johannes',tripId:'trip_1001',type:'Pre-trip',score:100,status:'Passed',defects:'',items:{tyres:true,lights:true,brakes:true,fluids:true,documents:true,load:true}}],
incidents:[{id:'inc_1',date:'2025-11-12',type:'Property damage',truckId:'trk_nbl1',driverId:'',tripId:'',severity:'Medium',description:'NBL boom gate contact during access disagreement.',status:'Closed',action:'Communication procedure reviewed.'}],tasks:[{id:'task_1',title:'Collect POD for AT-1001',ownerRole:'Driver',linkedType:'trip',linkedId:'trip_1001',due:today(),priority:'High',status:'Open'},{id:'task_2',title:'Renew NBL Shunter 1 roadworthy',ownerRole:'Admin',linkedType:'truck',linkedId:'trk_nbl1',due:'2026-10-28',priority:'High',status:'Open'}],payroll:[{id:'pay_1',period:'2026-09',employeeId:'drv_johannes',days:22,overtime:5,base:12000,incentive:0,deductions:0,status:'Draft'}],payProfiles:[],quotes:[],approvals:[{id:'apr_1',type:'Expense',description:'Tyre replacement – N 134 WH',amount:6900,requester:'Workshop',status:'Pending',linkedType:'tyre',linkedId:'ty_1'}],audit:[{id:'log_1',at:new Date().toISOString(),actor:'System',action:'Professional operations workspace initialized',linkedType:'system',linkedId:''}]};
function merge(saved){const next=structuredClone(base);Object.keys(next).forEach(k=>{if(saved?.[k]!==undefined)next[k]=k==='settings'?{...next.settings,...saved[k]}:saved[k]});const oshakati=next.routes.find(r=>r.id==='rte_oshakati');if(oshakati&&num(oshakati.distance)===710){oshakati.name='Windhoek ↔ Oshakati';oshakati.distance=1420;oshakati.notes='710 km each way; 36 pallets beer / empty returns'}next.trips.filter(t=>t.routeId==='rte_oshakati'&&num(t.distance)===710).forEach(t=>{t.distance=1420;if(num(t.startKm)&&num(t.endKm)===num(t.startKm)+710)t.endKm=num(t.startKm)+1420});next.version=2;return next}
function load(){try{const v=JSON.parse(localStorage.getItem(STORE)||'null');if(v)return merge(v)}catch{}try{const old=JSON.parse(localStorage.getItem(LEGACY_STORE)||'null');if(old){const n=structuredClone(base);['trucks','drivers','trips','diesel','expenses','maintenance','permits','invoices','routes'].forEach(k=>{if(old[k]?.length)n[k]=old[k]});return n}}catch{}return structuredClone(base)}
let db=load(),page='command',role=localStorage.getItem('angermund_role')||'admin',formType='';
const get=(k,id)=>(db[k]||[]).find(x=>x.id===id)||{},name=(k,id,f='name')=>get(k,id)[f]||'—',truck=id=>name('trucks',id,'registration'),driver=id=>name('drivers',id),client=id=>name('clients',id),route=id=>name('routes',id),trailer=id=>name('trailers',id,'registration');

function tripLegs(t){
  if(Array.isArray(t?.legs)&&t.legs.length)return t.legs.slice().sort((a,b)=>num(a.sequence)-num(b.sequence));
  if(!t?.id)return[];
  return[{id:'legacy_'+t.id,sequence:1,label:'Outbound / Load 1',routeId:t.routeId,clientId:t.clientId,load:t.load||'',tons:num(t.tons),pallets:num(t.pallets),distance:num(t.distance),namibiaKm:num(t.namibiaKm),pricingMethod:'Manual negotiated',unitRate:0,agreedAmount:num(t.income),income:num(t.income),status:t.status||'Planned',pod:Boolean(t.pod),invoiceId:t.invoiceId||'',legacy:true}]
}
function legIncomeClient(leg){
  const method=String(leg?.pricingMethod||'Manual negotiated'),rate=num(leg?.unitRate),manual=num(leg?.agreedAmount||leg?.income);
  if(method==='Per km')return rate*num(leg.distance);
  if(method==='Per ton')return rate*num(leg.tons);
  if(method==='Per pallet')return rate*num(leg.pallets);
  if(method==='Flat trip')return rate>0?rate:manual;
  return manual
}
function journeyIncome(t){const legs=tripLegs(t);return legs.length?sum(legs,legIncomeClient):num(t.income)}
function journeyDistance(t){const legs=tripLegs(t);return legs.length?sum(legs,x=>x.distance):num(t.distance)}
function activeJourneyLeg(t){
  const legs=tripLegs(t),open=legs.find(x=>!['Delivered','Invoiced','Closed'].includes(String(x.status||'')));
  return open||legs[legs.length-1]||null
}
function journeyRouteLabel(t){
  const legs=tripLegs(t);if(!legs.length)return route(t.routeId);
  if(legs.length===1)return route(legs[0].routeId);
  return legs.map(x=>route(x.routeId)).join(' · ')
}
function journeyLoadLabel(t){
  const legs=tripLegs(t);if(!legs.length)return t.load||'—';
  if(legs.length===1)return legs[0].load||'—';
  return legs.map(x=>x.load||'Load').join(' → ')
}
function reverseRouteId(routeId){
  const r=get('routes',routeId);if(!r.id)return db.routes[0]?.id||'';
  if(r.roundTrip||String(r.name||'').includes('↔'))return r.id;
  const parts=String(r.name||'').split(/→|->/).map(x=>x.trim()).filter(Boolean);
  if(parts.length>=2){
    const a=parts[0].toLowerCase(),b=parts[parts.length-1].toLowerCase();
    const rev=db.routes.find(x=>{const n=String(x.name||'').toLowerCase();return n.includes(b)&&n.includes(a)&&((n.indexOf(b)<n.indexOf(a))||n.includes('↔'))});
    if(rev)return rev.id
  }
  return r.id
}
function legPricingLabel(leg){
  const m=String(leg.pricingMethod||'Manual negotiated'),r=num(leg.unitRate);
  if(m==='Per km')return money(r)+'/km';
  if(m==='Per ton')return money(r)+'/ton';
  if(m==='Per pallet')return money(r)+'/pallet';
  if(m==='Flat trip')return 'Flat '+money(r||leg.income);
  return 'Negotiated '+money(leg.agreedAmount||leg.income)
}
const sum=(rows,fn)=>rows.reduce((a,x)=>a+num(fn(x)),0),linked=(k,f,id)=>(db[k]||[]).filter(x=>x[f]===id);const fuelRecordCost=x=>num(x.printedTotal)||num(x.total)||num(x.litres)*num(x.price);function tripFinancials(t){const fuel=linked('diesel','tripId',t.id),expenses=linked('expenses','tripId',t.id),diesel=fuel.length?sum(fuel,fuelRecordCost):num(t.dieselCost),routeExpenses=sum(expenses,x=>x.amount),hasToll=expenses.some(x=>/^toll$/i.test(String(x.category||''))),legacyToll=hasToll?0:num(t.tolls),allowance=num(t.allowance),other=num(t.other),total=diesel+routeExpenses+legacyToll+allowance+other;return{diesel,routeExpenses,legacyToll,allowance,other,total,profit:journeyIncome(t)-total}}const tripDieselSpend=t=>tripFinancials(t).diesel,tripRouteExpenseSpend=t=>{const f=tripFinancials(t);return f.routeExpenses+f.legacyToll+f.allowance+f.other},tripCost=t=>tripFinancials(t).total,tripProfit=t=>tripFinancials(t).profit;
function roleLabel(){return {admin:'Admin & Operations',manager:'Manager',dispatcher:'Dispatcher',driver:'Driver',warehouse:'Warehouse',workshop:'Workshop',finance:'Finance'}[role]||role}
function commit(msg,type='system',id=''){db.audit.unshift({id:uid('log'),at:new Date().toISOString(),actor:roleLabel(),action:msg,linkedType:type,linkedId:id});db.audit=db.audit.slice(0,100);localStorage.setItem(STORE,JSON.stringify(db));syncState();render();notify(msg)}
function fuelMetrics(id){const t=get('trips',id),distance=num(t.distance),litres=sum(linked('diesel','tripId',id),x=>x.litres),ready=distance>0&&litres>0;return{distance,litres,ready,kmPerL:ready?distance/litres:0,litresPerKm:ready?litres/distance:0,litresPer100Km:ready?(litres/distance)*100:0}}
function fuelEfficiency(id){return fuelMetrics(id).kmPerL}
function isSouthAfricaTrip(t){return tripLegs(t).some(l=>/south africa|durban|johannesburg|rosslyn|cape town|ottery|gauteng/i.test(route(l.routeId)))}
function incentiveRate(t){const m=fuelMetrics(t.id);if(!m.ready)return 0;const p=clientPayProfile(t.driverId),minimum=num(p.minimumBonusKml)||2.0;if(m.kmPerL<minimum)return 0;if(isSouthAfricaTrip(t))return .60;if(m.kmPerL>=2.4)return .50;if(m.kmPerL>=2.3)return .40;return .30}
function incentiveFor(t){return journeyDistance(t)*incentiveRate(t)}
function tripPayFor(t){return journeyDistance(t)*num(clientPayProfile(t.driverId).tripRatePerKm)}
function tripSettlement(t){const reimbursable=sum(linked('expenses','tripId',t.id),x=>x.status==='Approved'&&x.reimbursable!==false?x.amount:0),advances=sum(linked('advances','tripId',t.id),x=>x.status!=='Reconciled'?x.amount:0),fuel=fuelMetrics(t.id),rate=incentiveRate(t),incentive=incentiveFor(t),tripRate=num(clientPayProfile(t.driverId).tripRatePerKm),tripPay=tripPayFor(t);return{fuel,rate,incentive,tripRate,tripPay,reimbursable,advances,due:Math.max(0,tripPay+incentive+reimbursable-advances)}}
const invoicePaid=id=>sum(linked('payments','invoiceId',id),x=>x.amount),invoiceBalance=i=>Math.max(0,num(i.amount)-invoicePaid(i.id));
function refreshInvoiceStatus(i){const paid=invoicePaid(i.id),balance=Math.max(0,num(i.amount)-paid);i.paidAmount=paid;i.balance=balance;i.status=balance<=.005?'Paid':paid>0?'Part Paid':i.due&&daysUntil(i.due)<0?'Overdue':'Unpaid';if(i.status==='Paid')i.paidDate=linked('payments','invoiceId',i.id)[0]?.date||today();return i.status}
const currentDriver=()=>role==='driver'&&sessionUser?.driverId?sessionUser.driverId:(db.settings.currentDriver||db.drivers[0]?.id);
const navGroups=[['Operate',[['command','⌂','Command Centre'],['dispatch','⇄','Dispatch Board'],['trips','↗','Trips & Loads'],['driverPortal','◉','Driver Workspace'],['tasks','✓','Tasks & Approvals']]],['Live Control',[['tracking','⌖','Live GPS & Geofences'],['notifications','🔔','Alerts & Notifications'],['driverUploads','📎','Driver Uploads']]],['Fleet',[['fleet','▣','Fleet & GPS'],['inspections','☑','Inspections'],['diesel','◉','Diesel Control'],['workshop','⚙','Workshop & Service'],['tyres','◎','Tyre Register'],['documents','▤','Documents & Permits'],['incidents','!','Incidents & Discipline']]],['Business',[['clients','♧','Clients & Routes'],['invoices','▥','Invoices & Debtors'],['roadCharges','🛣','MDC & Road Charges'],['payroll','$','Payroll & Payslips'],['rates','⌁','Rates & Quotations'],['reports','▥','Reports & P&L']]],['System',[['automation','✦','Smart Inbox'],['knowledge','?','Roles & Requirements'],['driverAccounts','👤','Driver Accounts'],['settings','⚙','Settings & Data']]]];
const allowed={manager:['command','dispatch','trips','tasks','tracking','notifications','driverUploads','fleet','inspections','diesel','workshop','tyres','documents','incidents','clients','invoices','roadCharges','payroll','rates','reports','automation','knowledge'],driver:['driverPortal','tracking','notifications','knowledge'],warehouse:['command','dispatch','trips','tasks','notifications','documents','knowledge'],workshop:['command','fleet','inspections','diesel','workshop','tyres','documents','tasks','notifications','driverUploads','knowledge'],finance:['command','trips','clients','invoices','roadCharges','payroll','rates','reports','tasks','notifications','driverUploads','settings'],dispatcher:['command','dispatch','trips','driverPortal','tracking','notifications','driverUploads','fleet','inspections','diesel','documents','incidents','clients','roadCharges','tasks','automation','knowledge']};
const canView=id=>role==='admin'||(allowed[role]||[]).includes(id),go=p=>{page=canView(p)?p:(role==='driver'?'driverPortal':'command');$('sidebar').classList.remove('open');render()};
const hints={command:'Live company risks, movement and financial health',dispatch:'Control every load from booking to invoice',trips:'One source of truth for loads, costs, proof and profit',driverPortal:'Assigned work, safety checks, proof and requirements',tasks:'Work queue, approvals and overdue actions',tracking:'Live positions, route trails and location-based alerts',notifications:'Push, WhatsApp, email and in-app exception alerts',driverUploads:'Receipts, PODs and photos uploaded by drivers',fleet:'Availability, GPS, utilization and compliance',inspections:'Pre-trip, post-trip and defect control',diesel:'Every litre linked to truck, driver and trip',workshop:'Maintenance planning, defects and service costs',tyres:'Tyre life, position, cost and replacement',documents:'Company, driver, vehicle and border compliance',incidents:'Safety, damage, warnings and corrective actions',clients:'Customers, contacts and standard routes',invoices:'Trip-to-invoice control and debtors',roadCharges:'Namibian mass-distance charges linked to each trip',payroll:'Automatic month-end driver payslips, incentives and advances',rates:'Diesel-linked quotes and standing charges',reports:'Linked operational and financial performance',automation:'Verify scans before records are created',knowledge:'Duties, policies and checklists by role',driverAccounts:'Create, link and manage simple driver logins',settings:'Defaults, roles and data protection'};
function renderNav(){$('nav').innerHTML=navGroups.map(([g,items])=>{const v=items.filter(x=>canView(x[0]));return v.length?`<div class="nav-section">${g}</div>${v.map(([id,icon,label])=>`<button data-page="${id}" class="${page===id?'active':''}"><span>${icon}</span>${label}</button>`).join('')}`:''}).join('');$('nav').querySelectorAll('button').forEach(b=>b.onclick=()=>go(b.dataset.page))}
function render(){document.body.classList.toggle('driver-mode',role==='driver');if(!canView(page))page=role==='driver'?'driverPortal':'command';renderNav();$('pageTitle').textContent={command:'Command Centre',driverPortal:'Driver Workspace',automation:'Smart Document Inbox',knowledge:'Roles & Requirements',driverAccounts:'Driver Accounts'}[page]||navGroups.flatMap(x=>x[1]).find(x=>x[0]===page)?.[2]||'Operations';$('pageHint').textContent=hints[page]||'';$('roleSelect').value=role;$('quickTripBtn').style.display=['driver','workshop'].includes(role)?'none':'';const driverBar=role==='driver'&&page!=='driverPortal'?'<nav class="driver-bottom"><button class="nav-to" data-page="driverPortal">🚛<span>Trip</span></button><button class="nav-to '+(page==='notifications'?'active':'')+'" data-page="notifications">🔔<span>Alerts</span></button><button type="button" id="driverHelpBtn">👤<span>Help</span></button><button type="button" id="driverLogoutBottom">↪<span>Log out</span></button></nav>':'';$('app').innerHTML=(views[page]||views.command)()+driverBar;wire()}
const kpi=(l,v,s='',tone='')=>`<div class="kpi"><span>${l}</span><strong class="${tone}">${v}</strong><small>${s}</small></div>`;
function badge(v){const w=/pending|planned|due|expir|unpaid|part|medium|in transit|open/i.test(v),b=/overdue|failed|critical|out of service|rejected/i.test(v);return `<span class="badge ${b?'negative':w?'warn':''}">${esc(v)}</span>`}
function complianceAlerts(){const out=[];db.permits.forEach(p=>{const d=daysUntil(p.expiry);if(d<45)out.push({text:`${p.type} for ${p.ownerType==='truck'?truck(p.ownerId):driver(p.ownerId)} ${d<0?'expired':`expires in ${d} days`}`,tone:d<0?'bad':'warn'})});db.drivers.forEach(x=>{const d=daysUntil(x.prdpExpiry);if(d<45)out.push({text:`PrDP for ${x.name} ${d<0?'expired':`expires in ${d} days`}`,tone:d<0?'bad':'warn'})});return out}
const serviceDue=()=>db.trucks.filter(t=>num(t.serviceDue)-num(t.odometer)<=5000);
function command(){const active=db.trips.filter(t=>!['Delivered','Invoiced','Closed'].includes(t.status)),revenue=sum(db.trips,t=>t.income),costs=sum(db.trips,tripCost)+sum(db.maintenance,x=>x.cost),profit=revenue-costs,alerts=complianceAlerts(),defects=db.inspections.filter(i=>i.status==='Failed'||i.defects).length;return `<section class="hero"><div><h2>Good day, ${esc(roleLabel())}</h2><p>Dispatch, trucks, drivers, diesel, proof, invoices and costs share one linked record. Management sees exceptions—not duplicate capture.</p></div><div class="hero-actions"><button class="primary action" data-action="newTrip">Dispatch load</button><button class="ghost" id="refreshLiveData">↻ Refresh live data</button><button class="ghost nav-to" data-page="tasks">Review work queue</button></div></section><section class="kpis">${kpi('Active movements',active.length,'Namibia & South Africa')}${kpi('Fleet available',db.trucks.filter(t=>t.status==='Available').length,`${db.trucks.length} units registered`)}${kpi('Compliance risks',alerts.length,`${defects} inspection defects`,alerts.length?'warning':'')}${role==='workshop'?kpi('Services due',serviceDue().length,'Within 5,000 km'):kpi('Net contribution',money(profit),`${revenue?((profit/revenue)*100).toFixed(1):0}% margin`,profit<0?'negative':'positive')}</section><section class="grid-2"><div class="panel"><div class="panel-head"><h2>Live trip control</h2><button class="small nav-to" data-page="dispatch">Open board</button></div>${tripTable(db.trips.slice(0,6))}</div><div class="panel"><h2>Requires attention</h2><div class="alerts">${[...alerts.slice(0,4),...db.tasks.filter(t=>t.status==='Open').slice(0,3).map(t=>({text:t.title,tone:t.priority==='High'?'bad':'warn'}))].map(a=>`<div class="alert"><span class="status-dot ${a.tone}"></span>${esc(a.text)}</div>`).join('')||'<div class="empty">No urgent alerts</div>'}</div></div></section><section class="panel" style="margin-top:18px"><h2>Operational pulse</h2><div class="quick-grid"><div class="quick-card"><b>GPS & security</b><p>${db.trucks.filter(t=>t.gps==='Online').length}/${db.trucks.length} vehicles reporting</p></div><div class="quick-card"><b>Diesel control</b><p>${db.diesel.filter(x=>!x.verified).length} slips awaiting verification</p></div><div class="quick-card"><b>POD control</b><p>${db.trips.filter(t=>t.stage>=4&&!t.pod).length} delivered loads missing proof</p></div><div class="quick-card"><b>Approvals</b><p>${db.approvals.filter(a=>a.status==='Pending').length} decisions pending</p></div></div></section>`}
function tripTable(rows){
  const fin=!['driver','workshop'].includes(role);
  return `<div class="table-wrap"><table><thead><tr><th>Journey</th><th>Status</th><th>Legs / Routes</th><th>Truck / Driver</th><th>Cargo</th>${fin?'<th>Income</th><th>Diesel</th><th>Expenses</th><th>Total cost</th><th>Contribution</th>':''}<th>Proof</th><th></th></tr></thead><tbody>${rows.length?rows.map(t=>{
    const legs=tripLegs(t),active=activeJourneyLeg(t);
    return `<tr><td><b>${esc(t.number)}</b><br><small>${esc(t.date)} · ${legs.length} leg${legs.length===1?'':'s'}</small></td><td>${badge(t.status)}</td><td><b>${esc(active?route(active.routeId):route(t.routeId))}</b><br><small>${journeyDistance(t).toLocaleString()} km total${legs.length>1?' · '+legs.map(x=>esc(route(x.routeId))).join(' / '):''}</small></td><td>${esc(truck(t.truckId))}<br><small>${esc(driver(t.driverId))}</small></td><td>${esc(journeyLoadLabel(t)||'—')}</td>${fin?`<td>${money(journeyIncome(t))}</td><td>${money(tripDieselSpend(t))}</td><td>${money(tripRouteExpenseSpend(t))}</td><td>${money(tripCost(t))}</td><td class="${tripProfit(t)>=0?'positive':'negative'}">${money(tripProfit(t))}</td>`:''}<td>${t.pod?'✓ POD':'Missing'}</td><td><button class="link-button open-trip" data-id="${t.id}">Open</button></td></tr>`
  }).join(''):`<tr><td colspan="${fin?12:7}" class="empty">No journeys recorded</td></tr>`}</tbody></table></div>`;
}
function dispatch(){
  const cols=[['Planned',1],['Loading',2],['In transit',3],['Delivered',4],['Invoiced',5]];
  return `<div class="notice">Each journey can contain one or more priced legs. Truck/driver status follows the overall journey; clients, cargo, rates and invoices can differ per leg.</div><div class="workflow">${cols.map(([l,n])=>`<div class="stage"><span>Stage ${n}</span><strong>${l}</strong><p>${db.trips.filter(t=>num(t.stage)===n).length} journey(s)</p></div>`).join('')}</div><div class="cards-list">${db.trips.map(tripCard).join('')}</div>`;
}
function tripCard(t){
  const legs=tripLegs(t),active=activeJourneyLeg(t),next={1:'Start loading',2:'Depart',3:'Confirm delivery',4:legs.length>1?'Invoice legs':'Create invoice',5:'Close'}[t.stage]||'Open';
  return `<article class="entity-card"><div class="panel-head"><h3>${esc(t.number)}</h3>${badge(t.status)}</div><p><b>${esc(active?route(active.routeId):journeyRouteLabel(t))}</b></p><p>${legs.length>1?`Leg ${num(active?.sequence)}/${legs.length} · `:''}${esc(active?client(active.clientId):client(t.clientId))} · ${esc(active?.load||t.load||'—')}</p><p>${esc(truck(t.truckId))} / ${esc(driver(t.driverId))}</p><div class="metric-line"><span>Journey income</span><b>${money(journeyIncome(t))}</b></div><div class="metric-line"><span>Contribution</span><b class="${tripProfit(t)>=0?'positive':'negative'}">${money(tripProfit(t))}</b></div><button class="primary small advance-trip" data-id="${t.id}">${next}</button> <button class="ghost small open-trip" data-id="${t.id}">Details</button></article>`;
}
function trips(){return `<div class="panel"><div class="toolbar"><input id="tripSearch" placeholder="Search trip, route, client, truck or driver"><div><button class="ghost export" data-kind="trips">Export</button> <button class="primary action" data-action="newTrip">+ New trip</button></div></div><div id="tripResults">${tripTable(db.trips)}</div></div>`}
function driverJobId(prefix='drv'){return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function driverQueueDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('angermund_driver_jobs',1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('jobs'))d.createObjectStore('jobs',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function driverQueuePut(job){const d=await driverQueueDb();return new Promise((resolve,reject)=>{const tx=d.transaction('jobs','readwrite');tx.objectStore('jobs').put(job);tx.oncomplete=()=>{d.close();resolve()};tx.onerror=()=>{d.close();reject(tx.error)}})}
async function driverQueueList(){const d=await driverQueueDb();return new Promise((resolve,reject)=>{const tx=d.transaction('jobs','readonly'),r=tx.objectStore('jobs').getAll();r.onsuccess=()=>{d.close();resolve(r.result||[])};r.onerror=()=>{d.close();reject(r.error)}})}
async function driverQueueDelete(id){const d=await driverQueueDb();return new Promise((resolve,reject)=>{const tx=d.transaction('jobs','readwrite');tx.objectStore('jobs').delete(id);tx.oncomplete=()=>{d.close();resolve()};tx.onerror=()=>{d.close();reject(tx.error)}})}
async function refreshCentralState(showMessage=false){
  const state=await api('/api/state');
  if(state.payload&&Object.keys(state.payload).length){
    db=merge(state.payload);
    localStorage.setItem(STORE,JSON.stringify(db));
    render();
    if(showMessage)notify('Live data refreshed');
  }
  return state;
}
async function refreshDriverState(){await refreshCentralState(false)}
async function driverApiAction(job){return api('/api/driver/trips/'+encodeURIComponent(job.tripId)+'/action',{method:'POST',body:{action:job.action,data:job.data||{},clientActionId:job.clientActionId}})}
async function prepareArchiveImage(file,maxDimension=1800,quality=.76){
  if(!file||!String(file.type||'').startsWith('image/'))return file;
  try{
    const bitmap=await createImageBitmap(file),scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale)),canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(bitmap,0,0,w,h);bitmap.close?.();
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not compress image')),'image/jpeg',quality));
    const base=String(file.name||'capture').replace(/\.[^.]+$/,'');
    return new File([blob],base+'.jpg',{type:'image/jpeg',lastModified:Date.now()})
  }catch{return file}
}
async function driverUpload(tripId,kind,file){const archived=await prepareArchiveImage(file);const fd=new FormData();fd.append('kind',kind);fd.append('document',archived,archived.name||kind+'.jpg');return api('/api/driver/trips/'+encodeURIComponent(tripId)+'/upload',{method:'POST',body:fd})}
async function queueDriverJob(job){await driverQueuePut(job);notify('✅ Saved on this phone — will send when signal returns')}
async function sendDriverAction(tripId,action,data={},success='Saved'){const job={id:driverJobId('job'),type:'action',tripId,action,data,clientActionId:driverJobId(action),createdAt:new Date().toISOString()};if(!navigator.onLine){await queueDriverJob(job);return{queued:true}}try{const r=await driverApiAction(job);await refreshDriverState();notify(success);return r}catch(e){if(/fetch|network|offline|load failed/i.test(String(e.message||''))){await queueDriverJob(job);return{queued:true}}notify(e.message);throw e}}
async function driverReceiptAction(tripId,files,action,data,clientActionId){
  const clean=(files||[]).filter(Boolean).slice(0,2);
  if(!clean.length)throw new Error('Receipt photo required');
  const archived=await Promise.all(clean.map(file=>prepareArchiveImage(file)));
  const fd=new FormData();fd.append('action',action);fd.append('data',JSON.stringify(data||{}));fd.append('clientActionId',clientActionId||driverJobId(action));
  archived.forEach((file,i)=>fd.append('documents',file,file.name||((i?'supporting-':'')+action+'.jpg')));
  return api('/api/driver/trips/'+encodeURIComponent(tripId)+'/receipt',{method:'POST',body:fd});
}
async function sendDriverPhotoAction(tripId,kind,file,action,data={},success='Saved'){
  const job={id:driverJobId('job'),type:'photo-action',tripId,kind,file,action,data,clientActionId:driverJobId(action),createdAt:new Date().toISOString()};
  if(!navigator.onLine){await queueDriverJob(job);return{queued:true}}
  try{
    let r;
    if(action==='diesel'||action==='expense')r=await driverReceiptAction(tripId,[file],action,data,job.clientActionId);
    else{const up=await driverUpload(tripId,kind,file);job.data={...data,uploadId:up.id,receiptUploadIds:[up.id]};r=await driverApiAction(job)}
    await refreshDriverState();notify(success);return r
  }catch(e){
    if(/fetch|network|offline|load failed/i.test(String(e.message||''))){await queueDriverJob(job);return{queued:true}}
    notify(e.message);throw e
  }
}
async function sendDriverMultiPhotoAction(tripId,kind,files,action,data={},success='Saved'){
  const clean=(files||[]).filter(Boolean).slice(0,2);
  if(!clean.length)throw new Error('At least one receipt photo is required');
  const job={id:driverJobId('job'),type:'multi-photo-action',tripId,kind,files:clean,action,data,clientActionId:driverJobId(action),createdAt:new Date().toISOString()};
  if(!navigator.onLine){await queueDriverJob(job);return{queued:true}}
  try{
    const r=(action==='diesel'||action==='expense')
      ?await driverReceiptAction(tripId,clean,action,data,job.clientActionId)
      :await (async()=>{const uploads=[];for(let i=0;i<clean.length;i++)uploads.push(await driverUpload(tripId,i===0?kind:kind+'-supporting',clean[i]));job.data={...data,uploadId:uploads[0]?.id||'',receiptUploadIds:uploads.map(x=>x.id),supportingUploadId:uploads[1]?.id||''};return driverApiAction(job)})();
    await refreshDriverState();notify(success);return r
  }catch(e){
    if(/fetch|network|offline|load failed/i.test(String(e.message||''))){await queueDriverJob(job);return{queued:true}}
    notify(e.message);throw e
  }
}

async function flushDriverJobs(){
  if(!navigator.onLine||!authToken||role!=='driver')return;
  let jobs=[];try{jobs=await driverQueueList()}catch{return}
  for(const job of jobs.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))){
    try{
      if((job.action==='diesel'||job.action==='expense')&&(job.type==='photo-action'||job.type==='multi-photo-action')){
        const files=job.type==='multi-photo-action'?(job.files||[]):[job.file];
        await driverReceiptAction(job.tripId,files,job.action,job.data||{},job.clientActionId);
      }else{
        if(job.type==='photo-action'){
          const up=await driverUpload(job.tripId,job.kind,job.file);
          job.data={...(job.data||{}),uploadId:up.id,receiptUploadIds:[up.id]};
        }else if(job.type==='multi-photo-action'){
          const uploads=[];
          for(let i=0;i<(job.files||[]).length;i++)uploads.push(await driverUpload(job.tripId,i===0?job.kind:job.kind+'-supporting',job.files[i]));
          job.data={...(job.data||{}),uploadId:uploads[0]?.id||'',receiptUploadIds:uploads.map(x=>x.id),supportingUploadId:uploads[1]?.id||''};
        }
        await driverApiAction(job);
      }
      await driverQueueDelete(job.id);
    }catch(e){
      if(/401|403|invalid|not assigned|not found/i.test(String(e.message||'')))await driverQueueDelete(job.id);else break
    }
  }
  if(jobs.length)try{await refreshDriverState();notify('✅ Saved driver updates sent')}catch{}
}
function driverCapture(kind,callback){const input=document.createElement('input');input.type='file';input.accept='image/*';input.capture='environment';input.style.display='none';document.body.appendChild(input);input.onchange=()=>{const file=input.files&&input.files[0];input.remove();if(file)callback(file)};input.click()}
function driverPassedInspection(tripId){return db.inspections.some(x=>x.tripId===tripId&&x.type==='Pre-trip'&&x.status==='Passed')}
function driverNextStep(t){
  if(!t.driverAcceptedAt)return{key:'accept',icon:'✓',label:'ACCEPT TRIP',sub:'I have received this assignment'};
  if(!driverPassedInspection(t.id))return{key:'inspection',icon:'🚛',label:'DO VEHICLE CHECK',sub:'Tyres · lights · brakes · fluids · documents · load'};
  const legs=tripLegs(t),leg=activeJourneyLeg(t),r=get('routes',leg?.routeId||t.routeId),auto=routeAutoGpsReady(r),g=leg?.geo||t.geo||{};
  if(leg&&String(leg.status)==='At offloading'&&!leg.pod)return{key:'pod',icon:'📷',label:'TAKE POD PHOTO',sub:'Photograph the signed proof for this load'};
  if(auto){
    if(!g.loadDepartedAt&&num(t.stage)<3){
      if(g.loadArrivedAt)return{key:'geo',icon:'📍',label:'AT LOADING POINT',sub:'GPS will start this leg automatically when you leave'};
      if(g.loadApproachAt)return{key:'geo',icon:'📍',label:'APPROACHING LOADING',sub:'Automatic GPS is watching this leg’s loading zone'};
      return{key:'geo',icon:'📡',label:'GPS AUTO ACTIVE',sub:'Approach and arrival for this leg are automatic'};
    }
    if(!g.offloadArrivedAt){
      if(g.offloadApproachAt)return{key:'geo',icon:'📍',label:'APPROACHING OFFLOAD',sub:'Arrival for this leg will be recorded automatically'};
      return{key:'geo',icon:'📡',label:'IN TRANSIT · GPS ACTIVE',sub:'Offloading approach and arrival are automatic'};
    }
    if(!g.offloadDepartedAt)return{key:'geo',icon:'📍',label:'AT OFFLOADING',sub:'Departure will be recorded automatically'};
    if(legs.length===1&&routeUsesRoundTrip(r)&&!g.returnArrivedAt){
      if(g.returnApproachAt)return{key:'geo',icon:'🏠',label:'APPROACHING RETURN POINT',sub:'Return arrival will be recorded automatically'};
      return{key:'geo',icon:'↩',label:'RETURN JOURNEY · GPS ACTIVE',sub:'The app is watching the return to loading point'};
    }
  }
  if(num(t.stage)<3)return{key:'start',icon:'▶',label:legs.length>1?'START THIS LEG':'START TRIP',sub:leg?`Begin ${leg.label||'this load'} · ${route(leg.routeId)}`:'Begin driving this assigned route'};
  if(num(t.stage)===3)return{key:'arrive',icon:'📍',label:'I HAVE ARRIVED',sub:'Confirm arrival for this load'};
  if(!leg?.pod&&num(t.stage)>=3)return{key:'pod',icon:'📷',label:'TAKE POD PHOTO',sub:'Photograph the signed proof for this load'};
  if(t.pod&&!t.driverComplete)return{key:'finish',icon:'✓',label:'FINISH JOURNEY',sub:'All journey legs are complete — send to office'};
  return{key:'complete',icon:'✓',label:'JOURNEY COMPLETE',sub:'Office has your trip information'};
}
async function driverMainStep(t){const n=driverNextStep(t);if(n.key==='accept')return sendDriverAction(t.id,'accept',{},'Trip accepted');if(n.key==='inspection')return openDriverInspection(t);if(n.key==='start'){gpsCheckIn();return sendDriverAction(t.id,'start',{},'Trip started')}if(n.key==='arrive'){gpsCheckIn();return sendDriverAction(t.id,'arrive',{},'Arrival recorded')}if(n.key==='pod')return driverCapture('pod',file=>sendDriverPhotoAction(t.id,'pod',file,'pod',{},'POD received'));if(n.key==='finish')return sendDriverAction(t.id,'finish',{},'✅ Trip finished')}
function openDriverInspection(t){$('modalTitle').textContent='Quick vehicle check';$('entryForm').innerHTML='<div class="driver-check"><div class="driver-check-icon">🚛</div><h2>Is the truck safe to drive?</h2><p>Check tyres, lights, brakes, fluids, documents and the load.</p><button type="button" class="driver-good" id="driverAllGood">✓ ALL GOOD</button><button type="button" class="driver-found" id="driverFoundProblem">⚠ I FOUND A PROBLEM</button><button type="button" class="ghost" id="cancelForm">Cancel</button><div id="driverDefectBox" class="hidden"><label>Tell the office what is wrong</label><textarea id="driverDefectText" rows="4" placeholder="Type it or use the microphone…"></textarea><div class="driver-inline"><button type="button" class="ghost" id="driverSpeak">🎤 SPEAK</button><button type="button" class="danger" id="driverSendDefect">SEND PROBLEM</button></div></div></div>';$('modal').classList.remove('hidden');$('cancelForm').onclick=()=>$('modal').classList.add('hidden');$('driverAllGood').onclick=async()=>{$('modal').classList.add('hidden');await sendDriverAction(t.id,'inspection',{defects:''},'Vehicle check passed')};$('driverFoundProblem').onclick=()=>{$('driverDefectBox').classList.remove('hidden');$('driverFoundProblem').classList.add('hidden')};$('driverSpeak').onclick=()=>driverSpeechTo($('driverDefectText'));$('driverSendDefect').onclick=async()=>{const defects=$('driverDefectText').value.trim();if(!defects)return notify('Tell the office what is wrong');$('modal').classList.add('hidden');await sendDriverAction(t.id,'inspection',{defects},'Problem sent to office');await sendDriverAction(t.id,'problem',{type:'Vehicle defect',description:defects},'Problem sent to office')}}
async function prepareReceiptForOcr(file){
  try{
    const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
    const targetWidth=Math.min(2000,Math.max(1200,bmp.width));
    const scale=targetWidth/bmp.width,w=Math.round(bmp.width*scale),h=Math.round(bmp.height*scale);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
    const img=ctx.getImageData(0,0,w,h),d=img.data,hist=new Uint32Array(256);
    for(let i=0;i<d.length;i+=4){const y=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);hist[y]++}
    const total=w*h,percentile=p=>{let n=0,target=total*p;for(let i=0;i<256;i++){n+=hist[i];if(n>=target)return i}return p<.5?0:255};
    const low=percentile(.03),high=Math.max(low+30,percentile(.97)),span=high-low;
    for(let i=0;i<d.length;i+=4){
      let y=.299*d[i]+.587*d[i+1]+.114*d[i+2];
      y=Math.max(0,Math.min(255,(y-low)*255/span));
      y=Math.max(0,Math.min(255,(y-128)*1.35+128));
      if(y>225)y=255;else if(y<80)y=Math.max(0,y*.72);
      d[i]=d[i+1]=d[i+2]=Math.round(y);d[i+3]=255;
    }
    ctx.putImageData(img,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
    return blob?new File([blob],'receipt-ocr.jpg',{type:'image/jpeg'}):file;
  }catch{return file}
}
function receiptClientScore(x){
  if(!x)return 0;
  let score=num(x.categoryConfidence);
  if(x.category&&x.category!=='Other')score+=30;
  if(num(x.suggestedAmount)>0)score+=18;
  if(num(x.litres)>0)score+=22;
  if(num(x.pricePerLitre)>0)score+=14;
  if(x.documentNumber)score+=4;
  if(x.odometer)score+=6;
  if(x.supplier&&String(x.supplier).length>=3)score+=6;
  return score;
}
async function scanReceiptFile(file){
  const fd=new FormData();fd.append('document',file,file.name||'receipt.jpg');
  const job=await api('/api/documents/scan',{method:'POST',body:fd});
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,650));
    const row=await api('/api/documents/scans/'+encodeURIComponent(job.id));
    if(row.status==='review')return row.extracted||{};
    if(row.status==='failed')return{};
  }
  return{};
}
async function prepareReceiptThresholdForOcr(file){
  try{
    const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
    const targetWidth=Math.min(2200,Math.max(1400,bmp.width));
    const scale=targetWidth/bmp.width,w=Math.round(bmp.width*scale),h=Math.round(bmp.height*scale);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);bmp.close?.();
    const img=ctx.getImageData(0,0,w,h),d=img.data,hist=new Uint32Array(256);
    for(let i=0;i<d.length;i+=4){const y=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);hist[y]++}
    const total=w*h;
    let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
    let sumB=0,wB=0,maxVar=-1,threshold=160;
    for(let t=0;t<256;t++){
      wB+=hist[t];if(!wB)continue;
      const wF=total-wB;if(!wF)break;
      sumB+=t*hist[t];
      const mB=sumB/wB,mF=(sum-sumB)/wF,between=wB*wF*(mB-mF)*(mB-mF);
      if(between>maxVar){maxVar=between;threshold=t}
    }
    threshold=Math.max(110,Math.min(210,threshold+8));
    for(let i=0;i<d.length;i+=4){
      const y=.299*d[i]+.587*d[i+1]+.114*d[i+2];
      const v=y<threshold?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;
    }
    ctx.putImageData(img,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return blob?new File([blob],'receipt-threshold.png',{type:'image/png'}):file;
  }catch{return file}
}
function weakReceiptResult(x){
  return !x||x.category==='Other'||num(x.categoryConfidence)<75||(!num(x.suggestedAmount)&&!num(x.litres));
}
function mergeClientReceiptResults(...items){
  const valid=items.filter(Boolean).sort((a,b)=>receiptClientScore(b)-receiptClientScore(a));
  if(!valid.length)return{};
  const out=JSON.parse(JSON.stringify(valid[0]));
  for(const c of valid.slice(1)){
    for(const key of ['supplier','documentNumber','date','registration','odometer','printedTotal','suggestedAmount','litres','pricePerLitre']){
      if((out[key]===null||out[key]===undefined||out[key]===''||num(out[key])===0)&&(c[key]!==null&&c[key]!==undefined&&c[key]!==''))out[key]=c[key];
    }
    if((!out.category||out.category==='Other')&&c.category&&c.category!=='Other'){
      out.category=c.category;out.categoryConfidence=c.categoryConfidence;out.categoryReason=c.categoryReason;out.categorySource=c.categorySource;
    }
  }
  const fuel=valid.filter(x=>Array.isArray(x.fuelTransactions)&&x.fuelTransactions.length)
    .sort((a,b)=>((b.totalsReconcile===true?100:0)+(b.fuelTransactions?.length||0)*20+(num(b.printedTotal)>0?15:0))-((a.totalsReconcile===true?100:0)+(a.fuelTransactions?.length||0)*20+(num(a.printedTotal)>0?15:0)))[0];
  if(fuel){
    for(const key of ['fuelTransactions','fuelTransactionCount','fuelLineAmount','litres','pricePerLitre','printedTotal','suggestedAmount','adjustment','totalsReconcile','totalDifference','needsReview']){
      if(fuel[key]!==undefined)out[key]=JSON.parse(JSON.stringify(fuel[key]));
    }
    if(!out.category||out.category==='Other'){out.category='Diesel';out.categoryConfidence=Math.max(96,num(fuel.categoryConfidence));out.categoryReason='Fuel line-items detected across scan attempts';out.categorySource='merged-images'}
  }
  out.categoryConfidence=Math.max(num(out.categoryConfidence),...valid.filter(x=>x.category===out.category).map(x=>num(x.categoryConfidence)));
  return out;
}
function mergeSupportingReceipt(primary,supporting){
  if(!supporting)return JSON.parse(JSON.stringify(primary||{}));
  const p=primary||{},out=mergeClientReceiptResults(p,supporting);
  const primaryFuel=Array.isArray(p.fuelTransactions)&&p.fuelTransactions.length>0;
  if(primaryFuel){
    for(const key of ['fuelTransactions','fuelTransactionCount','fuelLineAmount','litres','pricePerLitre','printedTotal','suggestedAmount','adjustment','totalsReconcile','totalDifference','needsReview']){
      if(p[key]!==undefined&&p[key]!==null)out[key]=JSON.parse(JSON.stringify(p[key]));
    }
    if(p.category&&p.category!=='Other'){out.category=p.category;out.categoryConfidence=p.categoryConfidence;out.categoryReason=p.categoryReason;out.categorySource=p.categorySource}
    if(p.supplier)out.supplier=p.supplier;
  }
  if(num(supporting.odometer)>0)out.odometer=supporting.odometer;
  if(supporting.registration)out.registration=supporting.registration;
  if(!out.documentNumber&&supporting.documentNumber)out.documentNumber=supporting.documentNumber;
  out.supportingReceiptUsed=true;
  out.supportingReceiptCategory=supporting.category||'';
  out.supportingReceiptOdometer=num(supporting.odometer)||null;
  return out;
}

async function scanDriverReceipt(file){
  try{
    const enhanced=await prepareReceiptForOcr(file);
    const enhancedResult=await scanReceiptFile(enhanced);
    if(!weakReceiptResult(enhancedResult))return enhancedResult;

    const originalResult=enhanced===file?{}:await scanReceiptFile(file);
    let merged=mergeClientReceiptResults(enhancedResult,originalResult);
    if(!weakReceiptResult(merged))return merged;

    const threshold=await prepareReceiptThresholdForOcr(file);
    if(threshold!==file){
      const thresholdResult=await scanReceiptFile(threshold);
      merged=mergeClientReceiptResults(merged,thresholdResult);
    }
    return merged||{};
  }catch{return{}}
}

async function openDriverSmartSlip(t,file){
  $('modalTitle').textContent='📷 Scan slip';
  $('entryForm').innerHTML='<div class="driver-scan-loading"><div class="driver-scan-camera">📷</div><h2>Reading main slip…</h2><p>Finding supplier, amount, litres and expense type.</p></div>';
  $('modal').classList.remove('hidden');
  const primary=await scanDriverReceipt(file);
  if($('modal').classList.contains('hidden'))return;
  renderDriverSmartSlip(t,file,null,primary,null,{});
}
function smartSlipDraft(){
  return{
    category:$('smartSlipCategory')?.value||'',
    amount:$('smartSlipAmount')?.value||'',
    supplier:$('smartSlipSupplier')?.value||'',
    receiptNo:$('smartSlipNumber')?.value||'',
    litres:$('smartSlipLitres')?.value||'',
    price:$('smartSlipPrice')?.value||'',
    odometer:$('smartSlipOdo')?.value||''
  };
}
function renderDriverSmartSlip(t,mainFile,supportFile,primary,supporting,draft={}){
  const x=mergeSupportingReceipt(primary,supporting);
  const categories=['Diesel','Toll','Meals','Accommodation','Parking','Border permit','Loading / offloading','Emergency repair','Other'];
  const fuelStructure=num(x.litres)>0||num(x.pricePerLitre)>0||(Array.isArray(x.fuelTransactions)&&x.fuelTransactions.length>0);
  const detected=fuelStructure&&(!x.category||x.category==='Other')?'Diesel':(categories.includes(x.category)?x.category:'Other');
  const confidence=fuelStructure&&detected==='Diesel'&&!x.needsReview
    ?Math.max(96,Math.max(0,Math.min(100,num(x.categoryConfidence))))
    :Math.max(0,Math.min(100,num(x.categoryConfidence)));
  const high=confidence>=85,medium=confidence>=65;
  const confidenceText=confidence?confidence+'% confidence':'Needs confirmation';
  const detectionClass=high?'high':medium?'medium':'low';
  const selectedCategory=draft.category||detected;
  const options=categories.map(c=>'<option value="'+esc(c)+'" '+(c===selectedCategory?'selected':'')+'>'+esc(c)+'</option>').join('');
  const val=(draftKey,scanValue)=>draft[draftKey]!==undefined&&draft[draftKey]!==''?draft[draftKey]:(scanValue??'');

  let fuelBreakdown='';
  if(detected==='Diesel'&&Array.isArray(x.fuelTransactions)&&x.fuelTransactions.length){
    fuelBreakdown='<div class="fuel-breakdown">'
      +'<div class="fuel-breakdown-head"><b>⛽ '+x.fuelTransactions.length+' fuel transaction'+(x.fuelTransactions.length===1?'':'s')+' on main slip</b><span>'+num(x.litres).toFixed(2)+' L total</span></div>'
      +x.fuelTransactions.map((it,i)=>'<div class="fuel-fill-row"><span>Fill '+(i+1)+'</span><b>'+num(it.litres).toFixed(2)+' L × N$'+num(it.pricePerLitre).toFixed(2)+'</b><strong>'+money(it.amount)+'</strong></div>').join('')
      +'<div class="fuel-total-row"><span>Receipt total</span><b>'+money(x.printedTotal||x.suggestedAmount)+'</b></div>'
      +(x.adjustment!==null&&x.adjustment!==undefined&&Math.abs(num(x.adjustment))>=.005?'<div class="fuel-adjustment-row"><span>Receipt adjustment</span><b>'+money(x.adjustment)+'</b></div>':'')
      +(x.needsReview?'<div class="fuel-review-warning">⚠ Numbers do not fully reconcile. Check litres, prices and receipt total before saving.</div>':'<div class="fuel-math-ok">✓ Fill amounts and receipt total reconcile</div>')
      +'</div>';
  }

  const supportInfo=supportFile
    ?'<div class="receipt-slot attached"><div><b>📎 Photo 2 · Supporting slip</b><small>'+((num(supporting?.odometer)>0)?'Odometer read: '+num(supporting.odometer).toFixed(0):'Scanned and merged with main slip')+'</small></div><div class="receipt-slot-actions"><button type="button" class="ghost small" id="retakeSupportReceipt">Retake</button><button type="button" class="ghost small" id="removeSupportReceipt">Remove</button></div></div>'
    :'<button type="button" class="receipt-slot add" id="addSupportReceipt"><span>＋</span><div><b>Add 2nd photo</b><small>Optional · odometer, payment receipt or attached supporting slip</small></div></button>';

  $('modalTitle').textContent='📷 Check slip';
  $('entryForm').innerHTML='<div class="driver-smart-slip">'
    +'<div class="driver-detection '+detectionClass+'" id="smartSlipDetection"><span>'+(high?'✨':medium?'🔎':'⚠️')+'</span><div><strong>Looks like: '+esc(detected)+'</strong><small>'+esc(confidenceText)+(x.categoryReason?' · '+esc(x.categoryReason):'')+'</small></div></div>'
    +'<div class="receipt-photo-slots"><div class="receipt-slot attached main"><div><b>📷 Photo 1 · Main slip</b><small>Required · fuel/expense details</small></div><span class="receipt-check">✓</span></div>'+supportInfo+'</div>'
    +(supportFile&&num(x.odometer)>0?'<div class="support-merge-note">✓ Odometer/details from Photo 2 merged into this record.</div>':'')
    +fuelBreakdown
    +'<label>What is this slip for?<select id="smartSlipCategory">'+options+'</select></label>'
    +'<div class="smart-slip-grid">'
      +'<label>'+(detected==='Diesel'?'Receipt total':'Amount')+'<input id="smartSlipAmount" type="number" inputmode="decimal" step="0.01" placeholder="N$ total" value="'+esc(String(val('amount',x.suggestedAmount)))+'"></label>'
      +'<label>Supplier / place<input id="smartSlipSupplier" value="'+esc(String(val('supplier',x.supplier)))+'" placeholder="Where did you pay?"></label>'
      +'<label>Slip / receipt no.<input id="smartSlipNumber" value="'+esc(String(val('receiptNo',x.documentNumber)))+'" placeholder="Optional"></label>'
    +'</div>'
    +'<div id="smartDieselFields" class="smart-diesel-fields">'
      +'<label>Total litres<input id="smartSlipLitres" type="number" inputmode="decimal" step="0.001" value="'+esc(String(val('litres',x.litres)))+'" placeholder="Litres"></label>'
      +'<label>Combined price / litre<input id="smartSlipPrice" type="number" inputmode="decimal" step="0.0001" value="'+esc(String(val('price',x.pricePerLitre)))+'" placeholder="N$ / L"></label>'
      +'<label>Odometer <small>(optional)</small><input id="smartSlipOdo" type="number" inputmode="numeric" value="'+esc(String(val('odometer',x.odometer)))+'" placeholder="km"></label>'
    +'</div>'
    +'<div class="driver-slip-note" id="smartSlipNote">'+(x.needsReview?'Please verify the highlighted receipt numbers before saving.':(high?'If this is correct, just press the green button.':'Please check the type and amount before saving.'))+'</div>'
    +'<div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="driver-save" id="saveSmartSlip">✓ CORRECT & SAVE</button></div>'
    +'</div>';

  const updateFields=()=>{
    const isDiesel=$('smartSlipCategory').value==='Diesel';
    $('smartDieselFields').classList.toggle('hidden',!isDiesel);
    if($('smartSlipCategory').value!==detected){
      $('smartSlipDetection').className='driver-detection changed';
      $('smartSlipDetection').innerHTML='<span>✓</span><div><strong>Changed to: '+esc($('smartSlipCategory').value)+'</strong><small>The app will remember this supplier after you save.</small></div>';
    }
  };
  $('smartSlipCategory').onchange=updateFields;
  updateFields();
  $('cancelForm').onclick=()=>$('modal').classList.add('hidden');

  const captureSupport=()=>driverCapture('receipt-supporting',async second=>{
    const keep=smartSlipDraft();
    $('entryForm').innerHTML='<div class="driver-scan-loading"><div class="driver-scan-camera">📎</div><h2>Reading 2nd slip…</h2><p>Looking for odometer, plate, references and missing receipt details.</p></div>';
    const secondResult=await scanDriverReceipt(second);
    renderDriverSmartSlip(t,mainFile,second,primary,secondResult,keep);
  });
  if($('addSupportReceipt'))$('addSupportReceipt').onclick=captureSupport;
  if($('retakeSupportReceipt'))$('retakeSupportReceipt').onclick=captureSupport;
  if($('removeSupportReceipt'))$('removeSupportReceipt').onclick=()=>renderDriverSmartSlip(t,mainFile,null,primary,null,smartSlipDraft());

  $('entryForm').onsubmit=async e=>{
    e.preventDefault();
    const category=$('smartSlipCategory').value,supplier=$('smartSlipSupplier').value.trim(),amount=num($('smartSlipAmount').value),receiptNo=$('smartSlipNumber').value.trim();
    const files=supportFile?[mainFile,supportFile]:[mainFile];
    if(category==='Diesel'){
      const litres=num($('smartSlipLitres').value),price=num($('smartSlipPrice').value)||(litres>0&&amount>0?amount/litres:0);
      if(litres<=0)return notify('Please enter diesel litres');
      if(amount<=0&&price<=0)return notify('Please enter the receipt total or price per litre');
      $('modal').classList.add('hidden');
      await sendDriverMultiPhotoAction(t.id,'diesel',files,'diesel',{
        litres,total:amount,price,odometer:num($('smartSlipOdo').value),supplier,slip:receiptNo,
        detectedCategory:detected,categoryConfidence:confidence,
        fuelTransactions:Array.isArray(x.fuelTransactions)?x.fuelTransactions:[],
        fuelTransactionCount:num(x.fuelTransactionCount)||1,
        printedTotal:num(x.printedTotal)||null,
        adjustment:x.adjustment===null||x.adjustment===undefined?null:num(x.adjustment)
      },'⛽ Diesel slip saved'+(supportFile?' · 2 photos attached':''));
    }else{
      if(amount<=0)return notify('Please enter the amount');
      $('modal').classList.add('hidden');
      await sendDriverMultiPhotoAction(t.id,'expense',files,'expense',{category,amount,supplier,receiptNo,detectedCategory:detected,categoryConfidence:confidence},'✓ '+category+' slip saved'+(supportFile?' · 2 photos attached':''));
    }
  };
}

function openDriverDiesel(t,file){$('modalTitle').textContent='⛽ Diesel slip';$('entryForm').innerHTML='<div class="driver-simple-form"><div class="driver-photo-ok" id="driverScanStatus">📷 Slip photo ready · reading details…</div><label>Litres<input id="drvLitres" type="number" inputmode="decimal" step="0.01" placeholder="e.g. 450"></label><label>Total amount<input id="drvTotal" type="number" inputmode="decimal" step="0.01" placeholder="N$ total"></label><label>Odometer <small>(optional)</small><input id="drvOdo" type="number" inputmode="numeric" placeholder="km"></label><label>Fuel station <small>(optional)</small><input id="drvSupplier" placeholder="Puma / Shell / Engen"></label><label>Slip number <small>(auto if readable)</small><input id="drvSlip" placeholder="Slip / invoice number"></label><div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="driver-save">✓ SAVE DIESEL</button></div></div>';$('modal').classList.remove('hidden');scanDriverReceipt(file).then(x=>{if(!$('drvLitres'))return;if(!$('drvLitres').value&&x.litres)$('drvLitres').value=x.litres;if(!$('drvTotal').value&&x.suggestedAmount)$('drvTotal').value=x.suggestedAmount;if(!$('drvSupplier').value&&x.supplier)$('drvSupplier').value=x.supplier;if(!$('drvSlip').value&&x.documentNumber)$('drvSlip').value=x.documentNumber;if($('driverScanStatus'))$('driverScanStatus').textContent=(x.litres||x.suggestedAmount||x.documentNumber)?'✨ Slip read — just check the details':'📷 Photo saved — enter anything the slip could not read'});$('cancelForm').onclick=()=>$('modal').classList.add('hidden');$('entryForm').onsubmit=async e=>{e.preventDefault();const litres=num($('drvLitres').value),total=num($('drvTotal').value);if(litres<=0)return notify('Enter litres');$('modal').classList.add('hidden');await sendDriverPhotoAction(t.id,'diesel',file,'diesel',{litres,total,odometer:num($('drvOdo').value),supplier:$('drvSupplier').value,slip:$('drvSlip').value},'Diesel saved')}}
function openDriverExpense(t,file){$('modalTitle').textContent='💵 Route expense';$('entryForm').innerHTML='<div class="driver-simple-form"><div class="driver-photo-ok" id="driverScanStatus">📷 Receipt photo ready · reading amount…</div><label>What was it for?<select id="drvExpenseType"><option>Toll</option><option>Border permit</option><option>Parking</option><option>Loading / offloading</option><option>Accommodation</option><option>Meals</option><option>Emergency repair</option><option>Other</option></select></label><label>Amount<input id="drvExpenseAmount" type="number" inputmode="decimal" step="0.01" placeholder="N$ amount"></label><label>Place <small>(optional)</small><input id="drvExpensePlace" placeholder="Where did you pay?"></label><label>Receipt number <small>(auto if readable)</small><input id="drvReceiptNo" placeholder="Receipt / invoice number"></label><div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="driver-save">✓ SAVE EXPENSE</button></div></div>';$('modal').classList.remove('hidden');scanDriverReceipt(file).then(x=>{if(!$('drvExpenseAmount'))return;if(!$('drvExpenseAmount').value&&x.suggestedAmount)$('drvExpenseAmount').value=x.suggestedAmount;if(!$('drvReceiptNo').value&&x.documentNumber)$('drvReceiptNo').value=x.documentNumber;if($('driverScanStatus'))$('driverScanStatus').textContent=(x.suggestedAmount||x.documentNumber)?'✨ Receipt read — just check the details':'📷 Photo saved — enter anything the receipt could not read'});$('cancelForm').onclick=()=>$('modal').classList.add('hidden');$('entryForm').onsubmit=async e=>{e.preventDefault();const amount=num($('drvExpenseAmount').value);if(amount<=0)return notify('Enter the amount');$('modal').classList.add('hidden');await sendDriverPhotoAction(t.id,'expense',file,'expense',{category:$('drvExpenseType').value,amount,supplier:$('drvExpensePlace').value,receiptNo:$('drvReceiptNo').value},'Expense saved')}}
function driverSpeechTo(target){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return notify('Voice typing is not supported on this phone');const r=new SR();r.lang='en-ZA';r.interimResults=false;r.onresult=e=>{target.value=(target.value+' '+e.results[0][0].transcript).trim()};r.onerror=()=>notify('Could not hear you. Please try again.');r.start()}
function openDriverProblem(t){const types=['🛞 Tyre','🔧 Breakdown','⏱ Delay','📦 Load / cargo','💥 Accident','❓ Other'];$('modalTitle').textContent='⚠ Report a problem';$('entryForm').innerHTML='<div class="driver-problem"><p>Tap what went wrong:</p><div class="driver-problem-grid">'+types.map(x=>'<button type="button" class="driver-problem-type">'+x+'</button>').join('')+'</div><input id="drvProblemType" type="hidden"><label>Explain quickly<textarea id="drvProblemText" rows="4" placeholder="You can type or speak…"></textarea></label><div class="driver-inline"><button type="button" class="ghost" id="driverProblemSpeak">🎤 SPEAK</button><button type="button" class="ghost" id="driverProblemPhoto">📷 PHOTO</button></div><div id="driverProblemPhotoReady" class="driver-photo-ok hidden">📷 Photo ready</div><div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="danger">SEND TO OFFICE</button></div></div>';$('modal').classList.remove('hidden');let photo=null;document.querySelectorAll('.driver-problem-type').forEach(b=>b.onclick=()=>{document.querySelectorAll('.driver-problem-type').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');$('drvProblemType').value=b.textContent.replace(/^[^ ]+ /,'')});$('driverProblemSpeak').onclick=()=>driverSpeechTo($('drvProblemText'));$('driverProblemPhoto').onclick=()=>driverCapture('problem',f=>{photo=f;$('driverProblemPhotoReady').classList.remove('hidden')});$('cancelForm').onclick=()=>$('modal').classList.add('hidden');$('entryForm').onsubmit=async e=>{e.preventDefault();const type=$('drvProblemType').value||'Other',description=$('drvProblemText').value.trim()||type;$('modal').classList.add('hidden');if(photo)await sendDriverPhotoAction(t.id,'problem',photo,'problem',{type,description},'Problem sent to office');else await sendDriverAction(t.id,'problem',{type,description},'Problem sent to office')}}
function openDriverHelp(){const d=get('drivers',currentDriver());$('modalTitle').textContent='Driver account';$('entryForm').innerHTML='<div class="driver-help"><div class="driver-avatar">👤</div><h2>'+esc(d.name||sessionUser?.name||'Driver')+'</h2><p>Signed in as <b>'+esc(sessionUser?.email||'')+'</b>. Your assigned trip and values load automatically when you sign in.</p><a class="driver-call-big" href="tel:+264811299942">📞 CALL OFFICE</a><button type="button" class="driver-switch-account" id="driverSwitchAccount">↪ LOG OUT / SWITCH DRIVER</button><button type="button" class="ghost" id="cancelForm">Close</button></div>';$('modal').classList.remove('hidden');$('cancelForm').onclick=()=>$('modal').classList.add('hidden');$('driverSwitchAccount').onclick=()=>{$('modal').classList.add('hidden');logout()}}
function driverTripPriority(t){
  const status=String(t.status||'').toLowerCase();
  if(/loading|in transit|at offloading|return journey/.test(status))return 500;
  if(/planned|assigned|booked/.test(status))return 400;
  if(/delivered/.test(status)&&!t.pod)return 250;
  if(/delivered/.test(status)&&!t.driverComplete)return 200;
  return 100
}
function driverTripSort(a,b){
  const p=driverTripPriority(b)-driverTripPriority(a);if(p)return p;
  const bd=new Date(b.createdAt||b.date||0).getTime()||0,ad=new Date(a.createdAt||a.date||0).getTime()||0;
  if(bd!==ad)return bd-ad;
  return String(b.number||'').localeCompare(String(a.number||''),undefined,{numeric:true})
}
function driverPortal(){
  const preview=role!=='driver';
  const did=preview?(driverPreviewId||currentDriver()):currentDriver();
  const d=get('drivers',did);
  const mine=db.trips.filter(t=>t.driverId===did&&!t.driverComplete&&!['Closed','Invoiced'].includes(t.status)).sort(driverTripSort);
  const t=mine[0],legs=t?tripLegs(t):[],leg=t?activeJourneyLeg(t):null;
  const next=t?driverNextStep(t):null;
  const pending=db.tasks.filter(x=>x.ownerRole==='Driver'&&x.status==='Open'&&(!t||x.linkedId===t.id)).length;
  const selector=preview?`<div class="driver-preview-bar">
    <div><b>ADMIN PREVIEW MODE</b><small>Buttons are disabled. The driver must sign in with their own account to submit actions.</small></div>
    <div class="driver-preview-controls">
      <select id="driverPreviewSelect">${db.drivers.map(x=>`<option value="${x.id}" ${x.id===did?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
      <button class="primary small nav-to" data-page="driverAccounts">Manage driver logins</button>
    </div>
  </div>`:'';
  const quick=t?`<div class="driver-quick-actions">
    <button class="driver-scan-slip" ${preview?'disabled':''} data-driver-quick="scan" data-trip="${t.id}"><span>📷</span><strong>SCAN SLIP</strong><small>Diesel · food · toll · parking · more</small></button>
    <button ${preview?'disabled':''} data-driver-quick="problem" data-trip="${t.id}"><span>⚠</span><strong>PROBLEM</strong><small>Tell office</small></button>
    <a href="tel:+264811299942"><span>📞</span><strong>CALL</strong><small>Office</small></a>
  </div>`:'';
  const bottom=!preview?`<nav class="driver-bottom">
    <button class="nav-to active" data-page="driverPortal">🚛<span>Trip</span></button>
    <button class="nav-to" data-page="notifications">🔔<span>Alerts</span></button>
    <button type="button" id="driverHelpBtn">👤<span>Help</span></button>
    <button type="button" id="driverLogoutBottom">↪<span>Log out</span></button>
  </nav>`:'';
  const podSaved=leg?.pod||(!leg&&t?.pod);
  return `<div class="driver-shell">
    ${selector}
    <section class="driver-welcome">
      <div><small>${preview?'PREVIEWING DRIVER':'GOOD DAY'}</small><h1>${esc(d.name||'Driver')}</h1></div>
      <div class="driver-welcome-actions">
        <span class="driver-online ${navigator.onLine?'on':'off'}">${nativeBackgroundGpsAvailable()?'● BACKGROUND GPS':(navigator.onLine?'● ONLINE':'● OFFLINE')}</span>
        ${!preview?'<button type="button" class="driver-logout-top" id="driverLogoutTop">Log out</button>':''}
      </div>
    </section>
    ${t?`<section class="driver-trip-card">
      <div class="driver-trip-top"><div><small>${legs.length>1?`CURRENT LEG ${num(leg?.sequence)}/${legs.length}`:'CURRENT TRIP'}</small><h2>${esc(t.number)} · ${esc(truck(t.truckId))}</h2></div>${badge(leg?.status||t.status)}</div>
      <div class="driver-route">${esc(route(leg?.routeId||t.routeId))}</div>
      <div class="driver-trip-meta"><span>📦 ${esc(leg?.load||t.load||'Load')}</span><span>🏢 ${esc(client(leg?.clientId||t.clientId))}</span></div>
      ${legs.length>1?`<div class="driver-leg-progress">${legs.map(x=>`<span class="${x.id===leg?.id?'current':x.pod?'done':''}">${x.sequence}</span>`).join('')}</div>`:''}
      <button class="driver-next" data-driver-main="${next.key}" data-trip="${t.id}" ${(preview||next.key==='complete'||next.key==='geo')?'disabled':''}>
        <span>${next.icon}</span><strong>${next.label}</strong><small>${preview?'Preview only · log in as driver to use this button':next.sub}</small>
      </button>
      ${quick}
      <div class="driver-small-status"><span>📍 Location updates automatically</span><span>${podSaved?'✅ This leg POD saved':'📷 POD required for this leg'}</span></div>
    </section>`:`<section class="driver-no-trip"><div>✅</div><h2>No active trip</h2><p>${esc(d.name||'This driver')} has no active trip at the moment.</p>${preview?'<button class="primary nav-to" data-page="driverAccounts">Manage driver login</button>':'<a href="tel:+264811299942">📞 CALL OFFICE</a>'}</section>`}
    ${pending?`<div class="driver-reminder">🔔 ${pending} action${pending===1?'':'s'} still required for this journey</div>`:''}
    ${bottom}
  </div>`;
}
function uploadKindLabel(kind){
  const k=String(kind||'document').toLowerCase();
  if(k.includes('pod'))return 'POD';
  if(k.includes('diesel'))return 'Diesel receipt';
  if(k.includes('expense')||k.includes('receipt'))return 'Expense receipt';
  if(k.includes('problem'))return 'Problem photo';
  if(k.includes('support'))return 'Supporting receipt';
  return String(kind||'Document').replace(/[-_]/g,' ');
}
function uploadSize(bytes){
  const n=num(bytes);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(1)+' MB';
}
function uploadTripLabel(id){const t=get('trips',id);return t.id?t.number:String(id||'—')}
function uploadDriverLabel(u){return u.driverId?driver(u.driverId):(u.userName||'Driver')}
function driverUploadRows(rows){
  return '<div class="driver-upload-grid">'+(rows.length?rows.map(u=>{
    const canRecover=!u.posted&&!/support/i.test(String(u.kind||''))&&/diesel|expense|receipt/i.test(String(u.kind||''));
    const canMove=u.posted&&/diesel|expense/i.test(String(u.linkedRecordType||u.kind||''));
    const status=u.posted
      ?'<span class="upload-posted">✓ POSTED TO '+esc(uploadTripLabel(u.tripId))+'</span>'
      :'<span class="upload-file-only">⚠ FILE ONLY · VALUES NOT POSTED</span>';
    return '<article class="driver-upload-card">'
      +'<div class="driver-upload-icon">'+(String(u.mimeType||'').startsWith('image/')?'🖼️':String(u.mimeType||'').includes('pdf')?'📄':'📎')+'</div>'
      +'<div class="driver-upload-info"><div class="driver-upload-top"><b>'+esc(uploadKindLabel(u.kind))+'</b><span>'+esc(uploadTripLabel(u.tripId))+'</span></div>'
      +'<h3>'+esc(u.filename||'Driver file')+'</h3>'
      +'<p>👤 '+esc(uploadDriverLabel(u))+' · '+esc(uploadSize(u.size))+'</p>'
      +'<small>'+esc(u.createdAt?new Date(u.createdAt).toLocaleString():'')+'</small>'+status+'</div>'
      +'<div class="driver-upload-actions"><button class="ghost small view-driver-upload" data-id="'+u.id+'">View</button>'
      +(canRecover?'<button class="primary small recover-driver-upload" data-id="'+u.id+'">Recover values</button>':'')
      +(canMove?'<button class="ghost small move-driver-upload" data-id="'+u.id+'">Move to trip</button>':'')
      +'</div></article>'
  }).join(''):'<div class="empty">No driver files uploaded yet.</div>')+'</div>';
}
function driverUploadsPage(){
  if(!driverUploadsLoaded)setTimeout(()=>loadDriverUploads(),0);
  const receipts=driverUploads.filter(x=>/diesel|expense|receipt|support/i.test(x.kind)).length;
  const pods=driverUploads.filter(x=>/pod/i.test(x.kind)).length;
  const problems=driverUploads.filter(x=>/problem/i.test(x.kind)).length;
  return '<section class="kpis">'
    +kpi('Driver files',driverUploads.length,'Stored in PostgreSQL')
    +kpi('Receipts',receipts,'Diesel & route expenses')
    +kpi('PODs',pods,'Proof of delivery')
    +kpi('Problem photos',problems,'Trip issues & defects')
    +'</section><section class="panel"><div class="toolbar"><div><h2>Driver Uploads</h2><p class="muted-copy">Driver captures are compressed and archived as compact PDFs where possible, linked to the driver and journey.</p></div><div><input id="driverUploadSearch" placeholder="Search driver, trip, file or type"> <button class="ghost" id="refreshDriverUploads">Refresh</button></div></div><div id="driverUploadResults">'+driverUploadRows(driverUploads)+'</div></section>';
}
async function loadDriverUploads(force=false){
  if(driverUploadsLoaded&&!force)return;
  try{driverUploads=await api('/api/driver/uploads?limit=300');driverUploadsLoaded=true;if(page==='driverUploads')render()}catch(e){notify(e.message)}
}
async function openDriverUpload(id){
  const meta=driverUploads.find(x=>x.id===id);if(!meta)return;
  try{
    const res=await fetch('/api/driver/uploads/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+authToken},cache:'no-store'});
    if(!res.ok){const d=await res.json().catch(()=>({}));throw Error(d.error||'Could not open file')}
    const blob=await res.blob();
    if(activeUploadObjectUrl)URL.revokeObjectURL(activeUploadObjectUrl);
    activeUploadObjectUrl=URL.createObjectURL(blob);
    $('modalTitle').textContent=uploadKindLabel(meta.kind)+' · '+uploadTripLabel(meta.tripId);
    const image=String(meta.mimeType||blob.type).startsWith('image/');
    const pdf=String(meta.mimeType||blob.type).includes('pdf');
    const preview=image?'<img class="driver-upload-preview" src="'+activeUploadObjectUrl+'" alt="">':pdf?'<iframe class="driver-upload-frame" src="'+activeUploadObjectUrl+'"></iframe>':'<div class="driver-upload-file-icon">📎</div>';
    $('entryForm').innerHTML='<div class="driver-upload-view">'+preview+'<div class="driver-upload-meta"><b>'+esc(meta.filename||'Driver file')+'</b><span>Driver: '+esc(uploadDriverLabel(meta))+'</span><span>Trip: '+esc(uploadTripLabel(meta.tripId))+'</span><span>Type: '+esc(uploadKindLabel(meta.kind))+'</span><span>Uploaded: '+esc(meta.createdAt?new Date(meta.createdAt).toLocaleString():'')+'</span></div><div class="form-actions"><a class="ghost button-like" href="'+activeUploadObjectUrl+'" target="_blank" rel="noopener">Open full size</a><button type="button" class="primary" id="cancelForm">Close</button></div></div>';
    $('modal').classList.remove('hidden');
    $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  }catch(e){notify(e.message)}
}
async function recoverDriverUpload(id){
  const meta=driverUploads.find(x=>x.id===id);if(!meta)return;
  $('modalTitle').textContent='Recover slip values · '+uploadTripLabel(meta.tripId);
  $('entryForm').innerHTML='<div class="driver-scan-loading"><div class="driver-scan-camera">🔎</div><h2>Re-reading stored slip…</h2><p>The original driver upload is being scanned again. You will confirm the values before they are posted.</p></div>';
  $('modal').classList.remove('hidden');
  try{
    const result=await api('/api/admin/driver-uploads/'+encodeURIComponent(id)+'/scan',{method:'POST'}),x=result.extracted||{};
    const categories=['Diesel','Toll','Meals','Accommodation','Parking','Border permit','Loading / offloading','Emergency repair','Other'];
    const defaultCategory=/diesel/i.test(String(meta.kind||''))?'Diesel':(categories.includes(x.category)?x.category:'Other');
    const opts=categories.map(c=>'<option value="'+esc(c)+'" '+(c===defaultCategory?'selected':'')+'>'+esc(c)+'</option>').join('');
    $('entryForm').innerHTML='<div class="driver-smart-slip">'
      +'<div class="notice"><b>This file was uploaded, but its values were not posted to the trip.</b><br>Check the values below, then save them to '+esc(uploadTripLabel(meta.tripId))+'.</div>'
      +'<label>Slip type<select id="recoverCategory">'+opts+'</select></label>'
      +'<div class="smart-slip-grid"><label>Amount<input id="recoverAmount" type="number" step="0.01" value="'+esc(String(x.suggestedAmount||''))+'"></label>'
      +'<label>Supplier<input id="recoverSupplier" value="'+esc(String(x.supplier||''))+'"></label>'
      +'<label>Receipt number<input id="recoverNumber" value="'+esc(String(x.documentNumber||''))+'"></label></div>'
      +'<div id="recoverDieselFields" class="smart-diesel-fields"><label>Total litres<input id="recoverLitres" type="number" step="0.001" value="'+esc(String(x.litres||''))+'"></label>'
      +'<label>Price / litre<input id="recoverPrice" type="number" step="0.0001" value="'+esc(String(x.pricePerLitre||''))+'"></label>'
      +'<label>Odometer<input id="recoverOdo" type="number" value="'+esc(String(x.odometer||''))+'"></label></div>'
      +'<div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="driver-save">✓ POST VALUES TO TRIP</button></div></div>';
    const toggle=()=>$('recoverDieselFields').classList.toggle('hidden',$('recoverCategory').value!=='Diesel');
    $('recoverCategory').onchange=toggle;toggle();
    $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
    $('entryForm').onsubmit=async e=>{
      e.preventDefault();
      const category=$('recoverCategory').value,amount=num($('recoverAmount').value),supplier=$('recoverSupplier').value.trim(),receiptNo=$('recoverNumber').value.trim();
      let action='expense',data={category,amount,supplier,receiptNo,detectedCategory:x.category||category,categoryConfidence:num(x.categoryConfidence)};
      if(category==='Diesel'){
        const litres=num($('recoverLitres').value),price=num($('recoverPrice').value)||(litres>0&&amount>0?amount/litres:0);
        if(litres<=0)return notify('Enter diesel litres');
        if(amount<=0&&price<=0)return notify('Enter receipt total or price per litre');
        action='diesel';data={litres,total:amount,price,odometer:num($('recoverOdo').value),supplier,slip:receiptNo,detectedCategory:'Diesel',categoryConfidence:num(x.categoryConfidence),fuelTransactions:Array.isArray(x.fuelTransactions)?x.fuelTransactions:[],fuelTransactionCount:num(x.fuelTransactionCount)||1,printedTotal:num(x.printedTotal)||amount||null,adjustment:x.adjustment===null||x.adjustment===undefined?null:num(x.adjustment)}
      }else if(amount<=0)return notify('Enter the expense amount');
      const posted=await api('/api/admin/driver-uploads/'+encodeURIComponent(id)+'/post',{method:'POST',body:{action,data}});
      $('modal').classList.add('hidden');
      await refreshCentralState(false);
      driverUploadsLoaded=false;await loadDriverUploads(true);
      notify((posted.number||'Trip')+' values updated');
    };
  }catch(e){$('modal').classList.add('hidden');notify(e.message)}
}
async function moveDriverUpload(id){
    const meta=driverUploads.find(x=>x.id===id);if(!meta)return;
    const candidates=db.trips.filter(t=>t.id!==meta.tripId&&(!meta.driverId||t.driverId===meta.driverId)&&!['Closed'].includes(t.status)).sort((a,b)=>new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0));
    if(!candidates.length)return notify('No other trip found for this driver');
    $('modalTitle').textContent='Move posted receipt';
    $('entryForm').innerHTML='<div class="driver-upload-move"><div class="notice"><b>Currently posted to '+esc(uploadTripLabel(meta.tripId))+'.</b><br>Moving this receipt also moves its diesel/expense values and any supporting photo, then recalculates both trips.</div>'
      +'<label>Move to trip<select id="moveUploadTrip">'+candidates.map(t=>'<option value="'+t.id+'">'+esc(t.number)+' · '+esc(t.status)+' · '+esc(route(t.routeId))+' · '+esc(truck(t.truckId))+'</option>').join('')+'</select></label>'
      +'<div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="driver-save">✓ MOVE RECEIPT & VALUES</button></div></div>';
    $('modal').classList.remove('hidden');
    $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
    $('entryForm').onsubmit=async e=>{
      e.preventDefault();
      const targetTripId=$('moveUploadTrip').value;
      if(!targetTripId)return notify('Choose a trip');
      try{
        const r=await api('/api/admin/driver-uploads/'+encodeURIComponent(id)+'/move',{method:'POST',body:{targetTripId}});
        $('modal').classList.add('hidden');
        await refreshCentralState(false);
        driverUploadsLoaded=false;await loadDriverUploads(true);
        notify((r.sourceNumber||'Receipt')+' → '+(r.targetNumber||'trip')+' moved and totals recalculated');
      }catch(err){notify(err.message)}
    };
  }
function wireDriverUploadButtons(){
  document.querySelectorAll('.view-driver-upload').forEach(b=>b.onclick=()=>openDriverUpload(b.dataset.id));
  document.querySelectorAll('.recover-driver-upload').forEach(b=>b.onclick=()=>recoverDriverUpload(b.dataset.id));
  document.querySelectorAll('.move-driver-upload').forEach(b=>b.onclick=()=>moveDriverUpload(b.dataset.id));
}
function wireDriverUploads(){
  if($('refreshDriverUploads'))$('refreshDriverUploads').onclick=()=>loadDriverUploads(true);
  if($('driverUploadSearch'))$('driverUploadSearch').oninput=e=>{
    const q=String(e.target.value||'').toLowerCase().trim();
    const rows=!q?driverUploads:driverUploads.filter(u=>[uploadKindLabel(u.kind),u.filename,uploadTripLabel(u.tripId),uploadDriverLabel(u),u.posted?'posted':'file only'].join(' ').toLowerCase().includes(q));
    $('driverUploadResults').innerHTML=driverUploadRows(rows);
    wireDriverUploadButtons();
  };
  wireDriverUploadButtons();
}
function fleet(){return `<section class="kpis">${kpi('Available',db.trucks.filter(t=>t.status==='Available').length,'Ready for dispatch')}${kpi('On work',db.trucks.filter(t=>/trip|duty/i.test(t.status)).length,'Currently allocated')}${kpi('GPS online',db.trucks.filter(t=>t.gps==='Online').length,`${db.trucks.length} registered`)}${kpi('Service due',serviceDue().length,'Within 5,000 km')}</section><div class="cards-list">${db.trucks.map(t=>`<article class="entity-card"><div class="panel-head"><h3>${esc(t.registration)}</h3>${badge(t.status)}</div><p>${esc(t.make)} · ${esc(t.type)}</p><p><span class="status-dot ${t.gps==='Online'?'':'bad'}"></span>GPS ${esc(t.gps)}</p><div class="metric-line"><span>Odometer</span><b>${num(t.odometer).toLocaleString()} km</b></div><div class="metric-line"><span>Next service</span><b>${num(t.serviceDue).toLocaleString()} km</b></div><div class="metric-line"><span>Trips</span><b>${db.trips.filter(x=>x.truckId===t.id).length}</b></div></article>`).join('')}</div>`}
function diesel(){const litres=sum(db.diesel,x=>x.litres),spend=sum(db.diesel,fuelRecordCost);return `<section class="kpis">${kpi('Fuel spend',money(spend),'Verified and pending')}${kpi('Litres',litres.toLocaleString()+' L',`${db.diesel.length} entries`)}${kpi('Average price',money(litres?spend/litres:0),'Per litre')}${kpi('Below target',db.trips.filter(t=>fuelEfficiency(t.id)&&fuelEfficiency(t.id)<db.settings.targetKml).length,`Target ${db.settings.targetKml} km/L`,'warning')}</section>${dataTable('Diesel entries','diesel',['Date','Trip','Truck','Driver','Litres','Price','km/L','L/km','L/100 km','Status'],db.diesel,x=>{const m=fuelMetrics(x.tripId);return[x.date,get('trips',x.tripId).number||'—',truck(x.truckId),driver(x.driverId),`${num(x.litres).toLocaleString()} L`,money(x.price),m.ready?m.kmPerL.toFixed(2):'—',m.ready?m.litresPerKm.toFixed(3):'—',m.ready?m.litresPer100Km.toFixed(1):'—',x.verified?'Verified':'Review']})}`}
function inspections(){return `<div class="panel"><div class="toolbar"><h2>Safety inspections & defects</h2><button class="primary add-record" data-type="inspection">+ Start inspection</button></div>${table(['Date','Type','Vehicle','Driver','Trip','Score','Defects','Status'],db.inspections,x=>[x.date,x.type,truck(x.truckId),driver(x.driverId),get('trips',x.tripId).number||'—',`${num(x.score)}%`,x.defects||'None',x.status])}</div>`}
function workshop(){return `<section class="kpis">${kpi('Open work orders',db.maintenance.filter(x=>x.status!=='Completed').length,'Workshop queue')}${kpi('Service due',serviceDue().length,'Within 5,000 km')}${kpi('Maintenance spend',money(sum(db.maintenance,x=>x.cost)),'Linked to vehicles')}${kpi('Inspection defects',db.inspections.filter(x=>x.defects).length,'Needs review')}</section>${dataTable('Maintenance & service','maintenance',['Date','Vehicle','Work','Supplier','Odometer','Cost','Next service','Status'],db.maintenance,x=>[x.date,truck(x.truckId),x.type,x.supplier,num(x.odometer).toLocaleString(),money(x.cost),num(x.nextService).toLocaleString(),x.status])}`}
function tyres(){return dataTable('Tyre register','tyre',['Serial','Vehicle','Position','Brand','Fitted KM','Current KM','Life used','Cost','Status'],db.tyres,x=>[x.serial,truck(x.truckId),x.position,x.brand,num(x.fittedKm).toLocaleString(),num(x.currentKm).toLocaleString(),`${Math.max(0,num(x.currentKm)-num(x.fittedKm)).toLocaleString()} km`,money(x.cost),x.status])}
function documentOwnerLabel(x){
  if(x.ownerType==='truck')return truck(x.ownerId);
  if(x.ownerType==='trailer')return trailer(x.ownerId);
  if(x.ownerType==='driver')return driver(x.ownerId);
  if(x.ownerType==='company')return db.company.name;
  return x.ownerId||'—'
}
function crossBorderTrips(){
  return db.trips.filter(t=>tripLegs(t).some(l=>get('routes',l.routeId).crossBorder)).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
}
function packDoc(kind,legId=''){
  return legId?crossBorderDocs.find(x=>x.kind===kind&&x.legId===legId)||null:crossBorderDocs.find(x=>x.kind===kind&&!x.legId)||null
}
function permitFor(ownerType,ownerId,matcher){
  return (db.permits||[]).filter(x=>(!ownerType||x.ownerType===ownerType)&&(!ownerId||x.ownerId===ownerId)&&matcher.test(String(x.type||''))).sort((a,b)=>String(b.expiry||'').localeCompare(String(a.expiry||'')))[0]||null
}
function packAutoState(expiry,label='Valid record'){
  if(!expiry)return{status:'Missing',tone:'bad',detail:'Not recorded'};
  const d=daysUntil(expiry);
  if(d<0)return{status:'Expired',tone:'bad',detail:'Expired '+Math.abs(d)+' day(s) ago'};
  if(d<45)return{status:'Expiring',tone:'warn',detail:label+' · '+d+' day(s) left'};
  return{status:'Check copy',tone:'warn',detail:label+' · valid to '+expiry}
}
function crossBorderPackItems(t){
  if(!t?.id)return[];
  const tr=get('trucks',t.truckId),trl=get('trailers',t.trailerId),dr=get('drivers',t.driverId),items=[];
  const docItem=(kind,title,group,required=true,legId='',detail='')=>{
    const d=packDoc(kind,legId);
    return{kind,title,group,required,legId,doc:d,status:d?'Ready':required?'Missing':'If applicable',tone:d?'good':required?'bad':'muted',detail:d?(d.reference||d.filename||'Saved to trip pack'):detail}
  };
  const autoItem=(kind,title,group,auto,required=true,legId='',detail='')=>{
    const d=packDoc(kind,legId);
    if(d)return{kind,title,group,required,legId,doc:d,status:'Ready',tone:'good',detail:d.reference||d.filename||'Saved to trip pack'};
    return{kind,title,group,required,legId,doc:null,status:auto.status,tone:auto.tone,detail:auto.detail||detail}
  };
  const cbPermit=permitFor('truck',t.truckId,/cross.?border.*permit|road transport.*permit|international.*permit/i)||permitFor('company','',/cross.?border.*permit|road transport.*permit/i);
  const truckReg=permitFor('truck',t.truckId,/registration certificate|vehicle registration/i);
  const truckLicence=permitFor('truck',t.truckId,/operator card|vehicle licen[cs]e|licen[cs]e disk/i);
  const truckInsurance=permitFor('truck',t.truckId,/insurance/i);
  items.push(docItem('company-authorization','Company authorization letter','Vehicle & authority',true,'','Generate, print, sign and place the signed copy in the pack.'));
  items.push(autoItem('cross-border-permit','Namibia cross-border road transport permit','Vehicle & authority',cbPermit?packAutoState(cbPermit.expiry,'Permit '+(cbPermit.reference||'')):{status:'Missing',tone:'bad',detail:'No valid cross-border permit recorded'},true));
  items.push(autoItem('truck-registration','Truck registration certificate','Vehicle & authority',truckReg?packAutoState(truckReg.expiry||'2999-12-31','Registration '+(truckReg.reference||'')):{status:'Missing',tone:'bad',detail:'Attach/capture the truck registration certificate'},true));
  if(t.trailerId)items.push(docItem('trailer-registration','Trailer registration certificate','Vehicle & authority',true,'','Attach the certificate for '+trailer(t.trailerId)+'.'));
  items.push(autoItem('vehicle-licence-operator','Vehicle licence & operator card','Vehicle & authority',truckLicence?packAutoState(truckLicence.expiry||tr.licenseExpiry,'Licence '+(truckLicence.reference||'')):packAutoState(tr.licenseExpiry,'Vehicle licence record'),true));
  items.push(autoItem('roadworthy','Roadworthy certificate','Vehicle & authority',packAutoState(tr.roadworthyExpiry,'Truck roadworthy record'),true));
  items.push(autoItem('insurance','Cross-border / vehicle insurance proof','Vehicle & authority',truckInsurance?packAutoState(truckInsurance.expiry||'2999-12-31','Insurance '+(truckInsurance.reference||'')):{status:'Missing',tone:'bad',detail:'Attach proof of insurance valid for the journey'},true));
  items.push(docItem('financier-permission','Financier / registered-owner permission','Vehicle & authority',false,'','Needed if the company is not the registered owner or the vehicle is financed and permission is required.'));
  items.push(autoItem('driver-licence-prdp','Driver licence + PrDP','Driver',dr.license?packAutoState(dr.prdpExpiry,'Licence '+dr.license+' · PrDP'):{status:'Missing',tone:'bad',detail:'Driver licence/PrDP not recorded'},true));
  items.push(autoItem('passport','Driver passport','Driver',packAutoState(dr.passportExpiry,'Passport record'),true));
  items.push(docItem('sars-tms','SARS TMS foreign-vehicle declaration reference','South Africa vehicle declaration',true,'','Required for foreign-registered vehicles entering/leaving South Africa under the current SARS process.'));
  const cbLegs=tripLegs(t).filter(l=>get('routes',l.routeId).crossBorder);
  cbLegs.forEach((leg,index)=>{
    const legId=leg.legacy?'':leg.id,tag='Leg '+leg.sequence+' · '+route(leg.routeId)+' · '+client(leg.clientId);
    items.push(docItem('customs-declaration','Customs clearance declaration (SAD 500 / applicable entry)','Cargo · '+tag,true,legId,'Customs declaration for '+(leg.load||'the cargo')+'.'));
    items.push(docItem('road-freight-manifest','Road freight manifest / eRFM / DA187 reference','Cargo · '+tag,true,legId,'Road freight manifest for this border crossing.'));
    items.push(docItem('commercial-invoice','Commercial / tax invoice','Cargo · '+tag,true,legId,'Invoice matching this consignment and client.'));
    items.push(docItem('waybill','Waybill / delivery note','Cargo · '+tag,true,legId,'Transport/delivery document matching the goods.'));
    items.push(docItem('packing-list','Packing list','Cargo · '+tag,false,legId,'Add when supplied or required for the consignment.'));
    items.push(docItem('cargo-permit','Commodity-specific import/export permit','Cargo · '+tag,false,legId,'Only when the commodity requires a permit or other authority.'));
  });
  return items
}
function packStatusLabel(item){
  const cls=item.tone==='good'?'pack-good':item.tone==='bad'?'pack-bad':item.tone==='warn'?'pack-warn':'pack-muted';
  return `<span class="pack-status ${cls}">${esc(item.status)}</span>`
}
function crossBorderPackPanel(t){
  const items=crossBorderPackItems(t),required=items.filter(x=>x.required),ready=required.filter(x=>x.status==='Ready').length,missing=required.filter(x=>x.status!=='Ready').length;
  const groups=[...new Set(items.map(x=>x.group))];
  return `<div class="border-pack-summary ${missing?'not-ready':'ready'}"><div><small>PACK STATUS</small><h3>${missing?missing+' required item(s) still need confirmation':'READY FOR FINAL BORDER CHECK'}</h3><p>${ready}/${required.length} required items confirmed in this trip pack.</p></div><div><b>${esc(t.number)}</b><span>${esc(truck(t.truckId))} · ${esc(driver(t.driverId))}</span></div></div>
  <div class="border-pack-actions"><button class="primary" id="printBorderPack">🖨 Prepare / Print pack</button><button class="ghost" id="printAuthorization">Generate authorization letter</button><button class="ghost" id="refreshBorderPack">↻ Refresh</button></div>
  ${groups.map(g=>`<section class="border-pack-group"><h3>${esc(g)}</h3>${items.filter(x=>x.group===g).map(x=>`<div class="border-pack-item">
    <div class="border-pack-state">${packStatusLabel(x)}</div>
    <div class="border-pack-copy"><b>${esc(x.title)}</b><small>${esc(x.detail||'')}</small>${x.doc?`<span>${esc(x.doc.filename||x.doc.reference||'Saved')}</span>`:''}</div>
    <div class="border-pack-buttons">${x.doc?.filename?`<button class="ghost small view-pack-doc" data-id="${x.doc.id}">Open</button>`:''}<button class="ghost small attach-pack-doc" data-kind="${esc(x.kind)}" data-leg="${esc(x.legId||'')}" data-title="${esc(x.title)}">${x.doc?'Replace / reference':'Attach / confirm'}</button>${x.doc?`<button class="danger small delete-pack-doc" data-id="${x.doc.id}">Remove</button>`:''}</div>
  </div>`).join('')}</section>`).join('')}`
}
function documents(){
  const a=complianceAlerts(),trips=crossBorderTrips();
  if((!crossBorderPackTripId||!trips.some(x=>x.id===crossBorderPackTripId))&&trips.length)crossBorderPackTripId=trips[0].id;
  if(crossBorderPackTripId&&crossBorderDocsLoadedFor!==crossBorderPackTripId)setTimeout(()=>loadCrossBorderDocs(crossBorderPackTripId),0);
  const t=get('trips',crossBorderPackTripId);
  return `<div class="notice ${a.length?'red':''}">${a.length?`<b>${a.length} compliance item(s) need action.</b> Do not dispatch expired drivers or vehicles.`:'All captured compliance records are currently valid.'}</div>
  <div class="panel"><div class="toolbar"><div><h2>Compliance register</h2><p class="muted-copy">Reusable vehicle, trailer and driver records.</p></div><button class="primary add-record" data-type="permit">+ Add document record</button></div>${table(['Document','Owner','Reference','Issued','Expiry','Days left','Status'],db.permits,x=>[x.type,documentOwnerLabel(x),x.reference,x.issued,x.expiry,daysUntil(x.expiry),daysUntil(x.expiry)<0?'Expired':daysUntil(x.expiry)<45?'Expiring':'Valid'])}</div>
  <section class="panel" style="margin-top:18px"><div class="toolbar"><div><h2>Cross-border trip pack builder</h2><p class="muted-copy">Prepare one pack from the actual journey, vehicle, driver and cargo legs.</p></div>${trips.length?`<select id="borderPackTrip">${trips.map(x=>`<option value="${x.id}" ${x.id===crossBorderPackTripId?'selected':''}>${esc(x.number)} · ${esc(journeyRouteLabel(x))} · ${esc(truck(x.truckId))}</option>`).join('')}</select>`:''}</div>
  <div class="notice"><b>2026 South Africa check:</b> keep the vehicle declaration/TMS reference with the pack, and keep cargo customs declarations and road-freight manifest information for each applicable crossing. Cargo-specific permits still depend on the goods being carried.</div>
  ${trips.length&&t.id?crossBorderPackPanel(t):'<div class="empty">No cross-border journey found yet. Create/select a route marked Cross-border and assign it to a trip.</div>'}</section>`
}
async function loadCrossBorderDocs(tripId){
  if(!tripId)return;
  try{crossBorderDocs=await api('/api/trips/'+encodeURIComponent(tripId)+'/documents');crossBorderDocsLoadedFor=tripId;if(page==='documents')render()}catch(e){notify(e.message)}
}
function openPackDocumentUpload(tripId,kind,legId,title){
  $('modalTitle').textContent='Add to border pack · '+title;
  $('entryForm').innerHTML=`<div class="form-grid"><div class="field full"><label>Document / reference</label><input id="packReference" placeholder="Reference number or 'Paper copy confirmed'"></div><div class="field full"><label>Upload file <small>(PDF or photo, optional if reference is entered)</small></label><input id="packFile" type="file" accept="image/*,.pdf,application/pdf"></div><div class="form-actions full"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="primary">Save to trip pack</button></div></div>`;
  $('modal').classList.remove('hidden');$('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  $('entryForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(),file=$('packFile').files?.[0],reference=$('packReference').value.trim();if(!file&&!reference)return notify('Upload a file or enter a reference');fd.append('kind',kind);fd.append('reference',reference);if(legId)fd.append('legId',legId);if(file){const archived=await prepareArchiveImage(file,2000,.78);fd.append('document',archived,archived.name)}try{await api('/api/trips/'+encodeURIComponent(tripId)+'/documents',{method:'POST',body:fd});$('modal').classList.add('hidden');crossBorderDocsLoadedFor='';await loadCrossBorderDocs(tripId);notify(title+' added to '+get('trips',tripId).number)}catch(err){notify(err.message)}}
}
function viewPackDocument(id){window.open('/api/trip-documents/'+encodeURIComponent(id)+'?token='+encodeURIComponent(authToken),'_blank')}
async function deletePackDocument(id){if(!confirm('Remove this item from the trip pack?'))return;try{await api('/api/trip-documents/'+encodeURIComponent(id),{method:'DELETE'});crossBorderDocsLoadedFor='';await loadCrossBorderDocs(crossBorderPackTripId);notify('Removed from trip pack')}catch(e){notify(e.message)}}
function authorizationLetterHtml(t){
  const d=get('drivers',t.driverId),tr=get('trucks',t.truckId),trl=get('trailers',t.trailerId),legs=tripLegs(t);
  return `<h1>COMPANY AUTHORIZATION LETTER</h1><p><b>Date:</b> ${today()}</p><p>To whom it may concern,</p><p>${esc(db.company.name)} hereby authorizes <b>${esc(d.name)}</b>, holder of the company-recorded driver credentials, to operate the company vehicle <b>${esc(tr.registration||truck(t.truckId))}</b>${t.trailerId?` with trailer <b>${esc(trl.registration||trailer(t.trailerId))}</b>`:''} for the cross-border journey <b>${esc(t.number)}</b>.</p><p>The journey currently includes:</p><ul>${legs.map(l=>`<li><b>${esc(route(l.routeId))}</b> — ${esc(l.load||'cargo')} — ${esc(client(l.clientId))}</li>`).join('')}</ul><p>The driver is authorized to carry the vehicle and the above consignments on behalf of ${esc(db.company.name)}, subject to the applicable customs, transport, immigration and client requirements.</p><p>This letter does not replace any financier/title-holder permission, customs declaration, cross-border road transport permit or commodity-specific permit required for the journey.</p><div class="signature"><p>______________________________<br><b>Authorized signatory</b><br>${esc(db.company.name)}</p><p>Tel: ${esc(db.company.phone||'')}<br>Email: ${esc(db.company.email||'')}</p></div>`
}
function openPrintWindow(title,body){
  const w=window.open('','_blank','width=900,height=1000');if(!w)return notify('Allow pop-ups to prepare the pack');
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;color:#111;margin:34px;line-height:1.45}h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid #bbb;padding-bottom:6px}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{padding:7px;border:1px solid #ccc;text-align:left;font-size:12px}.good{font-weight:700}.bad{font-weight:700}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.box{border:1px solid #bbb;padding:12px}.signature{display:flex;justify-content:space-between;margin-top:50px}.page-break{page-break-before:always}.small{font-size:11px;color:#555}@media print{button{display:none}}</style></head><body>${body}<p><button onclick="window.print()">Print / Save PDF</button></p></body></html>`);w.document.close();w.focus()
}
function printAuthorizationLetter(t){openPrintWindow('Authorization '+t.number,authorizationLetterHtml(t))}
function printCrossBorderPack(t){
  const items=crossBorderPackItems(t),legs=tripLegs(t),missing=items.filter(x=>x.required&&x.status!=='Ready');
  const checklist=`<h1>CROSS-BORDER TRIP PACK · ${esc(t.number)}</h1><div class="meta"><div class="box"><b>Truck:</b> ${esc(truck(t.truckId))}<br><b>Trailer:</b> ${esc(trailer(t.trailerId))}<br><b>Driver:</b> ${esc(driver(t.driverId))}</div><div class="box"><b>Departure:</b> ${esc(t.date)}<br><b>Journey distance:</b> ${journeyDistance(t).toLocaleString()} km<br><b>Status:</b> ${missing.length?missing.length+' item(s) still need confirmation':'Ready for final border check'}</div></div><h2>Journey legs / consignments</h2><table><tr><th>Leg</th><th>Route</th><th>Client</th><th>Cargo</th><th>Income</th></tr>${legs.map(l=>`<tr><td>${l.sequence}</td><td>${esc(route(l.routeId))}</td><td>${esc(client(l.clientId))}</td><td>${esc(l.load||'—')}</td><td>${money(legIncomeClient(l))}</td></tr>`).join('')}</table><h2>Border pack checklist</h2><table><tr><th>Status</th><th>Document</th><th>Group / leg</th><th>Reference / note</th></tr>${items.map(x=>`<tr><td class="${x.status==='Ready'?'good':'bad'}">${esc(x.status)}</td><td>${esc(x.title)}</td><td>${esc(x.group)}</td><td>${esc(x.detail||'')}</td></tr>`).join('')}</table><p class="small">Final border/customs document requirements can vary by cargo, customs procedure, ownership/finance arrangement and crossing. Confirm cargo-specific permits and declaration type with the clearing agent before dispatch.</p><div class="page-break">${authorizationLetterHtml(t)}</div>`;
  openPrintWindow('Cross-border pack '+t.number,checklist)
}
function wireDocuments(){
  if($('borderPackTrip'))$('borderPackTrip').onchange=async e=>{crossBorderPackTripId=e.target.value;crossBorderDocs=[];crossBorderDocsLoadedFor='';await loadCrossBorderDocs(crossBorderPackTripId)};
  if($('refreshBorderPack'))$('refreshBorderPack').onclick=()=>{crossBorderDocsLoadedFor='';loadCrossBorderDocs(crossBorderPackTripId)};
  if($('printBorderPack'))$('printBorderPack').onclick=()=>printCrossBorderPack(get('trips',crossBorderPackTripId));
  if($('printAuthorization'))$('printAuthorization').onclick=()=>printAuthorizationLetter(get('trips',crossBorderPackTripId));
  document.querySelectorAll('.attach-pack-doc').forEach(b=>b.onclick=()=>openPackDocumentUpload(crossBorderPackTripId,b.dataset.kind,b.dataset.leg||'',b.dataset.title||'Document'));
  document.querySelectorAll('.view-pack-doc').forEach(b=>b.onclick=()=>viewPackDocument(b.dataset.id));
  document.querySelectorAll('.delete-pack-doc').forEach(b=>b.onclick=()=>deletePackDocument(b.dataset.id))
}
function incidents(){return `<div class="panel"><div class="toolbar"><h2>Incidents, damage & discipline</h2><button class="primary add-record" data-type="incident">+ Report incident</button></div>${table(['Date','Type','Vehicle','Driver','Severity','Description','Status','Action'],db.incidents,x=>[x.date,x.type,truck(x.truckId),driver(x.driverId),x.severity,x.description,x.status,x.action])}</div><section class="grid-2" style="margin-top:18px"><div class="panel"><h2>Progressive discipline workflow</h2><div class="timeline"><div class="timeline-item"><b>Record facts & evidence</b><small>Employee, date, place, witnesses, photos and linked asset/trip.</small></div><div class="timeline-item"><b>Request written explanation</b><small>Allow response; do not pre-judge.</small></div><div class="timeline-item"><b>Manager review</b><small>Coaching, warning, final warning or hearing.</small></div><div class="timeline-item"><b>Acknowledge & follow up</b><small>Signatures, validity and corrective action.</small></div></div></div><div class="panel"><h2>Key controls</h2><div class="policy critical"><h3>Unauthorized passengers</h3><p>Zero tolerance under the NBL directive.</p></div><div class="policy"><h3>Unauthorized equipment use</h3><p>Capture damage, approval status and signed lawful repayment terms.</p></div><div class="policy"><h3>Attendance / no-show</h3><p>Capture duty, notification, explanation and progressive action.</p></div></div></section>`}
function routeAutoGpsReady(r){
  return Number.isFinite(Number(r?.loadLat))&&Number.isFinite(Number(r?.loadLon))&&Number.isFinite(Number(r?.offloadLat))&&Number.isFinite(Number(r?.offloadLon))&&(Number(r.loadLat)!==0||Number(r.loadLon)!==0)&&(Number(r.offloadLat)!==0||Number(r.offloadLon)!==0);
}
function openRouteZones(id){
  const r=get('routes',id);if(!r.id)return;
  const fenceOptions='<option value="">Choose existing geofence…</option>'+geofences.map(f=>'<option value="'+f.id+'">'+esc(f.name)+'</option>').join('');
  $('modalTitle').textContent='Automatic GPS zones · '+r.name;
  $('entryForm').innerHTML='<div class="route-zone-form">'
    +'<div class="notice"><b>How it works:</b> 5 km = approaching alert · 2 km = arrived · departure triggers once the truck moves safely outside the arrival zone.</div>'
    +'<div class="route-zone-card"><h3>📦 Loading point</h3><label>Name<input id="zoneLoadName" value="'+esc(r.loadName||'')+'" placeholder="e.g. NBL Windhoek"></label><div class="zone-grid"><label>Latitude<input id="zoneLoadLat" type="number" step="0.000001" value="'+(r.loadLat??'')+'"></label><label>Longitude<input id="zoneLoadLon" type="number" step="0.000001" value="'+(r.loadLon??'')+'"></label></div><label>Copy existing geofence<select id="loadFenceSelect">'+fenceOptions+'</select></label><button type="button" class="ghost use-current-zone" data-zone="load">📍 Use my current position</button></div>'
    +'<div class="route-zone-card"><h3>🏁 Offloading point</h3><label>Name<input id="zoneOffloadName" value="'+esc(r.offloadName||'')+'" placeholder="e.g. Oshakati delivery"></label><div class="zone-grid"><label>Latitude<input id="zoneOffloadLat" type="number" step="0.000001" value="'+(r.offloadLat??'')+'"></label><label>Longitude<input id="zoneOffloadLon" type="number" step="0.000001" value="'+(r.offloadLon??'')+'"></label></div><label>Copy existing geofence<select id="offloadFenceSelect">'+fenceOptions+'</select></label><button type="button" class="ghost use-current-zone" data-zone="offload">📍 Use my current position</button></div>'
    +'<div class="zone-grid"><label>Approaching alert<input id="zoneApproachKm" type="number" min="2" max="5" step="0.5" value="'+(num(r.approachKm)||5)+'"><small>km from point</small></label><label>Arrival zone<input id="zoneArrivalKm" type="number" min="0.5" max="4.5" step="0.5" value="'+(num(r.arrivalKm)||2)+'"><small>km from point</small></label></div>'
    +'<label>Trip type<select id="zoneRoundTrip"><option value="false" '+(!routeUsesRoundTrip(r)?'selected':'')+'>One way</option><option value="true" '+(routeUsesRoundTrip(r)?'selected':'')+'>Round trip / returns</option></select></label>'
    +'<div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="primary">✓ SAVE AUTO GPS ZONES</button></div>'
    +'</div>';
  $('modal').classList.remove('hidden');
  const copyFence=(kind,fid)=>{const g=geofences.find(x=>x.id===fid);if(!g)return;if(kind==='load'){$('zoneLoadName').value=g.name;$('zoneLoadLat').value=g.latitude;$('zoneLoadLon').value=g.longitude}else{$('zoneOffloadName').value=g.name;$('zoneOffloadLat').value=g.latitude;$('zoneOffloadLon').value=g.longitude}};
  $('loadFenceSelect').onchange=e=>copyFence('load',e.target.value);
  $('offloadFenceSelect').onchange=e=>copyFence('offload',e.target.value);
  document.querySelectorAll('.use-current-zone').forEach(b=>b.onclick=()=>{if(!navigator.geolocation)return notify('GPS not available on this device');navigator.geolocation.getCurrentPosition(p=>{const k=b.dataset.zone;if(k==='load'){$('zoneLoadLat').value=p.coords.latitude.toFixed(6);$('zoneLoadLon').value=p.coords.longitude.toFixed(6)}else{$('zoneOffloadLat').value=p.coords.latitude.toFixed(6);$('zoneOffloadLon').value=p.coords.longitude.toFixed(6)}notify('Current position copied')},e=>notify(e.message),{enableHighAccuracy:true,timeout:15000})});
  $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  $('entryForm').onsubmit=e=>{e.preventDefault();const vals={loadName:$('zoneLoadName').value.trim(),loadLat:Number($('zoneLoadLat').value),loadLon:Number($('zoneLoadLon').value),offloadName:$('zoneOffloadName').value.trim(),offloadLat:Number($('zoneOffloadLat').value),offloadLon:Number($('zoneOffloadLon').value),approachKm:Number($('zoneApproachKm').value),arrivalKm:Number($('zoneArrivalKm').value),roundTrip:$('zoneRoundTrip').value==='true'};if(!Number.isFinite(vals.loadLat)||!Number.isFinite(vals.loadLon)||!Number.isFinite(vals.offloadLat)||!Number.isFinite(vals.offloadLon))return notify('Enter valid loading and offloading coordinates');if(vals.approachKm<2||vals.approachKm>5)return notify('Approaching distance must be 2–5 km');if(vals.arrivalKm<.5||vals.arrivalKm>=vals.approachKm)return notify('Arrival distance must be smaller than approaching distance');Object.assign(r,vals);$('modal').classList.add('hidden');commit('Automatic GPS zones updated for '+r.name,'route',r.id)};
}
function clients(){
  const routeRows=db.routes.map(r=>'<tr><td><b>'+esc(r.name)+'</b><br><small>'+esc(r.notes||'')+'</small></td><td>'+num(r.distance).toLocaleString()+' km</td><td>'+money(r.rate)+'</td><td>'+(r.crossBorder?'Cross-border':'Namibia')+(routeUsesRoundTrip(r)?' · Round trip':'')+'</td><td>'+(routeAutoGpsReady(r)?'<span class="zone-ready">● AUTO GPS READY</span><small>'+esc(r.loadName||'Loading')+' → '+esc(r.offloadName||'Offloading')+'<br>'+(num(r.approachKm)||5)+' km / '+(num(r.arrivalKm)||2)+' km</small>':'<span class="zone-needed">● SETUP NEEDED</span><small>Loading/offloading pins not set</small>')+'</td><td><button class="link-button route-zones" data-id="'+r.id+'">GPS zones</button></td></tr>').join('');
  return '<section class="grid-2"><div class="panel"><div class="toolbar"><h2>Clients</h2><button class="primary add-record" data-type="client">+ Client</button></div>'+table(['Client','Terms','Contact','Status','Trips','Revenue'],db.clients,x=>[x.name,num(x.terms)+' days',x.contact,x.status,db.trips.filter(t=>t.clientId===x.id).length,money(sum(db.trips.filter(t=>t.clientId===x.id),t=>t.income))])+'</div><div class="panel"><div class="toolbar"><div><h2>Standard routes</h2><p class="muted-copy">Set loading and offloading GPS zones once; trips on that route then update automatically.</p></div><button class="primary add-record" data-type="route">+ Route</button></div><div class="table-wrap"><table><thead><tr><th>Route</th><th>Distance</th><th>Standard rate</th><th>Type</th><th>Automatic GPS</th><th></th></tr></thead><tbody>'+routeRows+'</tbody></table></div></div></section>';
}
function invoices(){db.invoices.forEach(refreshInvoiceStatus);const outstanding=sum(db.invoices,invoiceBalance),received=sum(db.payments,x=>x.amount);return `<section class="kpis">${kpi('Invoiced',money(sum(db.invoices,x=>x.amount)),'Total issued')}${kpi('Outstanding',money(outstanding),`${db.invoices.filter(x=>invoiceBalance(x)>.005).length} invoice(s)`)}${kpi('Payments received',money(received),`${db.payments.length} payment(s)`,'positive')}${kpi('Uninvoiced delivered legs',sum(db.trips,t=>tripLegs(t).filter(l=>l.pod&&!l.invoiceId).length),'Revenue at risk','warning')}</section><div class="panel"><div class="toolbar"><h2>Invoices & debtors</h2><div><button class="ghost export" data-kind="invoice">Export Excel</button> <button class="primary add-record" data-type="invoice">+ Add</button></div></div><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Client / Trip</th><th>Amount</th><th>Received</th><th>Balance</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${db.invoices.map(i=>`<tr><td><b>${esc(i.number)}</b><br><small>${esc(i.date)}</small></td><td>${esc(client(i.clientId))}<br><small>${esc(get('trips',i.tripId).number||'—')}</small></td><td>${money(i.amount)}</td><td>${money(invoicePaid(i.id))}</td><td><b>${money(invoiceBalance(i))}</b></td><td>${esc(i.due||'—')}</td><td>${badge(i.status)}</td><td><button class="link-button open-invoice" data-id="${i.id}">Open</button>${invoiceBalance(i)>.005?` · <button class="link-button pay-invoice" data-id="${i.id}">Record payment</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No invoices</td></tr>'}</tbody></table></div></div>`}
function defaultMdcKm(t){
  const r=get('routes',t?.routeId);
  if(!t?.id)return 0;
  return r.crossBorder?(num(t.namibiaKm)||num(r.namibiaKm)):(num(t.distance)||num(r.distance));
}
function roadCharges(){
  const rows=(db.expenses||[]).filter(x=>x.mdc===true||/mass distance charge/i.test(String(x.category||'')));
  const selected=mdcTripPrefill||db.trips[0]?.id||'',rate=num(db.settings.mdcRatePer100km)||73.30;
  return '<section class="kpis">'
    +kpi('Default MDC rate',money(rate)+' / 100 km','Editable in Settings')
    +kpi('MDC records',rows.length,'Linked to trips')
    +kpi('MDC spend',money(sum(rows,x=>x.amount)),'Included in trip cost')
    +kpi('Current month',money(sum(rows.filter(x=>String(x.date||'').startsWith(today().slice(0,7))),x=>x.amount)),'Recorded this month')
    +'</section><section class="grid-2"><div class="panel"><h2>MDC charge generator</h2>'
    +'<div class="notice"><b>Namibian road distance only.</b> Local routes default to the trip distance. For cross-border trips, enter only the kilometres travelled on Namibian roads.</div>'
    +'<div class="form-grid" id="mdcForm"><div class="field full"><label>Trip</label><select id="mdcTrip">'+db.trips.map(t=>'<option value="'+t.id+'" '+(t.id===selected?'selected':'')+'>'+esc(t.number)+' · '+esc(route(t.routeId))+' · '+esc(truck(t.truckId))+'</option>').join('')+'</select></div>'
    +'<div class="field"><label>Namibian road distance (km)</label><input id="mdcKm" type="number" step="0.1" min="0"></div>'
    +'<div class="field"><label>MDC rate per 100 km</label><input id="mdcRate" type="number" step="0.01" min="0" value="'+rate+'"></div>'
    +'<div class="field full"><label>RFA / logbook reference <small>(optional)</small></label><input id="mdcReference" placeholder="Permit, statement or logbook reference"></div></div>'
    +'<div id="mdcPreview" class="mdc-preview"></div><button class="primary" id="saveMdcCharge">✓ RECORD MDC TO TRIP</button></div>'
    +'<div class="panel"><h2>How it posts</h2><p>The generator creates one linked <b>Mass distance charge (MDC)</b> expense for the selected trip. Re-running the same trip updates that MDC record instead of creating duplicates.</p>'
    +'<div class="policy"><h3>Heavy articulated default</h3><p>Angermund default: <b>'+money(rate)+' / 100 km</b>. Change it in Settings whenever the RFA tariff changes.</p></div>'
    +'<div class="policy"><h3>Trip P&amp;L</h3><p>MDC is included automatically under route expenses, total trip cost and contribution.</p></div></div></section>'
    +'<section class="panel" style="margin-top:18px"><h2>Recorded MDC charges</h2>'
    +table(['Date','Trip','Truck','Namibia km','Rate / 100 km','Charge','Reference'],rows,x=>[x.date,get('trips',x.tripId).number||'—',truck(x.truckId),num(x.mdcKm).toLocaleString(),money(x.mdcRatePer100km),money(x.amount),x.receiptNo||'—'])
    +'</section>';
}
function renderMdcCalculation(){
  const t=get('trips',$('mdcTrip')?.value),r=get('routes',t.routeId),km=num($('mdcKm')?.value),rate=num($('mdcRate')?.value),amount=km/100*rate;
  if(!$('mdcPreview'))return;
  $('mdcPreview').innerHTML='<div><span>Trip</span><b>'+esc(t.number||'—')+'</b></div>'
    +'<div><span>Route</span><b>'+esc(route(t.routeId))+'</b></div>'
    +'<div><span>Truck</span><b>'+esc(truck(t.truckId))+'</b></div>'
    +'<div><span>Namibia km</span><b>'+km.toLocaleString()+' km</b></div>'
    +'<div class="mdc-total"><span>MDC charge</span><b>'+money(amount)+'</b></div>'
    +(r.crossBorder?'<small>Cross-border trip: only the Namibian-road portion is charged here.</small>':'');
}
function wireRoadCharges(){
  const setTrip=()=>{
    const t=get('trips',$('mdcTrip')?.value);
    if($('mdcKm'))$('mdcKm').value=defaultMdcKm(t)||'';
    renderMdcCalculation();
  };
  if($('mdcTrip')){$('mdcTrip').onchange=setTrip;setTrip()}
  if($('mdcKm'))$('mdcKm').oninput=renderMdcCalculation;
  if($('mdcRate'))$('mdcRate').oninput=renderMdcCalculation;
  if($('saveMdcCharge'))$('saveMdcCharge').onclick=async()=>{
    const tripId=$('mdcTrip').value,namibiaKm=num($('mdcKm').value),ratePer100km=num($('mdcRate').value),reference=$('mdcReference').value.trim();
    if(!tripId||namibiaKm<=0)return notify('Enter the Namibian road distance');
    try{
      const r=await api('/api/mdc/record',{method:'POST',body:{tripId,namibiaKm,ratePer100km,reference,date:today()}});
      mdcTripPrefill='';await refreshCentralState(false);notify('MDC '+money(r.record.amount)+' recorded to '+r.trip.number)
    }catch(e){notify(e.message)}
  };
}
function clientPayProfile(driverId){
  const p=(db.payProfiles||[]).find(x=>x.driverId===driverId);
  if(p)return p;
  const prior=(db.payroll||[]).filter(x=>x.employeeId===driverId).sort((a,b)=>String(b.period||'').localeCompare(String(a.period||'')))[0];
  return{driverId,baseSalary:num(prior?.base),tripRatePerKm:num(prior?.tripRatePerKm),minimumBonusKml:2.0,taxNumber:prior?.taxNumber||'',payeDefault:num(prior?.paye),sscDefault:num(prior?.ssc),overtimeRate:num(prior?.overtimeRate),standardDays:num(prior?.days)||22,otherDeductionDefault:num(prior?.deductions),autoGenerate:true}
}
function payslipGross(p){return p.gross!==undefined?num(p.gross):num(p.base)+num(p.tripPay)+num(p.incentive)+num(p.overtimePay||num(p.overtimeHours||p.overtime)*num(p.overtimeRate))}
function payslipNet(p){return p.net!==undefined?num(p.net):payslipGross(p)+num(p.reimbursements)-num(p.advances)-num(p.paye)-num(p.ssc)-num(p.deductions)}
function payroll(){
  const period=payrollPeriodFilter||today().slice(0,7),rows=(db.payroll||[]).filter(x=>x.period===period).sort((a,b)=>driver(a.employeeId).localeCompare(driver(b.employeeId))),profiles=db.drivers.map(d=>({driver:d,profile:clientPayProfile(d.id)}));
  const totalNet=sum(rows,payslipNet),drafts=rows.filter(x=>x.status==='Draft').length,missing=profiles.filter(x=>num(x.profile.baseSalary)<=0||num(x.profile.tripRatePerKm)<=0).length;
  const payRows=rows.length?rows.map(p=>'<tr><td><b>'+esc(driver(p.employeeId))+'</b><br><small>'+esc(p.taxNumber||clientPayProfile(p.employeeId).taxNumber||'Tax no. not set')+'</small></td>'
    +'<td>'+money(p.base)+'</td><td>'+num(p.tripKm).toLocaleString()+' km</td><td>'+money(p.tripPay)+'</td><td>'+money(p.incentive)+'</td><td>'+money(p.overtimePay)+'</td><td>'+money(p.reimbursements)+'</td><td>'+money(p.advances)+'</td>'
    +'<td>'+money(num(p.paye)+num(p.ssc)+num(p.deductions))+'</td><td><b>'+money(payslipNet(p))+'</b></td><td>'+badge(p.status||'Draft')+'</td>'
    +'<td><button class="link-button open-payslip" data-id="'+p.id+'">Open</button> · <button class="link-button print-payslip" data-id="'+p.id+'">Print</button></td></tr>').join('')
    :'<tr><td colspan="12" class="empty">No payslips generated for this month yet.</td></tr>';
  const profileRows=profiles.map(({driver:d,profile:p})=>'<tr><td><b>'+esc(d.name)+'</b></td><td>'+esc(p.taxNumber||'—')+'</td><td>'+money(p.baseSalary)+'</td><td>'+money(p.tripRatePerKm)+'/km</td><td>'+num(p.minimumBonusKml||2).toFixed(2)+' km/L</td><td>'+money(p.payeDefault)+'</td><td>'+money(p.sscDefault)+'</td><td>'+money(p.overtimeRate)+'/hr</td><td>'+(p.autoGenerate===false?'Manual':'Auto')+'</td><td><button class="link-button edit-pay-profile" data-driver="'+d.id+'">Edit</button></td></tr>').join('');
  return '<section class="kpis">'+kpi('Payslips',rows.length,period)+kpi('Drafts to review',drafts,'Approve before payment')+kpi('Net payroll',money(totalNet),'Current selected month')+kpi('Setup required',missing,'Missing basic or trip/km rate',missing?'warning':'')+'</section>'
    +'<section class="panel"><div class="toolbar"><div><h2>Month-end payroll</h2><p class="muted-copy">Draft payslips are generated automatically on the last calendar day. You can generate/refresh them early for review.</p></div><div class="payroll-controls"><input id="payrollPeriod" type="month" value="'+esc(period)+'"><button class="primary" id="generatePayroll">⚙ Generate / refresh month</button></div></div>'
    +'<div class="notice"><b>Driver earnings:</b> Basic salary + normal trip pay (km × driver trip rate) + fuel-saving bonus + overtime + approved reimbursements − advances − PAYE − SSC − other deductions. The fuel bonus is extra and becomes zero when fuel efficiency is below the configured minimum.</div>'
    +'<div class="table-wrap"><table><thead><tr><th>Driver</th><th>Basic</th><th>Trip km</th><th>Trip pay</th><th>Fuel bonus</th><th>Overtime</th><th>Reimbursements</th><th>Advances</th><th>Tax/deductions</th><th>Net pay</th><th>Status</th><th></th></tr></thead><tbody>'+payRows+'</tbody></table></div></section>'
    +'<section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2>Driver payroll setup</h2><p class="muted-copy">Set the basic salary and normal trip rate/km once per driver. Fuel-saving bonus remains a separate performance reward.</p></div></div><div class="table-wrap"><table><thead><tr><th>Driver</th><th>Tax number</th><th>Basic</th><th>Trip rate/km</th><th>Bonus starts</th><th>PAYE</th><th>SSC</th><th>OT rate</th><th>Month-end</th><th></th></tr></thead><tbody>'+profileRows+'</tbody></table></div></section>'
    +'<section class="grid-2" style="margin-top:18px">'+dataTable('Driver advances','advance',['Date','Driver','Trip','Type','Amount','Status'],db.advances,x=>[x.date,driver(x.driverId),get('trips',x.tripId).number||'—',x.type,money(x.amount),x.status])+dataTable('Approved/review expenses','expense',['Date','Trip','Category','Driver','Amount','Status'],db.expenses,x=>[x.date,get('trips',x.tripId).number||'—',x.category,driver(x.driverId),money(x.amount),x.status])+'</section>';
}
function openPayrollProfile(driverId){
  const d=get('drivers',driverId),p=clientPayProfile(driverId);
  $('modalTitle').textContent='Payroll setup · '+d.name;
  $('entryForm').innerHTML='<div class="notice"><b>Normal trip pay and fuel bonus are separate.</b><br>The trip rate/km is paid for kilometres travelled. The fuel-saving bonus is only extra when the driver meets the minimum km/L.</div>'
    +'<div class="form-grid"><div class="field"><label>Basic monthly salary</label><input id="ppBase" type="number" step="0.01" value="'+num(p.baseSalary)+'"></div>'
    +'<div class="field"><label>Normal trip pay / km</label><input id="ppTripRate" type="number" step="0.01" value="'+num(p.tripRatePerKm)+'"></div>'
    +'<div class="field"><label>Fuel bonus starts at km/L</label><input id="ppMinBonus" type="number" step="0.01" value="'+(num(p.minimumBonusKml)||2.0)+'"></div>'
    +'<div class="field"><label>Tax number</label><input id="ppTax" value="'+esc(p.taxNumber||'')+'"></div>'
    +'<div class="field"><label>PAYE default / month</label><input id="ppPaye" type="number" step="0.01" value="'+num(p.payeDefault)+'"></div>'
    +'<div class="field"><label>SSC default / month</label><input id="ppSsc" type="number" step="0.01" value="'+num(p.sscDefault)+'"></div>'
    +'<div class="field"><label>Overtime rate / hour</label><input id="ppOtRate" type="number" step="0.01" value="'+num(p.overtimeRate)+'"></div>'
    +'<div class="field"><label>Standard paid days</label><input id="ppDays" type="number" step="1" value="'+(num(p.standardDays)||22)+'"></div>'
    +'<div class="field"><label>Other default deduction</label><input id="ppDeduction" type="number" step="0.01" value="'+num(p.otherDeductionDefault)+'"></div>'
    +'<div class="field"><label>Auto-generate month end</label><select id="ppAuto"><option value="true" '+(p.autoGenerate!==false?'selected':'')+'>Yes</option><option value="false" '+(p.autoGenerate===false?'selected':'')+'>No</option></select></div>'
    +'<div class="form-actions full"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="primary">Save payroll setup</button></div></div>';
  $('modal').classList.remove('hidden');$('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  $('entryForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/payroll/profiles/'+encodeURIComponent(driverId),{method:'PATCH',body:{baseSalary:num($('ppBase').value),tripRatePerKm:num($('ppTripRate').value),minimumBonusKml:num($('ppMinBonus').value)||2.0,taxNumber:$('ppTax').value.trim(),payeDefault:num($('ppPaye').value),sscDefault:num($('ppSsc').value),overtimeRate:num($('ppOtRate').value),standardDays:num($('ppDays').value)||22,otherDeductionDefault:num($('ppDeduction').value),autoGenerate:$('ppAuto').value==='true'}});$('modal').classList.add('hidden');await refreshCentralState(false);notify('Payroll setup saved for '+d.name)}catch(err){notify(err.message)}};
}
function openPayslip(id){
  const p=(db.payroll||[]).find(x=>x.id===id);if(!p)return;
  const d=get('drivers',p.employeeId),profile=clientPayProfile(p.employeeId);
  $('modalTitle').textContent='Payslip · '+d.name+' · '+p.period;
  $('entryForm').innerHTML='<div class="payslip-summary"><div><span>Gross earnings</span><b>'+money(payslipGross(p))+'</b></div><div><span>Trip pay</span><b>'+money(p.tripPay)+'</b></div><div><span>Fuel bonus</span><b>'+money(p.incentive)+'</b></div><div><span>Net pay</span><b class="positive">'+money(payslipNet(p))+'</b></div></div>'
    +'<div class="form-grid"><div class="field"><label>Days worked</label><input id="psDays" type="number" value="'+num(p.days)+'"></div><div class="field"><label>Basic salary</label><input id="psBase" type="number" step="0.01" value="'+num(p.base)+'"></div>'
    +'<div class="field"><label>Trip kilometres</label><input type="number" value="'+num(p.tripKm)+'" disabled></div><div class="field"><label>Trip rate / km</label><input id="psTripRate" type="number" step="0.01" value="'+num(p.tripRatePerKm||profile.tripRatePerKm)+'"></div>'
    +'<div class="field"><label>Overtime hours</label><input id="psOtHours" type="number" step="0.25" value="'+num(p.overtimeHours||p.overtime)+'"></div><div class="field"><label>Overtime rate</label><input id="psOtRate" type="number" step="0.01" value="'+num(p.overtimeRate||profile.overtimeRate)+'"></div>'
    +'<div class="field"><label>PAYE</label><input id="psPaye" type="number" step="0.01" value="'+num(p.paye)+'"></div><div class="field"><label>SSC</label><input id="psSsc" type="number" step="0.01" value="'+num(p.ssc)+'"></div>'
    +'<div class="field"><label>Other deductions</label><input id="psDeduct" type="number" step="0.01" value="'+num(p.deductions)+'"></div><div class="field"><label>Status</label><select id="psStatus">'+['Draft','Approved','Paid'].map(x=>'<option '+(x===p.status?'selected':'')+'>'+x+'</option>').join('')+'</select></div></div>'
    +'<div class="payslip-lines"><div><span>Normal trip pay</span><b>'+num(p.tripKm).toLocaleString()+' km × '+money(p.tripRatePerKm||profile.tripRatePerKm)+'/km = '+money(p.tripPay)+'</b></div><div><span>Fuel-saving bonus</span><b>'+money(p.incentive)+'</b></div><div><span>Approved expense reimbursement</span><b>'+money(p.reimbursements)+'</b></div><div><span>Unreconciled advances</span><b>- '+money(p.advances)+'</b></div><div><span>Trips included</span><b>'+num(p.tripCount)+'</b></div></div>'
    +'<div class="form-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button type="button" class="ghost" id="printPayslipModal">Print payslip</button><button class="primary">Save payslip</button></div>';
  $('modal').classList.remove('hidden');$('cancelForm').onclick=()=>$('modal').classList.add('hidden');$('printPayslipModal').onclick=()=>printPayslip(id);
  $('entryForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/payroll/'+encodeURIComponent(id),{method:'PATCH',body:{days:num($('psDays').value),base:num($('psBase').value),tripRatePerKm:num($('psTripRate').value),overtimeHours:num($('psOtHours').value),overtimeRate:num($('psOtRate').value),paye:num($('psPaye').value),ssc:num($('psSsc').value),deductions:num($('psDeduct').value),status:$('psStatus').value}});$('modal').classList.add('hidden');await refreshCentralState(false);notify('Payslip updated')}catch(err){notify(err.message)}};
}
function printPayslip(id){
  const p=(db.payroll||[]).find(x=>x.id===id);if(!p)return notify('Payslip not found');
  const d=get('drivers',p.employeeId),profile=clientPayProfile(p.employeeId),w=window.open('','_blank','width=820,height=900');
  if(!w)return notify('Allow pop-ups to print the payslip');
  const line=(label,value,bold=false)=>'<tr><td>'+label+'</td><td style="text-align:right;'+(bold?'font-weight:800;':'')+'">'+value+'</td></tr>';
  w.document.write('<!doctype html><html><head><title>Payslip '+esc(d.name)+' '+esc(p.period)+'</title><style>body{font-family:Arial,sans-serif;color:#111;margin:36px}.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:14px}.muted{color:#555;font-size:12px}.box{border:1px solid #ccc;padding:14px;margin-top:18px}table{width:100%;border-collapse:collapse}td{padding:7px;border-bottom:1px solid #eee}.net{font-size:22px;font-weight:900}.footer{margin-top:30px;font-size:11px;color:#555}@media print{button{display:none}}</style></head><body>'
    +'<div class="head"><div><h2>'+esc(db.company.name)+'</h2><div class="muted">'+esc(db.company.registration)+' · '+esc(db.company.address)+'</div></div><div style="text-align:right"><h2>PAYSLIP</h2><b>'+esc(p.period)+'</b></div></div>'
    +'<div class="box"><b>'+esc(d.name)+'</b><div class="muted">Tax no: '+esc(p.taxNumber||profile.taxNumber||'—')+' · Driver / Employee</div></div>'
    +'<div class="box"><h3>Earnings</h3><table>'+line('Basic salary',money(p.base))+line('Trip pay ('+num(p.tripKm).toLocaleString()+' km × '+money(p.tripRatePerKm||profile.tripRatePerKm)+'/km)',money(p.tripPay))+line('Fuel-saving bonus',money(p.incentive))+line('Overtime ('+num(p.overtimeHours)+' hrs)',money(p.overtimePay))+line('Gross earnings',money(payslipGross(p)),true)+line('Approved reimbursements',money(p.reimbursements))+'</table></div>'
    +'<div class="box"><h3>Deductions</h3><table>'+line('PAYE',money(p.paye))+line('SSC',money(p.ssc))+line('Advances',money(p.advances))+line('Other deductions',money(p.deductions))+'</table></div>'
    +'<div class="box net">NET PAY <span style="float:right">'+money(payslipNet(p))+'</span></div>'
    +'<div class="footer">Status: '+esc(p.status||'Draft')+' · Fuel-saving bonus is additional performance pay and does not replace normal trip pay. Generated by Angermund Transport ERP.</div><br><button onclick="window.print()">Print / Save PDF</button></body></html>');
  w.document.close();w.focus();
}
function wirePayroll(){
  if($('payrollPeriod'))$('payrollPeriod').onchange=e=>{payrollPeriodFilter=e.target.value||today().slice(0,7);render()};
  if($('generatePayroll'))$('generatePayroll').onclick=async()=>{try{await api('/api/payroll/generate',{method:'POST',body:{period:payrollPeriodFilter}});await refreshCentralState(false);notify('Payroll drafts refreshed for '+payrollPeriodFilter)}catch(e){notify(e.message)}};
  document.querySelectorAll('.edit-pay-profile').forEach(b=>b.onclick=()=>openPayrollProfile(b.dataset.driver));
  document.querySelectorAll('.open-payslip').forEach(b=>b.onclick=()=>openPayslip(b.dataset.id));
  document.querySelectorAll('.print-payslip').forEach(b=>b.onclick=()=>printPayslip(b.dataset.id));
}
function tasks(){return `<section class="grid-2"><div class="panel"><h2>Work queue</h2>${db.tasks.map(t=>`<div class="approval"><div><b>${esc(t.title)}</b><small style="display:block;color:var(--muted)">${esc(t.ownerRole)} · due ${esc(t.due)} · ${esc(t.priority)}</small></div><div>${badge(t.status)} ${t.status==='Open'?`<button class="small complete-task" data-id="${t.id}">Complete</button>`:''}</div></div>`).join('')}</div><div class="panel"><h2>Approvals</h2>${db.approvals.map(a=>`<div class="approval"><div><b>${esc(a.description)}</b><small style="display:block;color:var(--muted)">${esc(a.type)} · ${esc(a.requester)} · ${money(a.amount)}</small></div><div>${badge(a.status)} ${a.status==='Pending'?`<button class="small approval-action" data-id="${a.id}" data-status="Approved">Approve</button> <button class="danger small approval-action" data-id="${a.id}" data-status="Rejected">Reject</button>`:''}</div></div>`).join('')}</div></section>`}
function ensureJourneyQuoteLegs(){
  if(journeyQuoteLegs.length)return;
  const r=db.routes[0]||{};
  journeyQuoteLegs=[{id:uid('ql'),label:'Outbound / Load 1',routeId:r.id||'',clientId:'',load:'',tons:0,pallets:0,pricingMethod:'Manual negotiated',unitRate:0,manualAmount:0}]
}
function quoteLegIncome(q){
  const r=get('routes',q.routeId),method=q.pricingMethod||'Manual negotiated',rate=num(q.unitRate),manual=num(q.manualAmount);
  if(method==='Per km')return rate*num(r.distance);
  if(method==='Per ton')return rate*num(q.tons);
  if(method==='Per pallet')return rate*num(q.pallets);
  if(method==='Flat trip')return rate||manual;
  return manual
}
function quoteLegRow(q,i){
  const r=get('routes',q.routeId);
  return `<article class="quote-leg" data-qleg="${q.id}">
    <div class="quote-leg-head"><b>LEG ${i+1}</b><input class="qleg-label" value="${esc(q.label||('Leg '+(i+1)))}">${journeyQuoteLegs.length>1?`<button type="button" class="danger small qleg-remove" data-id="${q.id}">Remove</button>`:''}</div>
    <div class="form-grid">
      <div class="field full"><label>Route</label><select class="qleg-route">${db.routes.map(x=>`<option value="${x.id}" ${x.id===q.routeId?'selected':''}>${esc(x.name)} · ${num(x.distance).toLocaleString()} km</option>`).join('')}</select></div>
      <div class="field full"><label>Client</label><select class="qleg-client"><option value="">Prospective / select later</option>${db.clients.map(x=>`<option value="${x.id}" ${x.id===q.clientId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field full"><label>Cargo</label><input class="qleg-load" value="${esc(q.load||'')}" placeholder="Charcoal, furniture, beer, salt…"></div>
      <div class="field"><label>Tons</label><input class="qleg-tons" type="number" step="0.01" value="${num(q.tons)}"></div>
      <div class="field"><label>Pallets</label><input class="qleg-pallets" type="number" step="1" value="${num(q.pallets)}"></div>
      <div class="field"><label>Pricing method</label><select class="qleg-method">${['Flat trip','Per km','Per ton','Per pallet','Manual negotiated'].map(x=>`<option ${x===q.pricingMethod?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Unit / flat rate</label><input class="qleg-rate" type="number" step="0.01" value="${num(q.unitRate)}"></div>
      <div class="field full"><label>Negotiated/manual total</label><input class="qleg-manual" type="number" step="0.01" value="${num(q.manualAmount)}"></div>
    </div>
    <div class="quote-leg-result"><span>${esc(route(q.routeId))} · ${num(r.distance).toLocaleString()} km</span><b>${money(quoteLegIncome(q))}</b></div>
  </article>`
}
function readQuoteLegRows(){
  document.querySelectorAll('.quote-leg').forEach(el=>{
    const q=journeyQuoteLegs.find(x=>x.id===el.dataset.qleg);if(!q)return;
    q.label=el.querySelector('.qleg-label').value.trim();q.routeId=el.querySelector('.qleg-route').value;q.clientId=el.querySelector('.qleg-client').value;q.load=el.querySelector('.qleg-load').value.trim();
    q.tons=num(el.querySelector('.qleg-tons').value);q.pallets=num(el.querySelector('.qleg-pallets').value);q.pricingMethod=el.querySelector('.qleg-method').value;q.unitRate=num(el.querySelector('.qleg-rate').value);q.manualAmount=num(el.querySelector('.qleg-manual').value)
  })
}
function quoteJourneyFinancials(){
  readQuoteLegRows();
  const distance=sum(journeyQuoteLegs,q=>get('routes',q.routeId).distance),namibiaKm=sum(journeyQuoteLegs,q=>{const r=get('routes',q.routeId);return r.crossBorder?num(r.namibiaKm):num(r.distance)}),quotedIncome=sum(journeyQuoteLegs,quoteLegIncome);
  const kml=Math.max(.1,num($('jqKml')?.value)||2),dieselPrice=num($('jqDiesel')?.value)||num(db.settings.dieselPrice),diesel=distance/kml*dieselPrice,mdc=namibiaKm/100*(num($('jqMdc')?.value)||num(db.settings.mdcRatePer100km)||73.30),standing=num($('jqWaiting')?.value)*num(db.settings.standingFee);
  const other=num($('jqDriver')?.value)+num($('jqTolls')?.value)+num($('jqWear')?.value)+num($('jqOther')?.value)+standing,totalCost=diesel+mdc+other,margin=Math.min(90,num($('jqMargin')?.value))/100,recommended=totalCost/(1-margin),profit=quotedIncome-totalCost;
  return{distance,namibiaKm,quotedIncome,diesel,mdc,standing,totalCost,recommended,profit,margin}
}
function updateJourneyQuoteResult(){
  readQuoteLegRows();
  document.querySelectorAll('.quote-leg').forEach(el=>{
    const q=journeyQuoteLegs.find(x=>x.id===el.dataset.qleg),result=el.querySelector('.quote-leg-result');if(!q||!result)return;
    const r=get('routes',q.routeId);result.innerHTML='<span>'+esc(route(q.routeId))+' · '+num(r.distance).toLocaleString()+' km</span><b>'+money(quoteLegIncome(q))+'</b>'
  });
  const x=quoteJourneyFinancials();
  if($('journeyQuoteResult'))$('journeyQuoteResult').innerHTML=`<div class="metric-line"><span>Total journey distance</span><b>${x.distance.toLocaleString()} km</b></div><div class="metric-line"><span>Namibian road km</span><b>${x.namibiaKm.toLocaleString()} km</b></div><div class="metric-line"><span>Estimated diesel</span><b>${money(x.diesel)}</b></div><div class="metric-line"><span>MDC</span><b>${money(x.mdc)}</b></div><div class="metric-line"><span>Standing</span><b>${money(x.standing)}</b></div><div class="metric-line"><span>Journey operating cost</span><b>${money(x.totalCost)}</b></div><div class="metric-line"><span>Recommended minimum income</span><b>${money(x.recommended)}</b></div><div class="metric-line"><span>Quoted leg income</span><b>${money(x.quotedIncome)}</b></div><div class="metric-line"><span>Expected journey contribution</span><b class="${x.profit>=0?'positive':'negative'}">${money(x.profit)}</b></div>`
}
function renderJourneyQuote(){
  if(!$('journeyQuoteLegs'))return;
  $('journeyQuoteLegs').innerHTML=journeyQuoteLegs.map(quoteLegRow).join('');
  wireQuoteLegRows();updateJourneyQuoteResult()
}
function wireQuoteLegRows(){
  document.querySelectorAll('.quote-leg input,.quote-leg select').forEach(x=>x.oninput=updateJourneyQuoteResult);
  document.querySelectorAll('.qleg-route').forEach(x=>x.onchange=updateJourneyQuoteResult);
  document.querySelectorAll('.qleg-remove').forEach(b=>b.onclick=()=>{readQuoteLegRows();journeyQuoteLegs=journeyQuoteLegs.filter(x=>x.id!==b.dataset.id);renderJourneyQuote()})
}
function rates(){
  ensureJourneyQuoteLegs();
  return `<section class="panel"><div class="toolbar"><div><h2>Multi-leg journey quotation</h2><p class="muted-copy">Price each client/load separately, then test the full truck journey including backloads.</p></div><div><button class="ghost" id="addQuoteLeg">+ Add leg</button><button class="primary" id="addQuoteReturn">↩ Add return / backload</button></div></div>
    <div class="journey-quote-layout"><div><div id="journeyQuoteLegs">${journeyQuoteLegs.map(quoteLegRow).join('')}</div></div>
    <div class="panel quote-cost-panel"><h3>Whole journey costs</h3><div class="form-grid">
      <div class="field"><label>Expected km/L</label><input id="jqKml" type="number" step="0.1" value="2"></div>
      <div class="field"><label>Diesel price/L</label><input id="jqDiesel" type="number" step="0.01" value="${num(db.settings.dieselPrice)}"></div>
      <div class="field"><label>MDC / 100 km</label><input id="jqMdc" type="number" step="0.01" value="${num(db.settings.mdcRatePer100km)||73.30}"></div>
      <div class="field"><label>Driver / allowances</label><input id="jqDriver" type="number" value="600"></div>
      <div class="field"><label>Tolls / borders / permits</label><input id="jqTolls" type="number" value="0"></div>
      <div class="field"><label>Tyres & maintenance provision</label><input id="jqWear" type="number" value="3500"></div>
      <div class="field"><label>Other / overhead</label><input id="jqOther" type="number" value="1500"></div>
      <div class="field"><label>Waiting days</label><input id="jqWaiting" type="number" value="0"></div>
      <div class="field full"><label>Target profit margin (%)</label><input id="jqMargin" type="number" value="${num(db.settings.defaultMargin)}"></div>
    </div><div id="journeyQuoteResult"></div><button class="primary" id="saveJourneyQuote">Save journey quotation</button></div></div></section>
    <section class="panel" style="margin-top:18px"><h2>Standing / detention</h2><p>${db.settings.freeStandingHours} free offloading hours, then <b>${money(db.settings.standingFee)}</b> per commenced 24 hours excluding VAT. Weekend/public holiday guide: <b>${money(db.settings.weekendStandingFee)}</b>.</p></section>`;
}
function wireRates(){
  wireQuoteLegRows();
  ['jqKml','jqDiesel','jqMdc','jqDriver','jqTolls','jqWear','jqOther','jqWaiting','jqMargin'].forEach(id=>{if($(id))$(id).oninput=renderJourneyQuote});
  if($('addQuoteLeg'))$('addQuoteLeg').onclick=()=>{readQuoteLegRows();const r=db.routes[0]||{};journeyQuoteLegs.push({id:uid('ql'),label:'Additional load',routeId:r.id||'',clientId:'',load:'',tons:0,pallets:0,pricingMethod:'Manual negotiated',unitRate:0,manualAmount:0});renderJourneyQuote()};
  if($('addQuoteReturn'))$('addQuoteReturn').onclick=()=>{readQuoteLegRows();const last=journeyQuoteLegs[journeyQuoteLegs.length-1],r=get('routes',reverseRouteId(last?.routeId))||db.routes[0]||{};journeyQuoteLegs.push({id:uid('ql'),label:'Return / Backload',routeId:r.id||'',clientId:'',load:'',tons:0,pallets:0,pricingMethod:'Manual negotiated',unitRate:0,manualAmount:0});renderJourneyQuote()};
  if($('saveJourneyQuote'))$('saveJourneyQuote').onclick=()=>{readQuoteLegRows();const x=quoteJourneyFinancials();db.quotes??=[];const q={id:uid('quote'),number:'Q-'+(1000+db.quotes.length+1),date:today(),legs:structuredClone(journeyQuoteLegs),distance:x.distance,namibiaKm:x.namibiaKm,quotedIncome:x.quotedIncome,estimatedCost:x.totalCost,recommendedIncome:x.recommended,expectedProfit:x.profit,status:'Draft'};db.quotes.unshift(q);commit('Journey quotation '+q.number+' saved','quote',q.id);notify(q.number+' saved')};
  renderJourneyQuote()
}
function reports(){const rev=sum(db.trips,journeyIncome),cost=sum(db.trips,tripCost)+sum(db.maintenance,x=>x.cost),profit=rev-cost,rows=db.trucks.map(t=>{const a=db.trips.filter(x=>x.truckId===t.id);return{name:t.registration,trips:a.length,revenue:sum(a,journeyIncome),profit:sum(a,tripProfit)}});return `<section class="kpis">${kpi('Revenue',money(rev),'All trips')}${kpi('Operating cost',money(cost),'Linked records')}${kpi('Net contribution',money(profit),`${rev?((profit/rev)*100).toFixed(1):0}%`,profit>=0?'positive':'negative')}${kpi('Distance',`${sum(db.trips,journeyDistance).toLocaleString()} km`,'All trips')}</section><div class="panel"><h2>Vehicle performance</h2>${table(['Vehicle','Trips','Revenue','Contribution','Revenue / trip'],rows,x=>[x.name,x.trips,money(x.revenue),money(x.profit),money(x.trips?x.revenue/x.trips:0)])}</div><section class="grid-2" style="margin-top:18px"><div class="panel"><h2>Driver performance</h2>${db.drivers.map(d=>`<div class="metric-line"><span>${esc(d.name)}</span><b>${num(d.score)}/100</b></div>`).join('')}</div><div class="panel"><h2>Audit trail</h2>${db.audit.slice(0,8).map(a=>`<div class="timeline-item"><b>${esc(a.action)}</b><small>${new Date(a.at).toLocaleString()} · ${esc(a.actor)}</small></div>`).join('')}</div></section>`}
function automation(){return `<div class="notice"><b>Human verification is mandatory.</b> Scans may suggest links, but unclear amounts are never posted automatically.</div><section class="split-3"><div class="panel"><h2>1 · Capture</h2><div class="doc-grid">${[['▤','Diesel slip','Supplier, litres, amount, truck and odometer'],['✓','POD / delivery note','Link signed proof to the trip'],['$','Invoice / receipt','Suggest client, trip and category']].map(x=>`<div class="doc-card action" data-action="scan"><span class="doc-icon">${x[0]}</span><h3>${x[1]}</h3><p>${x[2]}</p></div>`).join('')}</div></div><div class="panel"><h2>2 · Review</h2><div class="policy"><h3>No silent entries</h3><p>Low-confidence amounts remain blank.</p></div><div class="policy"><h3>No duplicates</h3><p>Number, date, supplier and amount are compared.</p></div></div><div class="panel"><h2>3 · Connected result</h2><p>Approval updates the trip, truck, driver, cost, invoice and dashboard.</p><div class="metric-line"><span>Awaiting review</span><b>0</b></div><div class="metric-line"><span>Possible duplicates</span><b>0</b></div></div></section>`}
function tracking(){
  const canEdit=['admin','manager','dispatcher'].includes(role);
  return `<section class="kpis">${kpi('Vehicles reporting',liveGps.length,`${db.trucks.length} registered`)}${kpi('Moving',liveGps.filter(x=>num(x.speed)>3).length,'Speed above 3 km/h')}${kpi('Geofences',geofences.length,'Entry and exit monitoring')}${kpi('Last update',liveGps[0]?.recordedAt?new Date(liveGps[0].recordedAt).toLocaleTimeString():'Waiting','Real-time event stream')}</section><section class="tracking-layout"><div class="panel"><div class="panel-head"><h2>Live fleet map</h2><button class="ghost" id="refreshTracking">Refresh</button></div><div id="fleetMap" class="map"></div></div><div class="panel"><h2>Live vehicles</h2><div id="liveVehicleList">${liveGps.map(x=>`<div class="vehicle-live" data-vehicle="${esc(x.vehicleId)}"><b>${esc(truck(x.vehicleId))}</b><p>${num(x.speed).toFixed(0)} km/h · ${new Date(x.recordedAt).toLocaleString()}</p></div>`).join('')||'<div class="empty">No GPS positions yet. A driver can press GPS check-in.</div>'}</div><hr style="border-color:var(--line)"><div class="panel-head"><h2>Geofences</h2>${canEdit?'<button class="primary small" id="addGeofence">+ Add geofence</button>':''}</div>${geofences.length?`<div class="geofence-list">${geofences.map(f=>`<div class="geofence-row"><div><b>${esc(f.name)}</b><small>${num(f.radiusM)>=1000?(num(f.radiusM)/1000).toFixed(1)+' km':num(f.radiusM)+' m'} radius</small></div>${canEdit?`<button class="danger small delete-geofence" data-id="${f.id}" data-name="${esc(f.name)}">Delete</button>`:''}</div>`).join('')}</div>`:'<p class="muted">No geofences configured.</p>'}</div></section>`;
}
async function deleteGeofence(id,name='geofence'){
  if(!confirm('Delete '+name+'? This stops entry/exit monitoring for this saved geofence.'))return;
  try{await api('/api/geofences/'+encodeURIComponent(id),{method:'DELETE'});await loadTracking();notify(name+' deleted')}catch(e){notify(e.message)}
}
function notifications(){
  const providerPush=Boolean(providerConfig.providers?.push),deviceOn=Boolean(pushDeviceStatus.subscribed),deviceText=!pushDeviceStatus.supported?'Unsupported':pushDeviceStatus.permission==='denied'?'Blocked':deviceOn?'Subscribed':'Not subscribed';
  const providers=[['In-app',true,'Connected'],['Push server',providerPush,providerPush?'Configured':'Awaiting credentials'],['This phone',deviceOn,deviceText],['WhatsApp',providerConfig.providers?.whatsapp,providerConfig.providers?.whatsapp?'Connected':'Awaiting credentials'],['Email',providerConfig.providers?.email,providerConfig.providers?.email?'Connected':'Awaiting credentials'],['Telematics',providerConfig.providers?.telematics,providerConfig.providers?.telematics?'Connected':'Awaiting credentials']];
  return `<section class="grid-2"><div class="panel"><div class="panel-head"><h2>Notification centre</h2><button class="ghost" id="refreshNotifications">Refresh</button></div><div class="notification-list">${serverNotifications.length?serverNotifications.map(n=>`<div class="notification-row ${n.read?'':'unread'}"><div class="panel-head"><b>${esc(n.title)}</b>${badge(n.severity||'info')}</div><p>${esc(n.message)}</p><small>${new Date(n.createdAt||n.created_at).toLocaleString()}</small>${!n.read?` <button class="link-button read-notification" data-id="${n.id}">Mark read</button>`:''}</div>`).join(''):'<div class="empty">No alerts yet</div>'}</div></div><div class="panel"><h2>Push & notification delivery</h2><div class="provider-grid">${providers.map(([n,on,text])=>`<div class="provider ${on?'on':''}"><span class="status-dot ${on?'':'bad'}"></span><b>${n}</b><p>${esc(text)}</p></div>`).join('')}</div><br><button class="primary" id="enablePush">Enable push on this phone</button> <button class="ghost" id="testPhonePush">Test this phone</button> ${['admin','manager'].includes(role)?'<button class="ghost" id="testAlerts">Create test alert</button>':''}<div class="policy"><h3>Device status</h3><p>Push server configuration and this phone's subscription are checked separately. Android/Chrome must also allow notifications for this site.</p></div><div class="policy"><h3>Automated alert rules</h3><p>Geofence entry/exit, expired documents, missing PODs, inspection failures, maintenance due and operational exceptions can be delivered through connected providers.</p></div></div></section>`
}
function knowledge(){return `<section class="grid-2"><div class="panel"><h2>Driver role & requirements</h2><div class="policy critical"><h3>No passengers or hitchhikers</h3><p>No friends, family, passengers or hitchhikers. A violation may result in immediate dismissal.</p></div><div class="policy"><h3>Before every trip</h3><p>Be fit for duty; valid licence/PrDP and border documents; inspect tyres, lights, brakes, fluids and load security.</p></div><div class="policy"><h3>During every trip</h3><p>Protect cargo; obey traffic/site rules; never use equipment without authorization; report delays, damage and incidents.</p></div><div class="policy"><h3>At delivery</h3><p>Check condition, obtain signed POD, photograph proof, capture end odometer and return receipts/advance.</p></div></div><div class="panel"><h2>Office & dispatcher role</h2><div class="policy"><h3>Safe dispatch</h3><p>Confirm valid driver, truck, trailer, route, load, customer instruction and documents.</p></div><div class="policy"><h3>Live control</h3><p>Monitor GPS, milestones, speeding/security, check-ins and delays.</p></div><div class="policy"><h3>Financial closure</h3><p>Match diesel, tolls, advances, POD and rate; verify profit; invoice and follow payment.</p></div><div class="policy"><h3>Record integrity</h3><p>Use master data, prevent duplicates and never approve unclear scan amounts.</p></div></div></section><section class="split-3" style="margin-top:18px"><div class="panel"><h2>Workshop</h2><p>Review defects, record parts/labour, update odometer and verify roadworthiness.</p></div><div class="panel"><h2>Finance</h2><p>Reconcile costs, advances, invoices, standing fees, payroll/PAYE and evidence.</p></div><div class="panel"><h2>Management</h2><p>Review exceptions, profit, fuel, safety, debtors, approvals and audit history.</p></div></section>`}
function driverLoginEmail(d){
  const base=String(d?.name||'driver').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'')||'driver';
  return base+'@driver.local';
}
function temporaryDriverPassword(){
  return 'Drive'+String(Math.floor(1000+Math.random()*9000))+'!AT';
}
async function loadDriverAccounts(force=false){
  if(role!=='admin'||(usersLoaded&&!force))return;
  try{
    appUsers=await api('/api/users');
    usersLoaded=true;
    if(page==='driverAccounts')render();
  }catch(e){notify(e.message)}
}
function driverAccounts(){
  const accounts=appUsers.filter(u=>u.role==='driver');
  const active=accounts.filter(u=>u.active).length;
  const linked=new Set(accounts.filter(u=>u.active&&u.driverId).map(u=>u.driverId));
  const without=db.drivers.filter(d=>!linked.has(d.id)).length;
  const disabled=accounts.filter(u=>!u.active).length;
  const rows=db.drivers.map(d=>{
    const u=accounts.find(x=>x.driverId===d.id&&x.active)||accounts.find(x=>x.driverId===d.id);
    return `<div class="driver-account-row">
      <div class="driver-account-person"><div class="account-avatar">👤</div><div><b>${esc(d.name)}</b><small>${esc(d.license||'Driver')} · ${esc(d.status||'')}</small></div></div>
      ${u?`<div class="driver-account-login"><span>${esc(u.email)}</span>${u.active?'<b class="account-active">● ACTIVE</b>':'<b class="account-disabled">● DISABLED</b>'}</div>
      <div class="driver-account-actions">
        <button class="ghost small reset-driver-password" data-user="${u.id}">Reset password</button>
        <button class="ghost small relink-driver-account" data-user="${u.id}">Change link</button>
        <button class="${u.active?'danger':'primary'} small toggle-driver-account" data-user="${u.id}" data-active="${!u.active}">${u.active?'Deactivate':'Activate'}</button>
      </div>`:`<div class="driver-account-login"><span>No login linked</span><b class="account-needed">SETUP NEEDED</b></div>
      <div class="driver-account-actions"><button class="primary small create-driver-account-for" data-driver="${d.id}">Create login</button></div>`}
    </div>`;
  }).join('');
  const orphan=accounts.filter(u=>!u.driverId);
  return `<section class="kpis">
    ${kpi('Drivers',db.drivers.length,'Profiles in driver register')}
    ${kpi('Active logins',active,'Can sign in now')}
    ${kpi('Need login',without,'No active linked account',without?'warning':'')}
    ${kpi('Disabled logins',disabled,'Access switched off')}
  </section>
  <section class="panel">
    <div class="toolbar">
      <div><h2>Driver login accounts</h2><p class="muted-copy">Each driver gets one login linked to their driver profile. Their trip, truck and driver name are selected automatically.</p></div>
      <div><button class="ghost" id="copyDriverLoginLink">🔗 Copy driver login link</button> <button class="ghost" id="refreshDriverAccounts">Refresh</button> <button class="primary" id="createDriverAccount">+ Create driver login</button></div>
    </div>
    ${!usersLoaded?'<div class="empty">Loading accounts…</div>':rows}
    ${usersLoaded&&orphan.length?`<div class="notice red"><b>${orphan.length} driver login(s) are not linked to a driver profile.</b> Link them below.</div>${orphan.map(u=>`<div class="driver-account-row"><div class="driver-account-person"><div class="account-avatar">⚠</div><div><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div></div><div class="driver-account-login"><span>Not linked</span></div><div class="driver-account-actions"><button class="primary small relink-driver-account" data-user="${u.id}">Link driver</button></div></div>`).join('')}`:''}
  </section>
  <section class="panel" style="margin-top:18px">
    <h2>How driver login works</h2>
    <div class="quick-grid">
      <div class="quick-card"><b>1. Create login</b><p>Select the driver and give them the login name and temporary password.</p></div>
      <div class="quick-card"><b>2. Driver signs in</b><p>They see only Easy Mode and their own assigned trip.</p></div>
      <div class="quick-card"><b>3. One-tap work</b><p>Diesel, receipts, POD, GPS and problems save against that driver and trip.</p></div>
    </div>
  </section>`;
}
function openDriverAccountForm(selectedDriverId=''){
  const linkedIds=new Set(appUsers.filter(u=>u.role==='driver'&&u.driverId).map(u=>u.driverId));
  const available=db.drivers.filter(d=>d.id===selectedDriverId||!linkedIds.has(d.id));
  if(!available.length)return notify('All drivers already have active logins');
  const first=get('drivers',selectedDriverId).id?get('drivers',selectedDriverId):available[0];
  const password=temporaryDriverPassword();
  $('modalTitle').textContent='Create driver login';
  $('entryForm').innerHTML=`<div class="form-grid">
    <div class="field full"><label>Driver profile</label><select id="newDriverId" required>${available.map(d=>`<option value="${d.id}" ${d.id===selectedDriverId?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Login name</label><input id="newDriverEmail" type="email" value="${esc(driverLoginEmail(first))}" required></div>
    <div class="field"><label>Temporary password</label><input id="newDriverPassword" type="text" value="${esc(password)}" minlength="10" required></div>
    <div class="notice full"><b>Simple for the driver:</b> give them these two details once. The app stays signed in on their phone until they sign out.</div>
    <div class="form-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button type="button" class="ghost" id="generateDriverPassword">Generate new password</button><button class="primary">Create login</button></div>
  </div>`;
  $('modal').classList.remove('hidden');
  let autoEmail=true;
  $('newDriverEmail').oninput=()=>autoEmail=false;
  $('newDriverId').onchange=()=>{if(autoEmail)$('newDriverEmail').value=driverLoginEmail(get('drivers',$('newDriverId').value))};
  $('generateDriverPassword').onclick=()=>$('newDriverPassword').value=temporaryDriverPassword();
  $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  $('entryForm').onsubmit=async e=>{
    e.preventDefault();
    const did=$('newDriverId').value,d=get('drivers',did),email=$('newDriverEmail').value.trim().toLowerCase(),password=$('newDriverPassword').value;
    try{
      await api('/api/users',{method:'POST',body:{email,password,name:d.name,role:'driver',driverId:did}});
      $('entryForm').innerHTML=`<div class="driver-login-created"><div class="success-icon">✓</div><h2>Login created for ${esc(d.name)}</h2><p>Give these details to the driver:</p><div class="credential-box"><span>Login</span><b>${esc(email)}</b><span>Password</span><b>${esc(password)}</b></div><div class="form-actions"><button type="button" class="ghost" id="copyDriverCredentials">Copy details</button><button type="button" class="primary" id="finishDriverAccount">Done</button></div></div>`;
      $('copyDriverCredentials').onclick=async()=>{try{const loginUrl=location.origin+'/login';await navigator.clipboard.writeText('Angermund Transport\\nOpen: '+loginUrl+'\\nLogin: '+email+'\\nPassword: '+password);notify('Login details copied')}catch{notify('Copy is not available on this browser')}};
      $('finishDriverAccount').onclick=async()=>{$('modal').classList.add('hidden');await loadDriverAccounts(true)};
    }catch(err){notify(err.message)}
  };
}
function openResetDriverPassword(userId){
  const u=appUsers.find(x=>x.id===userId);if(!u)return;
  const password=temporaryDriverPassword();
  $('modalTitle').textContent='Reset driver password';
  $('entryForm').innerHTML=`<div class="driver-login-created"><h2>${esc(u.name)}</h2><p>Set a new temporary password. The old password stops working immediately.</p><div class="field"><label>New password</label><input id="resetDriverPasswordValue" type="text" minlength="10" value="${esc(password)}"></div><div class="form-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button type="button" class="ghost" id="generateResetPassword">Generate</button><button class="primary">Reset password</button></div></div>`;
  $('modal').classList.remove('hidden');
  $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  $('generateResetPassword').onclick=()=>$('resetDriverPasswordValue').value=temporaryDriverPassword();
  $('entryForm').onsubmit=async e=>{
    e.preventDefault();const p=$('resetDriverPasswordValue').value;
    try{
      await api('/api/users/'+encodeURIComponent(userId)+'/reset-password',{method:'POST',body:{password:p}});
      $('entryForm').innerHTML=`<div class="driver-login-created"><div class="success-icon">✓</div><h2>Password reset</h2><div class="credential-box"><span>Login</span><b>${esc(u.email)}</b><span>New password</span><b>${esc(p)}</b></div><div class="form-actions"><button type="button" class="ghost" id="copyResetCredentials">Copy details</button><button type="button" class="primary" id="finishResetPassword">Done</button></div></div>`;
      $('copyResetCredentials').onclick=async()=>{try{const loginUrl=location.origin+'/login';await navigator.clipboard.writeText('Angermund Transport\\nOpen: '+loginUrl+'\\nLogin: '+u.email+'\\nPassword: '+p);notify('Login details copied')}catch{}};
      $('finishResetPassword').onclick=()=>$('modal').classList.add('hidden');
    }catch(err){notify(err.message)}
  };
}
function openRelinkDriverAccount(userId){
  const u=appUsers.find(x=>x.id===userId);if(!u)return;
  $('modalTitle').textContent='Link driver account';
  $('entryForm').innerHTML=`<div class="form-grid">
    <div class="field full"><label>Login</label><input value="${esc(u.email)}" disabled></div>
    <div class="field full"><label>Driver profile</label><select id="relinkDriverId"><option value="">Not linked</option>${db.drivers.map(d=>`<option value="${d.id}" ${d.id===u.driverId?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div>
    <div class="form-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="primary">Save link</button></div>
  </div>`;
  $('modal').classList.remove('hidden');
  $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  $('entryForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      await api('/api/users/'+encodeURIComponent(userId),{method:'PATCH',body:{driverId:$('relinkDriverId').value||null}});
      $('modal').classList.add('hidden');await loadDriverAccounts(true);notify('Driver link updated');
    }catch(err){notify(err.message)}
  };
}
async function toggleDriverAccount(userId,active){
  const u=appUsers.find(x=>x.id===userId);if(!u)return;
  if(!confirm((active?'Activate ':'Deactivate ')+u.name+'?'))return;
  try{
    await api('/api/users/'+encodeURIComponent(userId),{method:'PATCH',body:{active}});
    await loadDriverAccounts(true);
    notify(active?'Driver login activated':'Driver login deactivated');
  }catch(e){notify(e.message)}
}
function wireDriverAccounts(){
  if(!usersLoaded){setTimeout(()=>loadDriverAccounts(),0);return}
  if($('copyDriverLoginLink'))$('copyDriverLoginLink').onclick=async()=>{const url=location.origin+'/login';try{await navigator.clipboard.writeText(url);notify('Driver login link copied')}catch{prompt('Copy this driver login link:',url)}};
  if($('refreshDriverAccounts'))$('refreshDriverAccounts').onclick=()=>loadDriverAccounts(true);
  if($('createDriverAccount'))$('createDriverAccount').onclick=()=>openDriverAccountForm();
  document.querySelectorAll('.create-driver-account-for').forEach(b=>b.onclick=()=>openDriverAccountForm(b.dataset.driver));
  document.querySelectorAll('.reset-driver-password').forEach(b=>b.onclick=()=>openResetDriverPassword(b.dataset.user));
  document.querySelectorAll('.relink-driver-account').forEach(b=>b.onclick=()=>openRelinkDriverAccount(b.dataset.user));
  document.querySelectorAll('.toggle-driver-account').forEach(b=>b.onclick=()=>toggleDriverAccount(b.dataset.user,b.dataset.active==='true'));
}
function settings(){const input=(l,id,v)=>`<div class="field" style="margin-bottom:12px"><label>${l}</label><input id="${id}" type="number" step="any" value="${v}"></div>`;return `<section class="settings-grid"><div class="panel"><h2>Operating defaults</h2>${input('Diesel price / litre','setDiesel',db.settings.dieselPrice)}${input('VAT %','setVat',db.settings.vat)}${input('Fuel warning km/L','setKml',db.settings.targetKml)}${input('Standing fee / day','setStanding',db.settings.standingFee)}${input('MDC default / 100 km','setMdcRate',num(db.settings.mdcRatePer100km)||73.30)}<button class="primary" id="saveSettings">Save defaults</button></div><div class="panel"><h2>Driver device</h2><div class="field"><label>Driver using this device</label><select id="setDriver">${db.drivers.map(d=>`<option value="${d.id}" ${d.id===currentDriver()?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div><br><button class="primary" id="saveDriver">Save driver</button></div><div class="panel"><h2>Data protection</h2><p>Backup includes linked records, rules and audit history.</p><button class="primary" id="downloadBackup">Download backup</button><br><br><button class="ghost" id="restoreBackup">Restore backup</button><br><br><button class="danger" id="resetData">Reset demonstration data</button></div></section>`}
function dataTable(title,type,heads,rows,map){return `<div class="panel"><div class="toolbar"><h2>${title}</h2><div><button class="ghost export" data-kind="${type}">Export</button> <button class="primary add-record" data-type="${type}">+ Add</button></div></div>${table(heads,rows,map)}</div>`}
function table(heads,rows,map){return `<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${map(r).map(v=>`<td>${typeof v==='string'&&/^(Active|Available|Completed|Passed|Verified|Valid|Paid|Pending|Open|Expired|Expiring|Unpaid|Review|Medium)$/.test(v)?badge(v):esc(v??'—')}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}" class="empty">No records yet</td></tr>`}</tbody></table></div>`}
const views={command,dispatch,trips,driverPortal,tasks,tracking,notifications,driverUploads:driverUploadsPage,fleet,inspections,diesel,workshop,tyres,documents,incidents,clients,invoices,roadCharges,payroll,rates,reports,automation,knowledge,driverAccounts,settings};
const forms={trip:[['date','Date','date',today()],['routeId','Route','route'],['clientId','Client','client'],['truckId','Truck','truck'],['trailerId','Trailer','trailer'],['driverId','Driver','driver'],['load','Load description','text',''],['tons','Tons','number',0],['pallets','Pallets','number',0],['startKm','Start odometer','number',0],['pricingMethod','Pricing method','select','Manual negotiated',['Flat trip','Per km','Per ton','Per pallet','Manual negotiated']],['unitRate','Unit / flat rate','number',0],['income','Agreed total / manual amount','number',0],['status','Status','select','Planned',['Planned','Loading','In transit','Delivered']]],diesel:[['date','Date','date',today()],['tripId','Trip','trip'],['truckId','Truck','truck'],['driverId','Driver','driver'],['litres','Litres','number',0],['price','Price / litre','number',26.77],['odometer','Odometer','number',0],['supplier','Supplier','text',''],['slip','Slip number','text','']],inspection:[['date','Date','date',today()],['tripId','Trip','trip'],['truckId','Truck','truck'],['driverId','Driver','driver'],['type','Inspection','select','Pre-trip',['Pre-trip','Post-trip','Workshop']],['defects','Defects / notes','textarea','']],incident:[['date','Date','date',today()],['type','Incident type','select','Vehicle damage',['Accident','Vehicle damage','Cargo damage','Property damage','Safety breach','Unauthorized use','Attendance / no-show']],['tripId','Trip','trip'],['truckId','Truck','truck'],['driverId','Driver / employee','driver'],['severity','Severity','select','Medium',['Low','Medium','High','Critical']],['description','What happened','textarea',''],['action','Immediate action','textarea','']],permit:[['type','Document type','text',''],['ownerType','Owner type','select','truck',['truck','trailer','driver','company']],['ownerId','Owner ID / asset ID','text',''],['reference','Reference','text',''],['issued','Issued','date',today()],['expiry','Expiry','date','']],maintenance:[['date','Date','date',today()],['truckId','Vehicle','truck'],['type','Work / service','text',''],['supplier','Supplier','text',''],['odometer','Odometer','number',0],['cost','Cost','number',0],['nextService','Next service KM','number',0],['status','Status','select','Open',['Open','In progress','Completed']]],tyre:[['serial','Serial / ID','text',''],['truckId','Vehicle','truck'],['position','Position','text',''],['brand','Brand','text',''],['fittedKm','Fitted KM','number',0],['currentKm','Current KM','number',0],['cost','Cost','number',0],['status','Status','select','Good',['Good','Monitor','Replace','Removed']]],invoice:[['number','Invoice number','text',''],['date','Date','date',today()],['clientId','Client','client'],['tripId','Trip','trip'],['amount','Amount','number',0],['due','Due date','date',''],['status','Status','select','Unpaid',['Unpaid','Part Paid','Paid','Overdue']]],advance:[['date','Date','date',today()],['driverId','Driver','driver'],['tripId','Trip','trip'],['type','Type','select','Food / trip advance',['Food / trip advance','Toll advance','Border advance','Other']],['amount','Amount','number',0],['status','Status','select','Issued',['Requested','Issued','Reconciled']]],payroll:[['period','Period','month',''],['employeeId','Employee','driver'],['days','Days worked','number',0],['overtime','Overtime hours','number',0],['base','Base pay','number',0],['incentive','Incentive','number',0],['deductions','Deductions','number',0],['status','Status','select','Draft',['Draft','Approved','Paid']]],client:[['name','Client name','text',''],['terms','Payment terms','number',30],['contact','Contact','text',''],['email','Email','email',''],['status','Status','select','Active',['Active','Inactive']]],route:[['name','Route name','text',''],['distance','Distance','number',0],['namibiaKm','Namibian-road km for MDC','number',0],['rate','Standard rate','number',0],['crossBorder','Cross-border','select','false',['false','true']],['roundTrip','Round trip / returns','select','false',['false','true']],['loadName','Loading point name','text',''],['loadLat','Loading latitude','number',0],['loadLon','Loading longitude','number',0],['offloadName','Offloading point name','text',''],['offloadLat','Offloading latitude','number',0],['offloadLon','Offloading longitude','number',0],['approachKm','Approaching alert km','number',5],['arrivalKm','Arrival zone km','number',2],['notes','Notes','textarea','']]};
forms.expense=[['date','Date','date',today()],['tripId','Trip','trip'],['truckId','Truck','truck'],['driverId','Driver','driver'],['category','Expense type','select','Toll',['Toll','Mass distance charge (MDC)','Border permit','Parking','Loading / offloading','Accommodation','Meals','Emergency repair','Other']],['supplier','Supplier / place','text',''],['amount','Amount','number',0],['receiptNo','Receipt number','text',''],['notes','Reason / notes','textarea','']];
forms.tripIssue=[['date','Date','date',today()],['tripId','Trip','trip'],['truckId','Truck','truck'],['driverId','Driver','driver'],['type','What went wrong','select','Delay',['Delay','Breakdown','Tyre problem','Route deviation','Border delay','Load shortage','Cargo damage','Customer / offloading issue','Accident','Other']],['location','Location','text',''],['cost','Related cost','number',0],['description','Full description','textarea',''],['action','Action taken','textarea','']];
forms.payment=[['invoiceId','Invoice','invoice'],['date','Payment date','date',today()],['amount','Amount received','number',0],['method','Payment method','select','Bank transfer',['Bank transfer','Cash deposit','Card','Cheque','Other']],['reference','Bank / payment reference','text',''],['proof','Proof of payment reference','text',''],['notes','Payment notes','textarea','']];
function options(type){return {truck:db.trucks.map(x=>[x.id,x.registration]),trailer:db.trailers.map(x=>[x.id,x.registration]),driver:db.drivers.map(x=>[x.id,x.name]),client:db.clients.map(x=>[x.id,x.name]),route:db.routes.map(x=>[x.id,x.name]),trip:db.trips.map(x=>[x.id,`${x.number} · ${route(x.routeId)}`]),invoice:db.invoices.filter(x=>invoiceBalance(x)>.005).map(x=>[x.id,`${x.number} · ${client(x.clientId)} · ${money(invoiceBalance(x))} due`])}[type]||[]}
function openForm(type,prefill={}){formType=type;const list=forms[type];if(!list)return notify(`Open ${type} from its linked workflow`);$('modalTitle').textContent=`Add ${type}`;$('entryForm').innerHTML=`<div class="form-grid">${list.map(([key,label,kind,def,vals])=>{const value=prefill[key]??def??'',opts=kind==='select'?(vals||[]).map(v=>[String(v),String(v)]):options(kind);if(opts.length)return `<div class="field"><label>${label}</label><select name="${key}"><option value="">Select…</option>${opts.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;if(kind==='textarea')return `<div class="field full"><label>${label}</label><textarea name="${key}" rows="3">${esc(value)}</textarea></div>`;return `<div class="field"><label>${label}</label><input name="${key}" type="${kind}" step="any" value="${esc(value)}"></div>`}).join('')}<div class="form-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="primary">Save & link record</button></div></div>`;$('modal').classList.remove('hidden');$('cancelForm').onclick=()=>$('modal').classList.add('hidden')}
async function saveForm(e){e.preventDefault();const o={id:uid(formType)};new FormData($('entryForm')).forEach((v,k)=>o[k]=v);['tons','pallets','startKm','income','litres','price','odometer','cost','nextService','fittedKm','currentKm','amount','days','overtime','base','incentive','deductions','distance','rate','terms','unitRate','loadLat','loadLon','offloadLat','offloadLon','approachKm','arrivalKm','namibiaKm'].forEach(k=>{if(k in o)o[k]=num(o[k])});if(o.crossBorder)o.crossBorder=o.crossBorder==='true';if('roundTrip' in o)o.roundTrip=o.roundTrip==='true';const map={trip:'trips',diesel:'diesel',expense:'expenses',tripIssue:'tripIssues',payment:'payments',inspection:'inspections',incident:'incidents',permit:'permits',maintenance:'maintenance',tyre:'tyres',invoice:'invoices',advance:'advances',payroll:'payroll',client:'clients',route:'routes'},key=map[formType];if(formType==='trip'){try{const result=await api('/api/admin/trips',{method:'POST',body:o});const state=await api('/api/state');if(state.payload&&Object.keys(state.payload).length){db=merge(state.payload);localStorage.setItem(STORE,JSON.stringify(db))}$('modal').classList.add('hidden');render();notify((result.trip?.number||'Trip')+' saved and assigned to '+driver(result.trip?.driverId));return}catch(err){notify(err.message);return}}if(formType==='diesel'){o.verified=false;const t=get('trips',o.tripId);if(t.id)t.dieselCost=sum(linked('diesel','tripId',t.id),x=>num(x.litres)*num(x.price))+num(o.litres)*num(o.price)}if(formType==='expense'){o.status=o.receiptNo?'Review':'Receipt missing';o.reimbursable=true}if(formType==='tripIssue')o.status='Open';if(formType==='invoice'){o.status='Unpaid';o.paidAmount=0;o.balance=o.amount}if(formType==='payment'){const inv=get('invoices',o.invoiceId),balance=invoiceBalance(inv);if(!inv.id||o.amount<=0)return notify('Select an invoice and enter a valid payment amount');if(o.amount>balance+.005)return notify(`Payment exceeds the outstanding balance of ${money(balance)}`)}if(formType==='inspection'){o.items={tyres:true,lights:true,brakes:true,fluids:true,documents:true,load:true};o.score=o.defects?80:100;o.status=o.defects?'Failed':'Passed'}if(formType==='incident')o.status='Open';if(formType==='permit')o.status='Active';db[key].unshift(o);if(formType==='payment')refreshInvoiceStatus(get('invoices',o.invoiceId));$('modal').classList.add('hidden');commit(formType==='payment'?`Payment of ${money(o.amount)} recorded for ${get('invoices',o.invoiceId).number}`:`${formType} record created`,formType,o.id)}
async function advanceTrip(id){
  let t=get('trips',id);if(!t.id)return;
  const legs=tripLegs(t);
  if(num(t.stage)===4){
    if(legs.some(x=>!x.pod)&&!t.pod)return notify('POD is required for every journey leg before invoicing');
    const uninvoiced=legs.filter(x=>!x.invoiceId);
    if(legs.length>1&&uninvoiced.length){
      openTrip(id);return notify('Create the invoice for each journey leg/client separately')
    }
    if(legs.length===1&&!legs[0].invoiceId){
      try{
        const r=await api('/api/admin/trips/'+encodeURIComponent(id)+'/legs/'+encodeURIComponent(legs[0].id)+'/invoice',{method:'POST'});
        await refreshCentralState(false);notify((r.invoice?.number||'Invoice')+' created');return
      }catch(e){return notify(e.message)}
    }
    await refreshCentralState(false);return
  }
  if(num(t.stage)>=5){
    t=get('trips',id);t.status='Closed';t.stage=6;
    get('trucks',t.truckId).status='Available';get('drivers',t.driverId).status='Available';
    commit(t.number+' journey closed','trip',t.id);return
  }
  t.stage=Math.max(1,num(t.stage))+1;
  t.status={2:'Loading',3:'In transit',4:'Delivered'}[t.stage]||t.status;
  const active=activeJourneyLeg(t);
  if(active){
    if(t.stage===2)active.status='Loading';
    if(t.stage===3)active.status='In transit';
    if(t.stage===4){active.status='At offloading';if(!db.tasks.some(x=>x.linkedId===t.id&&x.legId===active.id&&/POD/i.test(x.title)&&x.status==='Open'))db.tasks.unshift({id:uid('task'),title:'Upload POD for '+t.number+(legs.length>1?' · '+active.label:''),ownerRole:'Driver',linkedType:'trip',linkedId:t.id,legId:active.id,due:today(),priority:'High',status:'Open'})}
  }
  if(t.stage===3){get('trucks',t.truckId).status='On trip';get('drivers',t.driverId).status='On trip'}
  commit(t.number+' moved to '+t.status,'trip',t.id)
}
function legAllocatedCost(t,leg){
  const allFuel=linked('diesel','tripId',t.id),allExp=linked('expenses','tripId',t.id),totalDist=Math.max(1,journeyDistance(t)),share=Math.max(0,num(leg.distance))/totalDist;
  const directFuel=sum(allFuel.filter(x=>x.legId===leg.id),fuelRecordCost),unassignedFuel=sum(allFuel.filter(x=>!x.legId),fuelRecordCost);
  const directExp=sum(allExp.filter(x=>x.legId===leg.id),x=>x.amount),unassignedExp=sum(allExp.filter(x=>!x.legId),x=>x.amount);
  const legacy=tripFinancials(t).legacyToll+tripFinancials(t).allowance+tripFinancials(t).other;
  return directFuel+directExp+share*(unassignedFuel+unassignedExp+legacy)
}
function legContribution(t,leg){return legIncomeClient(leg)-legAllocatedCost(t,leg)}
function journeyLegCard(t,leg){
  const canEdit=['admin','manager','dispatcher','finance'].includes(role),cost=legAllocatedCost(t,leg),contribution=legContribution(t,leg),inv=leg.invoiceId?get('invoices',leg.invoiceId):{};
  return `<article class="journey-leg-card ${activeJourneyLeg(t)?.id===leg.id?'active':''}">
    <div class="journey-leg-head"><div><small>LEG ${num(leg.sequence)} · ${esc(leg.label||'Load')}</small><h3>${esc(route(leg.routeId))}</h3></div>${badge(leg.status||'Planned')}</div>
    <div class="journey-leg-grid">
      <div><span>Client</span><b>${esc(client(leg.clientId))}</b></div>
      <div><span>Cargo</span><b>${esc(leg.load||'—')}</b></div>
      <div><span>Quantity</span><b>${num(leg.tons)?num(leg.tons)+' t':num(leg.pallets)?num(leg.pallets)+' pallets':'—'}</b></div>
      <div><span>Distance</span><b>${num(leg.distance).toLocaleString()} km</b></div>
      <div><span>Pricing</span><b>${esc(legPricingLabel(leg))}</b></div>
      <div><span>Leg income</span><b>${money(legIncomeClient(leg))}</b></div>
      <div><span>Allocated cost</span><b>${money(cost)}</b></div>
      <div><span>Contribution</span><b class="${contribution>=0?'positive':'negative'}">${money(contribution)}</b></div>
    </div>
    <div class="journey-leg-foot"><span>${leg.pod?'✓ POD':'POD missing'}${inv.id?' · '+esc(inv.number):''}</span><div>
      ${canEdit?`<button type="button" class="ghost small edit-journey-leg" data-leg="${leg.id}">Edit</button>`:''}
      ${canEdit&&tripLegs(t).length>1&&!leg.invoiceId?`<button type="button" class="ghost small remove-journey-leg" data-leg="${leg.id}">Remove</button>`:''}
      ${['admin','manager','finance'].includes(role)&&leg.pod&&!leg.invoiceId?`<button type="button" class="primary small invoice-journey-leg" data-leg="${leg.id}">Create invoice</button>`:''}
      ${inv.id?`<button type="button" class="link-button open-invoice" data-id="${inv.id}">Open invoice</button>`:''}
    </div></div>
  </article>`;
}
function journeyLegAmountPreview(){
  const method=$('jlPricing')?.value||'Manual negotiated',rate=num($('jlRate')?.value),distance=num($('jlDistance')?.value),tons=num($('jlTons')?.value),pallets=num($('jlPallets')?.value),manual=num($('jlAmount')?.value);
  let amount=manual,label='Negotiated amount';
  if(method==='Per km'){amount=rate*distance;label=distance.toLocaleString()+' km × '+money(rate)}
  else if(method==='Per ton'){amount=rate*tons;label=num(tons).toFixed(2)+' t × '+money(rate)}
  else if(method==='Per pallet'){amount=rate*pallets;label=num(pallets)+' pallets × '+money(rate)}
  else if(method==='Flat trip'){amount=rate||manual;label='Flat trip rate'}
  if($('jlPreview'))$('jlPreview').innerHTML='<span>'+esc(label)+'</span><b>'+money(amount)+'</b>';
}
function openJourneyLegForm(tripId,legId='',returnLoad=false){
  const t=get('trips',tripId),existing=legId?tripLegs(t).find(x=>x.id===legId):null,last=tripLegs(t).slice(-1)[0],defaultRoute=existing?.routeId||(returnLoad?reverseRouteId(last?.routeId):last?.routeId)||db.routes[0]?.id||'',r=get('routes',defaultRoute);
  const leg=existing||{label:returnLoad?'Return / Backload':'Additional load',routeId:defaultRoute,clientId:'',load:'',tons:0,pallets:0,distance:num(r.distance),namibiaKm:num(r.namibiaKm),pricingMethod:'Manual negotiated',unitRate:0,agreedAmount:0,status:'Planned'};
  $('modalTitle').textContent=(existing?'Edit':'Add')+' journey leg · '+t.number;
  $('entryForm').innerHTML=`<div class="journey-leg-form">
    <div class="notice"><b>${returnLoad&&!existing?'Return/backload leg':'Journey leg'}</b><br>Each leg can have its own client, cargo, route and pricing. The parent journey totals update automatically.</div>
    <div class="form-grid">
      <div class="field"><label>Leg label</label><input id="jlLabel" value="${esc(leg.label||'')}"></div>
      <div class="field"><label>Status</label><select id="jlStatus">${['Planned','Loading','In transit','At offloading','Delivered'].map(x=>`<option ${x===leg.status?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field full"><label>Route</label><select id="jlRoute">${db.routes.map(x=>`<option value="${x.id}" ${x.id===leg.routeId?'selected':''}>${esc(x.name)} · ${num(x.distance).toLocaleString()} km</option>`).join('')}</select></div>
      <div class="field full"><label>Client</label><select id="jlClient"><option value="">Select client…</option>${db.clients.map(x=>`<option value="${x.id}" ${x.id===leg.clientId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field full"><label>Cargo / load</label><input id="jlLoad" value="${esc(leg.load||'')}" placeholder="e.g. Charcoal / furniture"></div>
      <div class="field"><label>Tons</label><input id="jlTons" type="number" step="0.01" value="${num(leg.tons)}"></div>
      <div class="field"><label>Pallets</label><input id="jlPallets" type="number" step="1" value="${num(leg.pallets)}"></div>
      <div class="field"><label>Distance (km)</label><input id="jlDistance" type="number" step="0.1" value="${num(leg.distance)||num(r.distance)}"></div>
      <div class="field"><label>Namibian road km</label><input id="jlNamibiaKm" type="number" step="0.1" value="${num(leg.namibiaKm)||num(r.namibiaKm)}"></div>
      <div class="field"><label>Pricing method</label><select id="jlPricing">${['Flat trip','Per km','Per ton','Per pallet','Manual negotiated'].map(x=>`<option ${x===leg.pricingMethod?'selected':''}>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Unit / flat rate</label><input id="jlRate" type="number" step="0.01" value="${num(leg.unitRate)}"></div>
      <div class="field full"><label>Negotiated/manual total</label><input id="jlAmount" type="number" step="0.01" value="${num(leg.agreedAmount||leg.income)}"></div>
    </div>
    <div class="journey-leg-quote" id="jlPreview"></div>
    <div class="form-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="primary">${existing?'Save leg':'Add leg to journey'}</button></div>
  </div>`;
  $('modal').classList.remove('hidden');
  const routeChanged=()=>{const rr=get('routes',$('jlRoute').value);$('jlDistance').value=num(rr.distance);$('jlNamibiaKm').value=rr.crossBorder?(num(rr.namibiaKm)||0):num(rr.distance);journeyLegAmountPreview()};
  $('jlRoute').onchange=routeChanged;
  ['jlPricing','jlRate','jlDistance','jlTons','jlPallets','jlAmount'].forEach(id=>$(id).oninput=journeyLegAmountPreview);
  journeyLegAmountPreview();
  $('cancelForm').onclick=()=>openTrip(tripId);
  $('entryForm').onsubmit=async e=>{
    e.preventDefault();
    const body={label:$('jlLabel').value.trim(),status:$('jlStatus').value,routeId:$('jlRoute').value,clientId:$('jlClient').value,load:$('jlLoad').value.trim(),tons:num($('jlTons').value),pallets:num($('jlPallets').value),distance:num($('jlDistance').value),namibiaKm:num($('jlNamibiaKm').value),pricingMethod:$('jlPricing').value,unitRate:num($('jlRate').value),agreedAmount:num($('jlAmount').value)};
    if(!body.clientId)return notify('Select a client');
    if(!body.routeId)return notify('Select a route');
    try{
      const url='/api/admin/trips/'+encodeURIComponent(tripId)+'/legs'+(existing?'/'+encodeURIComponent(existing.id):'');
      await api(url,{method:existing?'PATCH':'POST',body});
      await refreshCentralState(false);openTrip(tripId);notify(existing?'Journey leg updated':'Journey leg added')
    }catch(err){notify(err.message)}
  };
}
async function removeJourneyLeg(tripId,legId){
  if(!confirm('Remove this leg from the journey?'))return;
  try{await api('/api/admin/trips/'+encodeURIComponent(tripId)+'/legs/'+encodeURIComponent(legId),{method:'DELETE'});await refreshCentralState(false);openTrip(tripId);notify('Journey leg removed')}catch(e){notify(e.message)}
}
async function invoiceJourneyLeg(tripId,legId){
  try{const r=await api('/api/admin/trips/'+encodeURIComponent(tripId)+'/legs/'+encodeURIComponent(legId)+'/invoice',{method:'POST'});await refreshCentralState(false);openTrip(tripId);notify((r.invoice?.number||'Invoice')+' created for '+client(r.leg?.clientId))}catch(e){notify(e.message)}
}
function openTrip(id){
  const t=get('trips',id),legs=tripLegs(t),fuel=linked('diesel','tripId',id),expenses=linked('expenses','tripId',id),issues=linked('tripIssues','tripId',id),settlement=tripSettlement(t),m=settlement.fuel;
  const dieselSpend=tripDieselSpend(t),expenseSpend=tripRouteExpenseSpend(t),totalCost=tripCost(t),contribution=tripProfit(t);
  $('modalTitle').textContent=`${t.number} · ${legs.length} leg${legs.length===1?'':'s'} · ${truck(t.truckId)}`;
  $('entryForm').innerHTML=
    `<div class="trip-live-summary">
      <div><span>Journey income</span><b>${money(journeyIncome(t))}</b></div>
      <div><span>Distance</span><b>${journeyDistance(t).toLocaleString()} km</b></div>
      <div><span>Diesel</span><b>${money(dieselSpend)}</b></div>
      <div><span>Route expenses</span><b>${money(expenseSpend)}</b></div>
      <div><span>Total trip cost</span><b>${money(totalCost)}</b></div>
      <div><span>Journey contribution</span><b class="${contribution>=0?'positive':'negative'}">${money(contribution)}</b></div>
    </div>
    <div class="journey-summary-bar"><div><b>${esc(truck(t.truckId))}</b><span>${esc(trailer(t.trailerId))}</span></div><div><b>${esc(driver(t.driverId))}</b><span>${esc(t.date)}</span></div><div><b>${legs.length} priced leg${legs.length===1?'':'s'}</b><span>${legs.filter(x=>x.invoiceId).length} invoiced</span></div></div>
    <div class="journey-leg-toolbar"><h3>Journey legs / loads</h3><div><button type="button" class="ghost" id="addJourneyLeg">+ Add leg</button><button type="button" class="primary" id="addReturnLeg">↩ Add return / backload</button></div></div>
    <div class="journey-leg-list">${legs.map(x=>journeyLegCard(t,x)).join('')}</div>
    <div class="split-3">
      <div><h3>Diesel performance</h3><p>${m.ready?`${m.kmPerL.toFixed(2)} km/L<br>${m.litresPerKm.toFixed(3)} L/km<br>${m.litresPer100Km.toFixed(1)} L/100 km`:'Awaiting distance and diesel'}<br>${fuel.length} slip(s) · ${num(m.litres).toFixed(2)} L</p></div>
      <div><h3>Driver settlement</h3><p>Incentive ${money(settlement.incentive)}${settlement.rate?`<br><small>${m.distance.toLocaleString()} km × ${money(settlement.rate)}/km</small>`:''}<br>Approved expenses ${money(settlement.reimbursable)}<br>Advances ${money(settlement.advances)}<br><b>Amount due ${money(settlement.due)}</b></p></div>
      <div><h3>Invoice control</h3><p>${legs.filter(x=>x.invoiceId).length}/${legs.length} leg invoices created.<br>${legs.length>1?'Each client/load invoices separately.':'Single-load journeys can use the normal invoice flow.'}</p></div>
    </div>
    <h3>Diesel slips</h3>
    ${fuel.length?fuel.map(x=>`<div class="approval"><span><b>${num(x.litres).toFixed(2)} L · ${money(fuelRecordCost(x))}</b><small>${esc(x.supplier||'Unknown supplier')} · ${money(x.price)}/L${x.legId?' · Leg '+num(legs.find(l=>l.id===x.legId)?.sequence):''} · Slip: ${esc(x.slip||'—')}</small></span><span>${x.verified?badge('Verified'):badge('Review')}</span></div>`).join(''):'<div class="empty">No diesel captured</div>'}
    <h3>Route expenses & receipts</h3>
    ${expenses.length?expenses.map(x=>`<div class="approval"><span><b>${esc(x.category)} · ${money(x.amount)}</b><small>${esc(x.supplier||'')} ${x.legId?'· Leg '+num(legs.find(l=>l.id===x.legId)?.sequence)+' ':''}· Receipt: ${esc(x.receiptNo||'MISSING')}</small></span><span>${badge(x.status)} ${x.status==='Review'&&['admin','manager','finance'].includes(role)?`<button type="button" class="link-button approve-trip-expense" data-id="${x.id}">Approve</button>`:''}</span></div>`).join(''):'<div class="empty">No route expenses captured</div>'}
    <h3>What went wrong on this journey</h3>
    ${issues.length?issues.map(x=>`<div class="policy ${x.status==='Open'?'critical':''}"><h3>${esc(x.type)} · ${esc(x.location||'Location not recorded')}</h3><p>${esc(x.description)}<br><b>Action:</b> ${esc(x.action||'Pending')} · Cost ${money(x.cost)}</p></div>`).join(''):'<div class="empty">No trip problems reported</div>'}
    <div class="form-actions">
      <button type="button" class="ghost" id="cancelForm">Close</button>
      <button type="button" class="ghost" id="refreshTripValues">↻ Refresh values</button>
      <button type="button" class="ghost" id="addExpenseModal">Add expense</button>
      <button type="button" class="ghost" id="addMdcModal">MDC charge</button>
      <button type="button" class="ghost" id="addIssueModal">Report problem</button>
      <button type="button" class="primary" id="advanceFromModal">Advance workflow</button>
    </div>`;
  $('modal').classList.remove('hidden');
  $('cancelForm').onclick=()=>$('modal').classList.add('hidden');
  $('refreshTripValues').onclick=async()=>{await refreshCentralState(false);openTrip(id);notify('Journey values refreshed')};
  $('addJourneyLeg').onclick=()=>openJourneyLegForm(id);
  $('addReturnLeg').onclick=()=>openJourneyLegForm(id,'',true);
  document.querySelectorAll('.edit-journey-leg').forEach(b=>b.onclick=()=>openJourneyLegForm(id,b.dataset.leg));
  document.querySelectorAll('.remove-journey-leg').forEach(b=>b.onclick=()=>removeJourneyLeg(id,b.dataset.leg));
  document.querySelectorAll('.invoice-journey-leg').forEach(b=>b.onclick=()=>invoiceJourneyLeg(id,b.dataset.leg));
  document.querySelectorAll('.open-invoice').forEach(b=>b.onclick=()=>openInvoice(b.dataset.id));
  $('addExpenseModal').onclick=()=>openForm('expense',{tripId:id,truckId:t.truckId,driverId:t.driverId});
  $('addMdcModal').onclick=()=>{$('modal').classList.add('hidden');mdcTripPrefill=id;go('roadCharges')};
  $('addIssueModal').onclick=()=>openForm('tripIssue',{tripId:id,truckId:t.truckId,driverId:t.driverId});
  document.querySelectorAll('.approve-trip-expense').forEach(b=>b.onclick=()=>{get('expenses',b.dataset.id).status='Approved';commit(`Receipt approved for ${t.number}`,'expense',b.dataset.id);openTrip(id)});
  $('advanceFromModal').onclick=()=>{$('modal').classList.add('hidden');advanceTrip(t.id)}
}
function rateResult(){const v=id=>num($(id).value),distance=v('rcDistance'),litres=distance/Math.max(.1,v('rcKml')),diesel=litres*v('rcDiesel'),mdc=v('rcNamibiaKm')/100*v('rcMdcRate'),standing=v('rcWaiting')*db.settings.standingFee,cost=diesel+mdc+v('rcDriver')+v('rcTolls')+v('rcWear')+v('rcOther')+standing,margin=Math.min(90,v('rcMargin'))/100,rate=cost/(1-margin),vat=rate*db.settings.vat/100;$('rateResult').innerHTML=`<div class="metric-line"><span>Diesel required</span><b>${litres.toFixed(1)} L</b></div><div class="metric-line"><span>Diesel cost</span><b>${money(diesel)}</b></div><div class="metric-line"><span>MDC charge</span><b>${money(mdc)}</b></div><div class="metric-line"><span>Standing charges</span><b>${money(standing)}</b></div><div class="metric-line"><span>Total cost</span><b>${money(cost)}</b></div><div class="metric-line"><span>Rate excl. VAT</span><b class="positive">${money(rate)}</b></div><div class="metric-line"><span>VAT</span><b>${money(vat)}</b></div><div class="metric-line"><span>Quote incl. VAT</span><b>${money(rate+vat)}</b></div><div class="metric-line"><span>Expected profit</span><b>${money(rate-cost)}</b></div>`}
function openInvoice(id){const i=get('invoices',id);refreshInvoiceStatus(i);const payments=linked('payments','invoiceId',id);$('modalTitle').textContent=`${i.number} · ${client(i.clientId)}`;$('entryForm').innerHTML=`<div class="split-3"><div><span>Invoice amount</span><h3>${money(i.amount)}</h3><p>${esc(i.date)} · Due ${esc(i.due||'—')}</p></div><div><span>Received</span><h3 class="positive">${money(invoicePaid(id))}</h3><p>${payments.length} payment(s)</p></div><div><span>Outstanding</span><h3>${money(invoiceBalance(i))}</h3><p>${badge(i.status)}</p></div></div><h3>Payment history</h3>${payments.length?payments.map(p=>`<div class="approval"><span><b>${money(p.amount)}</b><small>${esc(p.date)} · ${esc(p.method)} · ${esc(p.reference||'No reference')}</small></span><span>${esc(p.proof||'No proof reference')}</span></div>`).join(''):'<div class="empty">No payments recorded</div>'}<div class="form-actions"><button type="button" class="ghost" id="cancelForm">Close</button>${invoiceBalance(i)>.005?'<button type="button" class="primary" id="recordPayment">Record payment</button>':''}</div>`;$('modal').classList.remove('hidden');$('cancelForm').onclick=()=>$('modal').classList.add('hidden');if($('recordPayment'))$('recordPayment').onclick=()=>openForm('payment',{invoiceId:id,amount:invoiceBalance(i)})}
function download(name,data,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function exportWorkbook(kind){const definitions={trips:{title:'Trips and Loads',columns:[['number','Trip'],['date','Date','date'],['route','Route'],['client','Client'],['truck','Truck'],['trailer','Trailer'],['driver','Driver'],['load','Load'],['tons','Tons','number'],['pallets','Pallets','number'],['distance','Distance km','number'],['income','Income','currency'],['dieselCost','Diesel Cost','currency'],['otherCosts','Other Costs','currency'],['profit','Contribution','currency'],['status','Status'],['pod','POD']],rows:db.trips.map(t=>({...t,route:journeyRouteLabel(t),client:tripLegs(t).map(l=>client(l.clientId)).join(' / '),truck:truck(t.truckId),trailer:trailer(t.trailerId),driver:driver(t.driverId),load:journeyLoadLabel(t),tons:sum(tripLegs(t),x=>x.tons),pallets:sum(tripLegs(t),x=>x.pallets),distance:journeyDistance(t),income:journeyIncome(t),dieselCost:tripDieselSpend(t),otherCosts:tripRouteExpenseSpend(t),profit:tripProfit(t),pod:tripLegs(t).every(x=>x.pod)?'Received':'Missing'}))},invoice:{title:'Invoices and Debtors',columns:[['number','Invoice'],['date','Invoice Date','date'],['client','Client'],['trip','Trip'],['amount','Invoice Amount','currency'],['received','Received','currency'],['balance','Outstanding','currency'],['due','Due Date','date'],['status','Status']],rows:db.invoices.map(i=>({...i,client:client(i.clientId),trip:get('trips',i.tripId).number||'',received:invoicePaid(i.id),balance:invoiceBalance(i)}))},diesel:{title:'Diesel Control',columns:[['date','Date','date'],['trip','Trip'],['truck','Truck'],['driver','Driver'],['litres','Litres','number'],['price','Price per Litre','currency'],['total','Total Cost','currency'],['odometer','Odometer','number'],['supplier','Supplier'],['slip','Slip'],['verified','Verified']],rows:db.diesel.map(x=>({...x,trip:get('trips',x.tripId).number||'',truck:truck(x.truckId),driver:driver(x.driverId),total:fuelRecordCost(x),verified:x.verified?'Yes':'No'}))}};let d=definitions[kind];if(!d){const key={tyre:'tyres',advance:'advances',expense:'expenses'}[kind]||kind,rows=db[key]||[];if(!rows.length)return notify('No data to export');const keys=[...new Set(rows.flatMap(Object.keys))];d={title:kind[0].toUpperCase()+kind.slice(1),columns:keys.filter(k=>typeof rows.find(x=>x[k]!=null)?.[k]!=='object').map(k=>[k,k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase())]),rows}}if(!d.rows.length)return notify('No data to export');const body={title:d.title,columns:d.columns.map(([key,label,type])=>({key,label,type})),rows:d.rows};try{const res=await fetch(`/api/export/${encodeURIComponent(kind)}`,{method:'POST',headers:{Authorization:`Bearer ${authToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!res.ok){const x=await res.json().catch(()=>({}));throw Error(x.error||'Excel export failed')}const blob=await res.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${kind}-${today()}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);notify('Excel workbook downloaded')}catch(e){notify(e.message)}}
const exportCsv=exportWorkbook;
function backup(){download(`Angermund_Transport_Operations_${today()}.json`,JSON.stringify(db,null,2))}
function restore(file){const reader=new FileReader();reader.onload=()=>{try{const n=JSON.parse(reader.result);if(!n.trips||!n.trucks)throw Error('Invalid transport backup');db=merge(n);commit('Backup restored')}catch(e){notify(e.message)}};reader.readAsText(file)}
function notify(msg){$('toast').textContent=msg;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2400)}
function clientGeoDistanceM(a,b){
  const R=6371000,p=x=>x*Math.PI/180,dLat=p(b.latitude-a.latitude),dLon=p(b.longitude-a.longitude),q=Math.sin(dLat/2)**2+Math.cos(p(a.latitude))*Math.cos(p(b.latitude))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}
async function postDriverGpsPosition(position){
  const t=db.trips.filter(x=>x.driverId===currentDriver()&&!x.driverComplete&&!['Closed','Invoiced'].includes(x.status)).sort(driverTripSort)[0];
  if(!t?.id)return;
  const now=Date.now(),pt={latitude:position.coords.latitude,longitude:position.coords.longitude};
  const moved=lastDriverGpsPoint?clientGeoDistanceM(lastDriverGpsPoint,pt):Infinity;
  if(now-lastDriverGpsSentAt<30000)return;
  if(now-lastDriverGpsSentAt<90000&&moved<150)return;
  try{
    await api('/api/gps',{method:'POST',body:{vehicleId:t.truckId,driverId:currentDriver(),tripId:t.id,latitude:pt.latitude,longitude:pt.longitude,speed:(position.coords.speed||0)*3.6,heading:position.coords.heading||0,accuracy:position.coords.accuracy,recordedAt:new Date(position.timestamp||Date.now()).toISOString()}});
    lastDriverGpsSentAt=now;lastDriverGpsPoint=pt;
  }catch{}
}
function nativeBackgroundGpsAvailable(){return Boolean(window.AngermundNative&&typeof window.AngermundNative.startBackgroundGps==='function')}
function startNativeBackgroundGps(){
  if(role!=='driver'||!authToken||!nativeBackgroundGpsAvailable())return false;
  try{window.AngermundNative.startBackgroundGps(authToken);return true}catch{return false}
}
function stopNativeBackgroundGps(){
  if(!nativeBackgroundGpsAvailable()||typeof window.AngermundNative.stopBackgroundGps!=='function')return false;
  try{window.AngermundNative.stopBackgroundGps();return true}catch{return false}
}
function startDriverGpsWatch(){
  if(role!=='driver')return;
  if(startNativeBackgroundGps())return;
  if(driverGeoWatchId!==null||!navigator.geolocation)return;
  driverGeoWatchId=navigator.geolocation.watchPosition(postDriverGpsPosition,e=>{if(e.code===1&&sessionStorage.getItem('driver_gps_denied')!=='1'){sessionStorage.setItem('driver_gps_denied','1');notify('Location permission is needed for automatic arrival/departure alerts')}},{enableHighAccuracy:true,maximumAge:20000,timeout:30000});
}
function stopDriverGpsWatch(){
  if(driverGeoWatchId!==null&&navigator.geolocation)navigator.geolocation.clearWatch(driverGeoWatchId);
  driverGeoWatchId=null;lastDriverGpsPoint=null;lastDriverGpsSentAt=0;
  stopNativeBackgroundGps();
}
function routeUsesRoundTrip(r){return Boolean(r?.roundTrip)||/[↔]|round\s*trip|return/i.test(String(r?.name||'')+' '+String(r?.notes||''))}
async function gpsCheckIn(){if(!navigator.geolocation)return notify('GPS is not supported on this device');const t=db.trips.find(x=>x.driverId===currentDriver()&&!['Closed','Invoiced'].includes(x.status));navigator.geolocation.getCurrentPosition(async p=>{try{await api('/api/gps',{method:'POST',body:{vehicleId:t?.truckId||'unassigned',driverId:currentDriver(),tripId:t?.id||null,latitude:p.coords.latitude,longitude:p.coords.longitude,speed:(p.coords.speed||0)*3.6,heading:p.coords.heading||0,accuracy:p.coords.accuracy}});notify('Live GPS check-in recorded')}catch(e){notify(e.message)}},e=>notify(`GPS unavailable: ${e.message}`),{enableHighAccuracy:true,timeout:15000})}
async function loadTracking(){try{[liveGps,geofences]=await Promise.all([api('/api/gps/latest'),api('/api/geofences')]);if(page==='tracking')render()}catch(e){notify(e.message)}}
async function loadNotifications(){try{serverNotifications=await api('/api/notifications');$('notificationCount').textContent=serverNotifications.filter(x=>!x.read).length;if(page==='notifications')render()}catch{}}
function drawMap(){if(page!=='tracking'||!window.L||!$('fleetMap'))return;if(mapInstance){mapInstance.remove();mapInstance=null}mapInstance=L.map('fleetMap').setView([-22.57,17.08],6);if(L.maplibreGL)L.maplibreGL({style:providerConfig.mapStyle||'https://tiles.openfreemap.org/styles/liberty'}).addTo(mapInstance);else $('fleetMap').classList.add('map-provider-fallback');geofences.forEach(f=>L.circle([f.latitude,f.longitude],{radius:f.radiusM,color:'#ffbd4a',fillOpacity:.08}).bindPopup(`<b>${esc(f.name)}</b><br>${num(f.radiusM)} m`).addTo(mapInstance));db.routes.filter(routeAutoGpsReady).forEach(r=>{const approach=(num(r.approachKm)||5)*1000,arrival=(num(r.arrivalKm)||2)*1000;[[r.loadLat,r.loadLon,r.loadName||'Loading point','Loading'],[r.offloadLat,r.offloadLon,r.offloadName||'Offloading point','Offloading']].forEach(([lat,lon,name,type])=>{L.circle([num(lat),num(lon)],{radius:approach,fillOpacity:.025,weight:1,dashArray:'6,6'}).bindPopup(`<b>${esc(name)}</b><br>${esc(type)} approach · ${approach/1000} km`).addTo(mapInstance);L.circle([num(lat),num(lon)],{radius:arrival,fillOpacity:.06,weight:2}).bindPopup(`<b>${esc(name)}</b><br>${esc(type)} arrival · ${arrival/1000} km`).addTo(mapInstance)})});liveGps.forEach(p=>L.marker([p.latitude,p.longitude]).bindPopup(`<b>${esc(truck(p.vehicleId))}</b><br>${num(p.speed).toFixed(0)} km/h`).addTo(mapInstance));if(liveGps.length)mapInstance.fitBounds(liveGps.map(p=>[p.latitude,p.longitude]),{padding:[40,40],maxZoom:14})}
function currentPhonePosition(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error('GPS is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),
      e=>reject(new Error(e.message||'Could not get current location')),
      {enableHighAccuracy:true,timeout:20000,maximumAge:5000}
    )
  })
}
function destroyGeofencePicker(){
  if(geofencePickerMap){try{geofencePickerMap.remove()}catch{}geofencePickerMap=null}
  geofencePickerMarker=null;geofencePickerCircle=null;geofenceDraftPoint=null
}
function setGeofencePickerPoint(lat,lon,zoom=true){
  lat=Number(lat);lon=Number(lon);if(!Number.isFinite(lat)||!Number.isFinite(lon)||!geofencePickerMap)return;
  geofenceDraftPoint={latitude:lat,longitude:lon};
  if(!geofencePickerMarker)geofencePickerMarker=L.marker([lat,lon],{draggable:true}).addTo(geofencePickerMap);
  else geofencePickerMarker.setLatLng([lat,lon]);
  geofencePickerMarker.off('dragend').on('dragend',e=>{const p=e.target.getLatLng();setGeofencePickerPoint(p.lat,p.lng,false)});
  const radius=Math.max(5,num($('geofenceRadius')?.value)||500);
  if(!geofencePickerCircle)geofencePickerCircle=L.circle([lat,lon],{radius,weight:2,fillOpacity:.08}).addTo(geofencePickerMap);
  else geofencePickerCircle.setLatLng([lat,lon]).setRadius(radius);
  if(zoom)geofencePickerMap.setView([lat,lon],Math.max(geofencePickerMap.getZoom(),15));
  if($('geofencePointText'))$('geofencePointText').textContent='Selected point ready · '+(radius>=1000?(radius/1000).toFixed(1)+' km':Math.round(radius)+' m')+' radius'
}
function initGeofencePicker(){
  if(!window.L||!$('geofencePickerMap'))return;
  destroyGeofencePicker();
  geofencePickerMap=L.map('geofencePickerMap',{zoomControl:true}).setView([-22.57,17.08],12);
  if(L.maplibreGL)L.maplibreGL({style:providerConfig.mapStyle||'https://tiles.openfreemap.org/styles/liberty'}).addTo(geofencePickerMap);
  else L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(geofencePickerMap);
  geofencePickerMap.on('click',e=>setGeofencePickerPoint(e.latlng.lat,e.latlng.lng,false));
  setTimeout(()=>geofencePickerMap?.invalidateSize(),120)
}
async function useCurrentGeofenceLocation(showError=true){
  try{
    if($('useCurrentGeofence')){$('useCurrentGeofence').disabled=true;$('useCurrentGeofence').textContent='📍 Getting GPS…'}
    const p=await currentPhonePosition();setGeofencePickerPoint(p.latitude,p.longitude,true);
    if($('geofenceAccuracy'))$('geofenceAccuracy').textContent='Phone GPS accuracy: ±'+Math.round(num(p.accuracy))+' m';
    return true
  }catch(e){if(showError)notify('Current location unavailable: '+e.message);return false}
  finally{if($('useCurrentGeofence')){$('useCurrentGeofence').disabled=false;$('useCurrentGeofence').textContent='📍 Use my current location'}}
}
async function addGeofence(){
  $('modalTitle').textContent='Add geofence';
  $('entryForm').innerHTML='<div class="geofence-builder">'
    +'<div class="notice"><b>No coordinates needed.</b> Your phone location is selected automatically. Tap anywhere on the map or drag the pin to choose a different spot.</div>'
    +'<div class="form-grid"><div class="field full"><label>Geofence name</label><input id="geofenceName" placeholder="e.g. NBL Windhoek, Home yard, Oshakati depot"></div>'
    +'<div class="field"><label>Radius</label><div class="geofence-radius-row"><input id="geofenceRadius" type="range" min="25" max="5000" step="25" value="500"><b id="geofenceRadiusValue">500 m</b></div></div>'
    +'<div class="field"><label>Quick radius</label><select id="geofenceRadiusPreset"><option value="100">100 m</option><option value="250">250 m</option><option value="500" selected>500 m</option><option value="1000">1 km</option><option value="2000">2 km</option><option value="5000">5 km</option></select></div></div>'
    +'<div class="geofence-map-toolbar"><button type="button" class="primary" id="useCurrentGeofence">📍 Use my current location</button><span id="geofenceAccuracy"></span></div>'
    +'<div id="geofencePickerMap" class="geofence-picker-map"></div>'
    +'<div id="geofencePointText" class="geofence-point-text">Tap the map to choose the geofence centre.</div>'
    +'<div class="driver-modal-actions"><button type="button" class="ghost" id="cancelForm">Cancel</button><button class="primary">✓ SAVE GEOFENCE</button></div></div>';
  $('modal').classList.remove('hidden');
  initGeofencePicker();
  const updateRadius=()=>{const radius=Math.max(5,num($('geofenceRadius').value)||500);$('geofenceRadiusValue').textContent=radius>=1000?(radius/1000).toFixed(radius%1000?1:0)+' km':radius+' m';if(geofencePickerCircle)geofencePickerCircle.setRadius(radius);if(geofenceDraftPoint&&$('geofencePointText'))$('geofencePointText').textContent='Selected point ready · '+(radius>=1000?(radius/1000).toFixed(1)+' km':Math.round(radius)+' m')+' radius'};
  $('geofenceRadius').oninput=updateRadius;
  $('geofenceRadiusPreset').onchange=e=>{$('geofenceRadius').value=e.target.value;updateRadius()};
  $('useCurrentGeofence').onclick=()=>useCurrentGeofenceLocation(true);
  $('cancelForm').onclick=()=>{destroyGeofencePicker();$('modal').classList.add('hidden')};
  $('entryForm').onsubmit=async e=>{
    e.preventDefault();
    const name=$('geofenceName').value.trim(),radiusM=Math.max(5,num($('geofenceRadius').value)||500);
    if(!name)return notify('Enter a geofence name');
    if(!geofenceDraftPoint)return notify('Choose the geofence position on the map or use current location');
    try{
      await api('/api/geofences',{method:'POST',body:{name,latitude:geofenceDraftPoint.latitude,longitude:geofenceDraftPoint.longitude,radiusM}});
      destroyGeofencePicker();$('modal').classList.add('hidden');await loadTracking();notify(name+' geofence saved')
    }catch(err){notify(err.message)}
  };
  setTimeout(()=>useCurrentGeofenceLocation(false),180)
}
function vapidKeyBytes(value){
  const pad='='.repeat((4-(value.length%4))%4),base64=(value+pad).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out
}
function samePushKey(a,b){
  if(!a||!b)return false;const aa=new Uint8Array(a),bb=new Uint8Array(b);if(aa.length!==bb.length)return false;for(let i=0;i<aa.length;i++)if(aa[i]!==bb[i])return false;return true
}
async function loadPushDeviceStatus(renderPage=false){
  const supported='serviceWorker'in navigator&&'PushManager'in window&&typeof Notification!=='undefined';
  let localSub=null;if(supported)try{const reg=await navigator.serviceWorker.ready;localSub=await reg.pushManager.getSubscription()}catch{}
  let server={subscriptionCount:0,subscribed:false};if(authToken)try{server=await api('/api/push/status')}catch{}
  pushDeviceStatus={supported,permission:supported?Notification.permission:'unsupported',subscribed:Boolean(localSub)&&Boolean(server.subscribed),serverCount:num(server.subscriptionCount),localSubscription:Boolean(localSub)};
  if(renderPage&&page==='notifications')render();return pushDeviceStatus
}
async function ensurePushSubscription(requestPermission=false,quiet=false){
  if(!('serviceWorker'in navigator)||!('PushManager'in window)||typeof Notification==='undefined'){pushDeviceStatus={supported:false,permission:'unsupported',subscribed:false,serverCount:0};if(!quiet)notify('Push notifications not supported on this device');return false}
  try{
    let permission=Notification.permission;
    if(requestPermission&&permission!=='granted')permission=await Notification.requestPermission();
    if(permission!=='granted'){await loadPushDeviceStatus(false);if(!quiet)notify(permission==='denied'?'Notifications are blocked for this site in Android/Chrome settings':'Push permission was not granted');return false}
    if(!providerConfig.vapidPublicKey){if(!quiet)notify('VAPID keys are not available from the server');return false}
    const reg=await navigator.serviceWorker.ready,key=vapidKeyBytes(providerConfig.vapidPublicKey);
    let sub=await reg.pushManager.getSubscription();
    if(sub&&sub.options?.applicationServerKey&&!samePushKey(sub.options.applicationServerKey,key)){await sub.unsubscribe();sub=null}
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await api('/api/push/subscribe',{method:'POST',body:sub});
    await loadPushDeviceStatus(false);
    if(!quiet)notify('✅ Push enabled on this phone');
    if(page==='notifications')render();
    return true
  }catch(e){await loadPushDeviceStatus(false);if(!quiet)notify(e.message);return false}
}
async function enablePush(){return ensurePushSubscription(true,false)}
async function testThisPhonePush(){
  try{
    const ok=await ensurePushSubscription(false,true);
    if(!ok)return notify('Enable push on this phone first');
    const r=await api('/api/push/test-device',{method:'POST'});
    notify('Push test sent to '+num(r.sent)+' subscription'+(num(r.sent)===1?'':'s'))
  }catch(e){notify(e.message)}
}
async function uploadScan(file){const fd=new FormData();fd.append('document',file);try{const job=await api('/api/documents/scan',{method:'POST',body:fd});notify(`OCR started: ${job.id}. Results will require review.`)}catch(e){notify(e.message)}}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action="expense"],[data-action="tripIssue"],.open-invoice,.pay-invoice');if(!b)return;if(b.classList.contains('open-invoice'))return openInvoice(b.dataset.id);if(b.classList.contains('pay-invoice')){const i=get('invoices',b.dataset.id);return openForm('payment',{invoiceId:i.id,amount:invoiceBalance(i)})}const t=get('trips',b.dataset.trip);openForm(b.dataset.action,{tripId:t.id,truckId:t.truckId,driverId:t.driverId})});
function wire(){if($('globalLogoutBtn'))$('globalLogoutBtn').onclick=logout;if(page==='documents')wireDocuments();if(page==='roadCharges')wireRoadCharges();if(page==='payroll')wirePayroll();if($('refreshLiveData'))$('refreshLiveData').onclick=()=>refreshCentralState(true);if($('driverLogoutTop'))$('driverLogoutTop').onclick=logout;if($('driverLogoutBottom'))$('driverLogoutBottom').onclick=logout;document.querySelectorAll('.route-zones').forEach(b=>b.onclick=()=>openRouteZones(b.dataset.id));if($('driverPreviewSelect'))$('driverPreviewSelect').onchange=e=>{driverPreviewId=e.target.value;render()};if(page==='driverAccounts'&&role==='admin')wireDriverAccounts();if(page==='driverUploads')wireDriverUploads();document.querySelectorAll('.driver-next').forEach(b=>b.onclick=()=>{const t=get('trips',b.dataset.trip);if(t.id)driverMainStep(t)});document.querySelectorAll('[data-driver-quick]').forEach(b=>b.onclick=()=>{const t=get('trips',b.dataset.trip);if(!t.id)return;if(b.dataset.driverQuick==='scan')driverCapture('receipt',file=>openDriverSmartSlip(t,file));else if(b.dataset.driverQuick==='diesel')driverCapture('diesel',file=>openDriverDiesel(t,file));else if(b.dataset.driverQuick==='expense')driverCapture('expense',file=>openDriverExpense(t,file));else if(b.dataset.driverQuick==='problem')openDriverProblem(t)});if($('driverHelpBtn'))$('driverHelpBtn').onclick=openDriverHelp;if(role==='driver'&&page==='driverPortal'){startDriverGpsWatch();setTimeout(flushDriverJobs,800)}document.querySelectorAll('.nav-to').forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll('.action').forEach(b=>b.onclick=()=>{const a=b.dataset.action,id=b.dataset.trip,t=get('trips',id);if(a==='newTrip')openForm('trip');else if(a==='inspection')openForm('inspection',{tripId:id,truckId:t.truckId,driverId:t.driverId});else if(a==='diesel')openForm('diesel',{tripId:id,truckId:t.truckId,driverId:t.driverId});else if(a==='incident')openForm('incident',{tripId:id});else if(a==='pod'){t.pod=true;db.tasks.filter(x=>x.linkedId===id&&/POD/.test(x.title)).forEach(x=>x.status='Completed');commit(`POD linked to ${t.number}`,'trip',id)}else if(a==='checkIn')gpsCheckIn();else if(a==='scan')$('scanInput').click()});document.querySelectorAll('.add-record').forEach(b=>b.onclick=()=>openForm(b.dataset.type));document.querySelectorAll('.advance-trip').forEach(b=>b.onclick=()=>advanceTrip(b.dataset.id));document.querySelectorAll('.open-trip').forEach(b=>b.onclick=()=>openTrip(b.dataset.id));document.querySelectorAll('.complete-task').forEach(b=>b.onclick=()=>{get('tasks',b.dataset.id).status='Completed';commit('Task completed','task',b.dataset.id)});document.querySelectorAll('.approval-action').forEach(b=>b.onclick=()=>{get('approvals',b.dataset.id).status=b.dataset.status;commit(`Request ${b.dataset.status.toLowerCase()}`,'approval',b.dataset.id)});document.querySelectorAll('.export').forEach(b=>b.onclick=()=>exportCsv(b.dataset.kind));const s=$('tripSearch');if(s)s.oninput=()=>{$('tripResults').innerHTML=tripTable(db.trips.filter(t=>{const legText=tripLegs(t).map(l=>[route(l.routeId),client(l.clientId),l.load,l.label].join(' ')).join(' ');return[t.number,legText,truck(t.truckId),driver(t.driverId)].join(' ').toLowerCase().includes(s.value.toLowerCase())}))};if(page==='tracking'){setTimeout(drawMap);if($('refreshTracking'))$('refreshTracking').onclick=loadTracking;if($('addGeofence'))$('addGeofence').onclick=addGeofence;document.querySelectorAll('.delete-geofence').forEach(b=>b.onclick=()=>deleteGeofence(b.dataset.id,b.dataset.name||'geofence'))}if(page==='notifications'){loadPushDeviceStatus(false);if($('refreshNotifications'))$('refreshNotifications').onclick=async()=>{await Promise.all([loadNotifications(),loadPushDeviceStatus(false)]);render()};if($('enablePush'))$('enablePush').onclick=enablePush;if($('testPhonePush'))$('testPhonePush').onclick=testThisPhonePush;if($('testAlerts'))$('testAlerts').onclick=async()=>{try{await api('/api/notifications/test',{method:'POST'});await loadNotifications()}catch(e){notify(e.message)}};document.querySelectorAll('.read-notification').forEach(b=>b.onclick=async()=>{await api(`/api/notifications/${b.dataset.id}/read`,{method:'PATCH'});await loadNotifications()})}if(page==='rates')wireRates();const ss=$('saveSettings');if(ss)ss.onclick=()=>{db.settings.dieselPrice=num($('setDiesel').value);db.settings.vat=num($('setVat').value);db.settings.targetKml=num($('setKml').value);db.settings.standingFee=num($('setStanding').value);db.settings.mdcRatePer100km=num($('setMdcRate').value)||73.30;commit('Operating defaults updated')};const sd=$('saveDriver');if(sd)sd.onclick=()=>{db.settings.currentDriver=$('setDriver').value;commit('Driver identity updated')};if($('downloadBackup'))$('downloadBackup').onclick=backup;if($('restoreBackup'))$('restoreBackup').onclick=()=>{$('fileInput').dataset.kind='restore';$('fileInput').click()};if($('resetData'))$('resetData').onclick=()=>{if(confirm('Reset all demonstration data?')){db=structuredClone(base);commit('Demonstration data reset')}}}
function connectEvents(){const events=new EventSource(`/api/events?token=${encodeURIComponent(authToken)}`);events.addEventListener('gps',e=>{const p=JSON.parse(e.data),i=liveGps.findIndex(x=>x.vehicleId===p.vehicleId);if(i<0)liveGps.push(p);else liveGps[i]=p;if(page==='tracking')render()});events.addEventListener('notification',e=>{serverNotifications.unshift(JSON.parse(e.data));$('notificationCount').textContent=serverNotifications.filter(x=>!x.read).length;if(page==='notifications')render()});events.addEventListener('driver-upload',e=>{const u=JSON.parse(e.data);driverUploads.unshift(u);driverUploadsLoaded=true;if(page==='driverUploads')render()});events.addEventListener('state',async()=>{try{const state=await api('/api/state');if(state.payload&&Object.keys(state.payload).length){db=merge(state.payload);localStorage.setItem(STORE,JSON.stringify(db));render()}}catch{}});events.onerror=()=>{} }
async function boot(){try{const [{user},state,config]=await Promise.all([api('/api/session'),api('/api/state'),api('/api/config')]);sessionUser=user;role=user.role;providerConfig=config;if(state.payload&&Object.keys(state.payload).length)db=merge(state.payload);else if(['admin','manager','dispatcher','workshop','finance'].includes(role))await api('/api/state',{method:'PUT',body:db});if(user.driverId)db.settings.currentDriver=user.driverId;localStorage.setItem(STORE,JSON.stringify(db));$('loginScreen').classList.add('hidden');page=role==='driver'?'driverPortal':'command';await Promise.all([loadTracking(),loadNotifications()]);if(typeof Notification!=='undefined'&&Notification.permission==='granted')await ensurePushSubscription(false,true);else await loadPushDeviceStatus(false);connectEvents();render();if(role==='driver')startDriverGpsWatch();else stopDriverGpsWatch()}catch(e){logout();$('loginError').textContent=e.message}}
$('globalLogoutBtn').onclick=logout;$('menuBtn').onclick=()=>$('sidebar').classList.toggle('open');$('closeModal').onclick=()=>$('modal').classList.add('hidden');$('entryForm').onsubmit=saveForm;$('quickTripBtn').onclick=()=>openForm('trip');$('backupBtn').onclick=backup;$('notificationBtn').onclick=()=>go('notifications');$('roleSelect').onchange=()=>{$('roleSelect').value=role};$('fileInput').onchange=()=>{if($('fileInput').files[0]&&$('fileInput').dataset.kind==='restore')restore($('fileInput').files[0]);$('fileInput').value=''};$('scanInput').onchange=()=>{const f=$('scanInput').files[0];if(f)uploadScan(f);$('scanInput').value=''};$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginError').textContent='';try{const result=await api('/api/auth/login',{method:'POST',body:{email:$('loginEmail').value,password:$('loginPassword').value}});authToken=result.token;localStorage.setItem('angermund_token',authToken);$('loginPassword').value='';await boot()}catch(err){$('loginError').textContent=err.message}};window.onclick=e=>{if(e.target===$('modal'))$('modal').classList.add('hidden')};window.addEventListener('online',flushDriverJobs);if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});localStorage.setItem(STORE,JSON.stringify(db));const forceLogin=location.pathname.replace(/\/+$/,'')==='/login'||new URLSearchParams(location.search).get('login')==='1';if(forceLogin){stopDriverGpsWatch();authToken='';sessionUser=null;localStorage.removeItem('angermund_token');if($('loginEmail'))$('loginEmail').value='';if($('loginPassword'))$('loginPassword').value='';if($('loginError'))$('loginError').textContent='';history.replaceState(null,'','/');$('loginScreen').classList.remove('hidden')}if(authToken)boot();else $('loginScreen').classList.remove('hidden');
