'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{spawn}=require('node:child_process'),jwt=require('jsonwebtoken');
test('HTTP driver isolation, simple start and task authorization',async t=>{
 const port=22000+Math.floor(Math.random()*8000),secret='driver-test-secret',base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWT_SECRET:secret,DATABASE_URL:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());let logs='';child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);
 const call=async(path,role='driver',body,method=body?'POST':'GET')=>{const token=jwt.sign({sub:role==='admin'?'admin-test':'user-one',role,driverId:role==='driver'?'d1':null},secret);const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}};
 let ready=false;for(let i=0;i<80;i++){try{await call('/api/session');ready=true;break}catch{await new Promise(r=>setTimeout(r,100))}}a.ok(ready,logs);
 const state={trips:[{id:'t1',driverId:'d1',truckId:'tr1',number:'ANG10-TEST',stage:1,status:'Planned',income:12345},{id:'t2',driverId:'d2',number:'OTHER'}],trucks:[{id:'tr1'}],drivers:[{id:'d1',name:'One'},{id:'d2',name:'Two'}],tasks:[{id:'other',assignedDriverId:'d2',title:'Private'},{id:'role',ownerRole:'Driver',title:'Unassigned'}],settings:{},invoices:[{id:'private'}]};
 a.equal((await call('/api/state','admin',state,'PUT')).status,200);
 const scoped=await call('/api/state');a.equal(scoped.status,200);a.equal(scoped.data.payload.trips.length,1);a.equal(scoped.data.payload.trips[0].income,undefined);a.equal(scoped.data.payload.tasks.length,0);a.deepEqual(scoped.data.payload.invoices,[]);
 for(const path of ['/api/gps/latest','/api/users','/api/assistant/session'])a.equal((await call(path)).status,403,path);
 a.equal((await call('/api/tasks/other/complete','driver',{})).status,403);
 a.equal((await call('/api/tasks/role/complete','driver',{})).status,403);
 // Device authentication uses the persisted user; automatic context starts GPS before Start Trip.
 const created=await call('/api/users','admin',{name:'Driver One',email:'driver-one@test.local',password:'isolated-test-password',role:'driver',driverId:'d1'});a.equal(created.status,201);
 const nativeToken=jwt.sign({sub:created.data.id,role:'driver',driverId:'d1'},secret);
 const registered=await fetch(base+'/api/mobile/register',{method:'POST',headers:{Authorization:'Bearer '+nativeToken,'Content-Type':'application/json'},body:JSON.stringify({deviceId:'test-driver-phone'})});a.equal(registered.status,201);const device=await registered.json(),deviceHeaders={'X-Device-Token':device.deviceToken};
 const mobileContext=await(await fetch(base+'/api/mobile/context',{headers:deviceHeaders})).json();a.equal(mobileContext.trip.id,'t1');a.equal(mobileContext.trip.phoneTracking.active,true);a.equal((await call('/api/state','admin')).data.payload.trips[0].startedAt,undefined);
 await call('/api/notifications/test','admin',{});
 const alerts=await(await fetch(base+'/api/mobile/alerts?after=2020-01-01',{headers:deviceHeaders})).json();a.deepEqual(alerts.alerts,[]);
 const start=await call('/api/driver/trips/t1/action','driver',{action:'start'});a.equal(start.status,201,JSON.stringify(start));a.equal(start.data.status,'In transit');
 a.equal((await call('/api/driver/trips/t2/action','driver',{action:'start'})).status,403);
 const saved=(await call('/api/state','admin')).data.payload;a.equal(saved.inspections.length,0);a.ok(saved.tasks.some(x=>x.assignedDriverId==='d1'&&/Vehicle check/.test(x.title)));
 await call('/api/notifications/test','admin',{});a.equal((await call('/api/notifications')).data.length,0);
});
