const test=require('node:test'),path=require('node:path');
test('truck/month selection renders all operational pages and preserves linked contribution',()=>{
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const el=()=>({value:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(){},appendChild(){},prepend(node){this.prepended=node},querySelectorAll(){return[]},querySelector(){return null},getBoundingClientRect(){return{left:0,width:300,top:600}},setAttribute(){},removeAttribute(){},focus(){}});
const els=new Map(),doc={getElementById(id){if(!els.has(id))els.set(id,el());return els.get(id)},querySelectorAll(){return[]},querySelector(){return null},addEventListener(){},createElement:el,body:el(),documentElement:el(),readyState:'complete'};
const storage={getItem(){return null},setItem(){},removeItem(){}};
const context={document:doc,localStorage:storage,sessionStorage:storage,console,structuredClone,URLSearchParams,URL,Intl,crypto:require('node:crypto').webcrypto,navigator:{userAgent:'Test'},location:{pathname:'/',search:'',origin:'http://localhost'},history:{replaceState(){}},setTimeout(){},setInterval(){},clearTimeout(){},window:{addEventListener(){},matchMedia(){return{matches:true}},innerHeight:800},MutationObserver:class{observe(){}},requestAnimationFrame(){},fetch:async()=>{throw Error('No network in fixture')}};
vm.createContext(context);
for(const p of ['trip-metrics.js','fleet-photos.js','trip-lifecycle.js','dispatch-ledger.js','payroll-eligibility.js','invoice-charges.js','record-filters.js','page-filters.js','record-manager.js','mobile-documents.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',p),'utf8'),context,{filename:p});
vm.runInContext(`
 db=merge({trips:[{id:'a',number:'REAL-ANG12-SEP',date:'2026-09-30',truckId:'t12',income:1000,status:'Closed',stage:6,pod:true},{id:'b',number:'OTHER-OCT',date:'2026-10-01',truckId:'t12',income:2000,status:'Planned',stage:1},{id:'c',number:'OTHER-TRUCK',date:'2026-09-30',truckId:'t4',income:3000}],trucks:[{id:'t12',fleetName:'Ang 12',registration:'REG12'},{id:'t4',fleetName:'Ang 4',registration:'REG4'}],diesel:[{id:'f',date:'2026-09-30',tripId:'a',litres:100,total:300,truckId:'t12'}],expenses:[{id:'e',date:'2026-09-30',tripId:'a',category:'Toll',amount:100}],invoices:[],payments:[],shunterRecons:[],maintenance:[],inspections:[],incidents:[]});
 opsSelection={truckId:'t12',year:'2026',month:'09'};role='admin';tripCompletionFilter='all';
 globalThis.tripIds=selectedTripRows().map(t=>t.id);
 globalThis.results={};for(const view of ['command','dispatch','trips','carrierOrders','diesel','inspections','workshop','incidents','invoices','roadCharges','reports','monthlyPnl','fleet']){page=view;results[view]=views[view]();}
 globalThis.summary=opsOverview();globalThis.panel=opsFilterPanel();
`,context);
assert.deepEqual(Array.from(context.tripIds),['a']);assert.ok(context.summary.includes('REAL-ANG12-SEP'));assert.ok(!context.summary.includes('OTHER-OCT'));assert.ok(!context.summary.includes('OTHER-TRUCK'));assert.ok(context.summary.includes('600.00'));assert.ok(context.panel.includes('opsTruck'));for(const [name,html] of Object.entries(context.results))assert.equal(typeof html,'string',name);console.log('All 13 filtered views rendered successfully; linked costs and September selection verified.');

vm.runInContext(`opsSelection=RecordFilters.normalize({truckId:'t12',from:'2026-09-20',to:'2026-10-23'});page='invoices';globalThis.rangeInvoice=invoices();globalThis.rangePanel=opsFilterPanel();globalThis.rangeTrips=selectedTripRows().map(t=>t.id);`,context);
assert.deepEqual(Array.from(context.rangeTrips),['b','a']);
assert.ok(context.rangePanel.includes('Apply exact dates'));
assert.ok(context.rangeInvoice.includes('id="nblPeriodStart" type="date" value="2026-09-20"'));
assert.ok(context.rangeInvoice.includes('id="nblPeriodEnd" type="date" value="2026-10-23"'));

vm.runInContext(`
 db.invoices=[{id:'taxed',clientId:'cli_rf',tripId:'a',amount:1000,number:'INV-TAX',date:'2026-09-30'}];InvoiceCharges.calculate(db,db.invoices[0],{newInvoice:true,includeMdc:false});
 globalThis.printed='';window.open=()=>({document:{write(html){globalThis.printed=html},close(){}},focus(){}});printInvoice('taxed');globalThis.printed=$('documentPreviewFrame').srcdoc||globalThis.printed;openInvoiceEdit('taxed');globalThis.editHtml=$('entryForm').innerHTML;
`,context);
assert.ok(context.printed.includes('VAT 15%'));assert.ok(context.printed.includes('Transport excl. VAT'));assert.ok(context.editHtml.includes('editInvoiceVatRate'));
vm.runInContext(`openForm('invoice');globalThis.manualControls=$('entryForm').prepended.innerHTML;`,context);
assert.ok(context.manualControls.includes('newInvoiceVatRate'));

vm.runInContext(`page='invoices';globalThis.managementHtml=recordManagementPanel();globalThis.invoiceActions=invoices();openInvoice('taxed');globalThis.invoiceModalHtml=$('entryForm').innerHTML;`,context);
assert.ok(context.managementHtml.includes('Manage records'));
assert.ok(context.managementHtml.includes('data-manage-delete="invoices"'));
assert.ok(context.invoiceActions.includes('data-manage-edit="invoices"'));
assert.ok(context.invoiceModalHtml.includes('Delete invoice'));

vm.runInContext(`page='command';render();globalThis.headerSearch=$('globalSearchHost').innerHTML;globalThis.pageHtml=$('app').innerHTML;`,context);
assert.ok(context.headerSearch.includes('globalDataSearch'));
assert.equal(context.pageHtml.includes('id="globalDataSearch"'),false);

vm.runInContext(`$('globalSearchHost').parentElement={getBoundingClientRect:()=>({height:228})};document.documentElement.style.setProperty=(key,value)=>{globalThis.headerOffset={key,value}};syncHeaderSearchLayout();`,context);
assert.equal(context.headerOffset.key,'--app-header-height');
assert.equal(context.headerOffset.value,'228px');

// Wheel scrolling must use the native nav scroll area rather than be cancelled.
assert.equal(els.get('sidebar').onwheel,null);
const css=fs.readFileSync(path.join(__dirname,'../public/styles.css'),'utf8');
assert.ok(css.includes('flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important'));
assert.ok(css.includes('#sidebar .nav-more-items{position:static!important'));

vm.runInContext(`openTrip('a');globalThis.tripDeleteHtml=$('entryForm').innerHTML;globalThis.tripListDelete=tripTable(db.trips);role='driver';globalThis.driverDelete=tripDeleteButton(db.trips[0]);role='admin';`,context);
assert.ok(context.tripDeleteHtml.includes('data-manage-delete="trips"'));
assert.ok(context.tripListDelete.includes('Delete trip'));
assert.equal(context.driverDelete,'');

});
