const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const {once}=require('node:events');
const path=require('node:path');
const {mergeStateChanges}=require('../public/state-sync');
let child,base,admin,driver,finance,dispatcher,driverId,logs='';
const password='Audit-test-password-123';
async function request(url,{token=admin,method='GET',body,headers={}}={}){
 const r=await fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,body:await r.json().catch(()=>null)};
}
async function login(email){const r=await request('/api/auth/login',{method:'POST',token:null,body:{email,password}});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.token}
const fixture=()=>({version:2,settings:{},company:{name:'Audit'},canonicalFleetVersion:'audit',workforceImportVersion:'audit',driverActions:[],employees:[{id:'secret',name:'Private Worker'}],payProfiles:[{id:'secret-profile',bankAccount:'private'}],payroll:[{id:'secret-pay',amount:500}],trucks:[{id:'truck1',status:'Available'}],drivers:[{id:'driver1',name:'Test Driver'}],clients:[{id:'client1',name:'Client',terms:30}],routes:[{id:'route1',distance:100,namibiaKm:100}],trailers:[],trips:[{id:'trip1',number:'AT-1001',date:'2026-09-01',driverId:'driver1',truckId:'truck1',clientId:'client1',routeId:'route1',income:1000,dieselCost:300,stage:1,status:'Planned',legs:[{id:'leg1',sequence:1,routeId:'route1',clientId:'client1',distance:100,pricingMethod:'Manual negotiated',agreedAmount:1000,income:1000,status:'Planned'}]}],diesel:[{id:'fuel1',tripId:'trip1',legId:'leg1',litres:10,price:30,total:300}],expenses:[],tasks:[],audit:[],invoices:[]});
async function save(state,token=admin){const current=await request('/api/state',{token});return request('/api/state',{method:'PUT',token,body:state,headers:{'If-Match':String(current.body.revision)}})}
before(async()=>{
 const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));base='http://127.0.0.1:'+port;
 child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{PATH:process.env.PATH,PORT:String(port),JWT_SECRET:'audit-only-local-secret',INITIAL_ADMIN_EMAIL:'admin@audit.test',INITIAL_ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 for(let i=0;i<100;i++){if(logs.includes('running on port'))break;if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,50))}
 assert.match(logs,/running on port/);admin=await login('admin@audit.test');
 assert.equal((await save(fixture())).status,200);
 for(const role of ['driver','finance','dispatcher']){
  const r=await request('/api/users',{method:'POST',body:{name:role,email:role+'@audit.test',password,role,...(role==='driver'?{driverId:'driver1'}:{})}});assert.equal(r.status,201,JSON.stringify(r.body));if(role==='driver')driverId=r.body.id;
 }
 driver=await login('driver@audit.test');finance=await login('finance@audit.test');dispatcher=await login('dispatcher@audit.test');
});
after(async()=>{if(child&&child.exitCode===null){child.kill();await once(child,'exit')}});
beforeEach(async()=>assert.equal((await save(fixture())).status,200));
test('unconfigured telematics forwarding fails closed',async()=>assert.equal((await request('/api/integrations/telematics/webhook',{method:'POST',token:null,body:{}})).status,401));
test('stale concurrent writes cannot erase another save',async()=>{
 const snapshot=(await request('/api/state')).body;
 const write=name=>request('/api/state',{method:'PUT',body:{...snapshot.payload,company:{name}},headers:{'If-Match':String(snapshot.revision)}});
 const results=await Promise.all([write('first'),write('second')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(Number((await request('/api/state')).body.revision),Number(snapshot.revision)+1);
});
test('state writes require object and a revision',async()=>{
 assert.equal((await request('/api/state',{method:'PUT',body:[]})).status,400);
 assert.equal((await request('/api/state',{method:'PUT',body:fixture()})).status,428);
});
test('disjoint state edits preserve new records and server metadata',()=>{
 const b=fixture(),l=structuredClone(b),r=structuredClone(b);l.trips[0].load='cargo';r.trips[0].status='Loading';r.tasks.push({id:'task2',title:'new'});r.driverActions.push({id:'action',key:'accepted'});
 const merged=mergeStateChanges(b,l,r);assert.equal(merged.trips[0].load,'cargo');assert.equal(merged.trips[0].status,'Loading');assert.equal(merged.tasks.length,1);assert.equal(merged.driverActions.length,1);assert.equal(merged.workforceImportVersion,'audit');
});
test('same-field and delete/edit conflicts are surfaced',()=>{
 const b=fixture(),l=structuredClone(b),r=structuredClone(b);l.trips[0].status='Loading';r.trips[0].status='Delivered';assert.throws(()=>mergeStateChanges(b,l,r),/Conflicting/);l.trips=[];assert.throws(()=>mergeStateChanges(b,l,r),/Conflicting/);
});
test('deleting the last fuel receipt clears trip cost',async()=>{
 assert.equal((await request('/api/admin/diesel/fuel1',{method:'DELETE'})).status,200);const t=(await request('/api/state')).body.payload.trips[0];assert.equal(t.dieselCost,0);assert.equal(t.actualProfit,1000);
});
test('single leg invoice links to trip and repeated creation is idempotent',async()=>{
 const first=await request('/api/admin/trips/trip1/legs/leg1/invoice',{method:'POST'}),second=await request('/api/admin/trips/trip1/legs/leg1/invoice',{method:'POST'});
 assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(second.status,200);assert.equal(first.body.invoice.id,second.body.invoice.id);assert.equal(first.body.trip.invoiceId,first.body.invoice.id);
 assert.equal((await request('/api/admin/trips/trip1/legs/leg1',{method:'PATCH',body:{agreedAmount:12}})).status,409);
});
test('leg deletion preserves linked receipts',async()=>{
 const state=fixture();state.trips[0].legs.push({...state.trips[0].legs[0],id:'leg2',sequence:2});await save(state);
 assert.equal((await request('/api/admin/trips/trip1/legs/leg1',{method:'DELETE'})).status,409);
});
test('invalid references and months are rejected without partial writes',async()=>{
 const initial=(await request('/api/state')).body;
 assert.equal((await request('/api/admin/trips',{method:'POST',body:{date:'2026-09-01',routeId:'route1',clientId:'missing',truckId:'truck1',driverId:'driver1'}})).status,400);
 assert.equal((await request('/api/payroll/generate',{method:'POST',body:{period:'2026-13'}})).status,400);
 const final=(await request('/api/state')).body;assert.equal(final.revision,initial.revision);assert.deepEqual(final.payload,initial.payload);
});
test('driver state excludes payroll and other drivers trips',async()=>{
 const state=fixture();state.trips.push({...state.trips[0],id:'private-trip',driverId:'other'});await save(state);
 const visible=(await request('/api/state',{token:driver})).body.payload;
 assert.equal(visible.payProfiles,undefined);assert.equal(visible.employees,undefined);assert.equal(visible.trips.length,1);
});
test('dispatcher saves preserve hidden payroll records',async()=>{
 const visible=(await request('/api/state',{token:dispatcher})).body.payload;assert.deepEqual(visible.payroll,[]);visible.company.name='updated';assert.equal((await save(visible,dispatcher)).status,200);
 const result=(await request('/api/state')).body.payload;assert.equal(result.company.name,'updated');assert.equal(result.payroll[0].id,'secret-pay');
});
test('phone GPS cannot replace tracker history or move trip stage',async()=>{
 const r=await request('/api/gps',{method:'POST',token:driver,body:{vehicleId:'truck1',tripId:'trip1',latitude:-22,longitude:17,speed:50}});assert.equal(r.status,201,JSON.stringify(r.body));
 assert.deepEqual((await request('/api/gps/latest')).body,[]);assert.deepEqual((await request('/api/gps/history/truck1')).body,[]);assert.equal((await request('/api/state')).body.payload.trips[0].stage,1);
});
test('GPS validates coordinates and assignment',async()=>{
 for(const latitude of [null,'',91])assert.equal((await request('/api/gps',{method:'POST',token:driver,body:{vehicleId:'truck1',tripId:'trip1',latitude,longitude:17}})).status,400);
 assert.equal((await request('/api/gps',{method:'POST',token:driver,body:{vehicleId:'truck1',tripId:'other',latitude:-22,longitude:17}})).status,403);
});
test('targeted notifications stay private in realtime and read endpoints',async()=>{
 const controller=new AbortController(),stream=await fetch(base+'/api/events',{headers:{Authorization:'Bearer '+driver},signal:controller.signal});const reader=stream.body.getReader();await reader.read();
 try{
  assert.equal((await request('/api/tasks',{method:'POST',body:{title:'Finance confidential task',ownerRole:'Finance'}})).status,201);
  const n=(await request('/api/notifications',{token:finance})).body.find(n=>n.title.includes('Finance confidential'));assert.ok(n);assert.equal((await request('/api/notifications/'+n.id+'/read',{method:'PATCH',token:driver})).status,404);
  await request('/api/notifications/test',{method:'POST'});let text='';
  while(!text.includes('Angermund Transport test alert')){const chunk=await reader.read();if(chunk.done)break;text+=new TextDecoder().decode(chunk.value)}
  assert.ok(!text.includes('Finance confidential'));assert.ok(text.includes('Angermund Transport test alert'));
 }finally{controller.abort()}
});
test('reading a shared alert does not clear it for another user',async()=>{
 const n=(await request('/api/notifications/test',{method:'POST'})).body;
 await request('/api/notifications/'+n.id+'/read',{method:'PATCH',token:driver});
 assert.equal((await request('/api/notifications',{token:driver})).body.find(x=>x.id===n.id).read,true);
 assert.equal((await request('/api/notifications',{token:finance})).body.find(x=>x.id===n.id).read,false);
});
test('account updates and password reset revoke authorization immediately',async()=>{
 await request('/api/users/'+driverId,{method:'PATCH',body:{active:false}});assert.equal((await request('/api/session',{token:driver})).status,401);
 await request('/api/users/'+driverId,{method:'PATCH',body:{active:true}});driver=await login('driver@audit.test');
 const device=(await request('/api/mobile/register',{method:'POST',token:driver,body:{deviceId:'audit-device'}})).body;
 assert.equal((await request('/api/users/'+driverId+'/reset-password',{method:'POST',body:{password}})).status,200);assert.equal((await request('/api/session',{token:driver})).status,401);
 assert.equal((await request('/api/mobile/context',{token:null,headers:{'x-device-token':device.deviceToken}})).status,401);
 driver=await login('driver@audit.test');assert.equal((await request('/api/session',{token:driver})).body.user.id,driverId);
});
