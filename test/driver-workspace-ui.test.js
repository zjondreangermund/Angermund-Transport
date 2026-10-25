const test=require('node:test');
test('personal driver views keep two trip controls, slips and personal tasks/alerts',()=>{
const path=require('node:path');
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const el=()=>({value:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},appendChild(){},prepend(node){this.prepended=node},querySelectorAll(){return[]},querySelector(){return null},getBoundingClientRect(){return{left:0,width:300,top:600}},setAttribute(){},removeAttribute(){},focus(){}});
const els=new Map(),doc={getElementById(id){if(!els.has(id))els.set(id,el());return els.get(id)},querySelectorAll(){return[]},querySelector(){return null},addEventListener(){},createElement:el,body:el(),documentElement:el(),readyState:'complete'};
const storage={getItem(){return null},setItem(){},removeItem(){}};
const context={document:doc,localStorage:storage,sessionStorage:storage,console,structuredClone,URLSearchParams,URL,Intl,crypto:require('node:crypto').webcrypto,navigator:{userAgent:'Test'},location:{pathname:'/',search:'',origin:'http://localhost'},history:{replaceState(){}},setTimeout(){},setInterval(){},clearTimeout(){},window:{addEventListener(){},matchMedia(){return{matches:true}},innerHeight:800},MutationObserver:class{observe(){}},requestAnimationFrame(){},fetch:async()=>{throw Error('No network in fixture')}};
vm.createContext(context);
for(const p of ['fleet-photos.js','trip-lifecycle.js','dispatch-ledger.js','payroll-eligibility.js','invoice-charges.js','record-filters.js','page-filters.js','record-manager.js','mobile-documents.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',p),'utf8'),context,{filename:p});

vm.runInContext(`role='driver';sessionUser={sub:'u1',driverId:'d1'};db=merge({driverScoped:true,trips:[{id:'t1',number:'ANG10-TEST',driverId:'d1',truckId:'tr1',routeId:'r1',status:'Planned',stage:1}],trucks:[{id:'tr1',fleetName:'ANG 10'}],drivers:[{id:'d1',name:'Victon Kufinya'}],routes:[{id:'r1',name:'Windhoek → Walvis Bay'}],tasks:[]});globalThis.html=driverPortal();globalThis.taskHtml=tasks();globalThis.alertHtml=notifications();db.trips[0].startedAt='2026-10-25';globalThis.afterStart=driverPortal();`,context);
assert.ok(context.html.includes('START TRIP'));assert.ok(context.afterStart.includes('STOP / RETURN'));assert.ok(context.html.includes('SCAN SLIP'));assert.ok(context.html.includes('POD'));assert.ok(!context.html.includes('Start tracking</button>'));assert.ok(!context.taskHtml.includes('Approvals'));assert.ok(context.taskHtml.includes('My tasks'));assert.ok(!context.alertHtml.includes('Telematics'));console.log('Driver home, tasks, alerts and start/return views rendered successfully.');

});
