'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{spawn}=require('node:child_process'),jwt=require('jsonwebtoken');
test('manual trip persists across stale browser saves and is found through chatbot',async t=>{
 const port=31000+Math.floor(Math.random()*8000),secret='manual-trip-integration-test',base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),JWT_SECRET:secret,DATABASE_URL:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());let logs='';child.stderr.on('data',d=>logs+=d);child.stdout.on('data',d=>logs+=d);
 const headers={Authorization:'Bearer '+jwt.sign({sub:'test-admin',role:'admin',name:'Test Admin'},secret),'Content-Type':'application/json'};
 const call=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{headers,method,body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()}};
 let ready=false;for(let i=0;i<100;i++){try{await call('/api/session');ready=true;break}catch{await new Promise(r=>setTimeout(r,100))}}a.ok(ready,logs);
 const initial=(await call('/api/state')).data.payload,seed={...initial,trips:[],trucks:[{id:'test-truck',fleetName:'ANG 10'}],drivers:[{id:'test-driver',name:'Anton Test'}],clients:[{id:'test-client',name:'Test Customer'}],routes:[],tasks:[],settings:{}};
 a.equal((await call('/api/state',seed,'PUT')).status,200);
 const body={date:'2026-10-21',truckId:'test-truck',driverId:'test-driver',clientId:'test-client',routeId:'__manual__',manualRouteName:'Windhoek to Tsandi',load:'Charcoal',income:12000,status:'Planned'};
 a.equal((await call('/api/admin/trips',{...body,date:'2026-09-01'})).status,400);
 const created=await call('/api/admin/trips',body);a.equal(created.status,201,JSON.stringify(created));a.ok(created.data.trip.id);a.equal(created.data.trip.source,'manual');
 a.equal((await call('/api/state',seed,'PUT')).status,200);
 const saved=(await call('/api/state')).data.payload;a.ok(saved.trips.some(x=>x.id===created.data.trip.id));a.ok(saved.routes.some(x=>x.id===created.data.trip.routeId));
 for(const message of ['Find trip ANG10 21 Oct 2026','Where is my manual trip to Tsandi?']){const result=await call('/api/assistant/ask',{message});a.equal(result.status,200);a.match(result.data.answer,/Charcoal/);a.ok(result.data.records.some(r=>r.id===created.data.trip.id),JSON.stringify(result));}
});
