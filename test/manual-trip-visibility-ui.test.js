const test=require('node:test');
test('newly saved trips are revealed across prior filters',()=>{
const path=require('node:path');
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const el=()=>({value:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},appendChild(){},prepend(node){this.prepended=node},querySelectorAll(){return[]},querySelector(){return null},getBoundingClientRect(){return{left:0,width:300,top:600}},setAttribute(){},removeAttribute(){},focus(){}});
const els=new Map(),doc={getElementById(id){if(!els.has(id))els.set(id,el());return els.get(id)},querySelectorAll(){return[]},querySelector(){return null},addEventListener(){},createElement:el,body:el(),documentElement:el(),readyState:'complete'};
const storage={getItem(){return null},setItem(){},removeItem(){}};
const context={document:doc,localStorage:storage,sessionStorage:storage,console,structuredClone,URLSearchParams,URL,Intl,crypto:require('node:crypto').webcrypto,navigator:{userAgent:'Test'},location:{pathname:'/',search:'',origin:'http://localhost'},history:{replaceState(){}},setTimeout(){},setInterval(){},clearTimeout(){},window:{addEventListener(){},matchMedia(){return{matches:true}},innerHeight:800},MutationObserver:class{observe(){}},requestAnimationFrame(){},fetch:async()=>{throw Error('No network in fixture')}};
vm.createContext(context);
for(const p of ['fleet-photos.js','trip-lifecycle.js','dispatch-ledger.js','payroll-eligibility.js','invoice-charges.js','record-filters.js','page-filters.js','record-manager.js','mobile-documents.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',p),'utf8'),context,{filename:p});

vm.runInContext(`role='admin';db=merge({trips:[{id:'manual',number:'AT-1000',date:'2026-10-21',stage:6,status:'Closed',depotArrival:{at:'2026-10-22',source:'office-confirmed'}}]});opsSelection=RecordFilters.normalize({truckId:'other',year:'2025'});tripCompletionFilter='process';tripViewMode='history';tripSearchTerm='other';revealSavedTrips();globalThis.rows=selectedTripRows();globalThis.controls=tripPeriodControls();globalThis.filters=opsSelection;`,context);
assert.equal(context.rows.length,1);assert.equal(context.filters.truckId,'');assert.ok(context.controls.includes('showAllSavedTrips'));console.log('Saved trip reveal clears hidden truck/date/status/history filters.');
});
