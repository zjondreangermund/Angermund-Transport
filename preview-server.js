'use strict';
// A standalone visual preview. Never loads server.js, database drivers or production secrets.
const http=require('http'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'public'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const snippet=source.slice(source.indexOf('const base='),source.indexOf('\nfunction merge(')).replace('const base=','globalThis.sample=');
const context={today:()=>new Date().toISOString().slice(0,10)};vm.createContext(context);vm.runInContext(snippet,context);const sample=JSON.parse(JSON.stringify(context.sample)),date=context.today();
sample.company={...sample.company,email:'preview@example.invalid',phone:'Sample contact',registration:'Demonstration',vat:'Sample only',address:'Windhoek, Namibia'};
for(const k of ['trips','diesel','expenses','invoices','payments','payroll','loans','advances','inspections','incidents','maintenance','tyres','tasks','approvals','audit','permits','monthlyPnlSnapshots','importHistory'])sample[k]=[];
sample.drivers=Array.from({length:4},(_,i)=>({id:'demo_driver_'+i,name:['Driver A','Driver B','Driver C','Driver D'][i],phone:'',role:'Driver',license:'CE',status:i<2?'On trip':'Available',prdpExpiry:'2027-05-31',passportExpiry:'2028-01-01'}));sample.employees=[];sample.archivedTrucks=[];
sample.trucks.forEach((t,i)=>{t.registration='N '+String(i+1).padStart(6,'0')+' W';t.odometer=320000+i*17500;t.serviceDue=t.odometer+5500;t.licenseExpiry='2027-03-31';t.make='Sample fleet vehicle';t.status=i<2?'On trip':'Available'});
sample.trailers=[{id:'demo_trailer_1',name:'Flat deck',registration:'N 000021 W',type:'Flat deck',status:'Available',licenseExpiry:'2027-06-30'},{id:'demo_trailer_2',name:'Tautliner',registration:'N 000022 W',type:'Tautliner',status:'Assigned',licenseExpiry:'2027-05-31'}];
const specs=[['trk_ang2','rte_oshakati','In transit',3,0,32500],['trk_ang4','rte_shunter','Delivered',4,1,4700],['trk_ang5','rte_shunter','Planned',1,2,4700],['trk_ang3','rte_walvis','Loading',2,3,16800]];
for(let i=0;i<specs.length;i++){const [truckId,routeId,status,stage,driver,income]=specs[i],id='preview_trip_'+i;sample.trips.push({id,number:'AT-'+String(2041+i),date,truckId,routeId,driverId:sample.drivers[driver].id,clientId:'cli_nbl',trailerId:'demo_trailer_1',load:i===0?'Beer delivery':i===1||i===2?'Local yard movements':'General cargo',income,distance:i===0?710:i===3?395:35,namibiaKm:i===0?710:i===3?395:35,status,stage,pod:i===1,podDocumentId:i===1?'demo_pod':'',approved:true,dieselCost:i===0?7400:0,tolls:0,allowance:0,other:0,startKm:320000,endKm:0});}
sample.diesel=[{id:'preview_fuel_1',tripId:'preview_trip_0',truckId:'trk_ang2',driverId:'demo_driver_0',date,litres:280,price:26.5,total:7420,printedTotal:7420,supplier:'Sample filling station',odometer:320500,verified:true,receiptUploadId:'demo_fuel',scope:'trip',slip:'Sample slip'},{id:'preview_fuel_2',truckId:'trk_ang4',driverId:'demo_driver_1',date,litres:120,price:26.5,total:3180,printedTotal:3180,supplier:'Sample local fill',odometer:355000,verified:true,scope:'company'}];
sample.expenses=[{id:'preview_expense_1',tripId:'preview_trip_0',truckId:'trk_ang2',date,category:'Toll',supplier:'Sample supplier',amount:450,status:'Approved',notes:'Demonstration only'}];
sample.invoices=[{id:'preview_invoice_1',number:'INV-DEMO-01',date,clientId:'cli_nbl',tripId:'preview_trip_1',amount:4700,due:date,status:'Unpaid'}];
sample.tasks=[{id:'demo_task',title:'Check delivery POD',ownerRole:'Dispatcher',linkedType:'trip',linkedId:'preview_trip_0',due:date,priority:'Normal',status:'Open'}];
sample.permits=sample.trucks.map(t=>({id:'permit_'+t.id,ownerType:'truck',ownerId:t.id,type:'Vehicle licence',reference:t.registration,expiry:t.licenseExpiry,status:'Active'}));sample.settings.currentDriver='demo_driver_0';sample.trips[0].returnJourney={startedAt:new Date().toISOString(),destination:'Angermund depot',source:'sample'};sample.trips[0].status='Returning';sample.trips[0].legs=[{id:'demo_leg',sequence:1,routeId:sample.trips[0].routeId,load:sample.trips[0].load,status:'Delivered',pod:true,distance:1420,income:32500}];sample.trips[1].depotArrival={at:new Date().toISOString(),source:'office-confirmed',depotName:'Angermund depot'};sample.trips[1].driverComplete=true;
const user={id:'preview-user',name:'Design Preview',email:'preview@example.invalid',role:'admin'};
const mime={'.css':'text/css','.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://preview.local');const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 if(url.pathname==='/health')return send(200,{preview:true,mode:'sample-data-only'});
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET')return send(403,{error:'Design preview only. Changes are not saved; the live site is separate.'});
  if(url.pathname==='/api/session')return send(200,{user});
  if(url.pathname==='/api/state')return send(200,{payload:sample,revision:1});
  if(url.pathname==='/api/config')return send(200,{providers:{},receiptAI:{enabled:false},preview:true});
  if(url.pathname==='/api/admin/whiteboard')return send(200,{status:'not-applicable'});
  if(url.pathname==='/api/push/status')return send(200,{subscribed:false,subscriptionCount:0});
  if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.write(': preview only\n\n');const timer=setInterval(()=>res.write(': keep-alive\n\n'),20000);req.on('close',()=>clearInterval(timer));return}
  return send(200,[]);
 }
 if(url.pathname==='/sw.js'){res.writeHead(404);return res.end()}
 let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{return send(400,{error:'Invalid path'})}
 const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)&&file!==root)return send(403,{error:'Forbidden'});
 let target=file;if(pathname==='/'||pathname==='/login')target=path.join(root,'index.html');
 if(!fs.existsSync(target)||!fs.statSync(target).isFile())return send(404,{error:'Not available in design preview'});
 if(target.endsWith('index.html')){let html=fs.readFileSync(target,'utf8');html=html.replace('</head>','<link rel="stylesheet" href="/preview-shell.css"><script src="/preview-start.js"></script></head>');res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});return res.end(html.replace('</body>','<script src="/preview-navigation.js"></script></body>'))}
 res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(target).pipe(res);
});if(require.main===module)server.listen(process.env.PORT||3000,()=>console.log('Integrated Ledger preview running — sample data only; no database connection'));
module.exports={server,sample};
