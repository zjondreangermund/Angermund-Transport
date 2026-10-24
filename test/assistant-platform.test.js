'use strict';
const test=require('node:test'),a=require('node:assert/strict'),P=require('../assistant-platform');
const state=()=>({trucks:[{id:'tr',fleetName:'ANG 12',status:'Available'}],drivers:[{id:'dr',name:'Josef'}],routes:[{id:'r',name:'Windhoek to Walvis',distance:400,namibiaKm:400}],clients:[{id:'c',name:'Example'}],trips:[{id:'t',number:'AT-101',date:'2026-10-24',truckId:'tr',driverId:'dr',status:'Delivered',stage:4,legs:[{id:'l',sequence:1,label:'Load 1',pod:true}]}],expenses:[],diesel:[],invoices:[{id:'i',number:'INV-1001',amount:1000,paidAmount:100}],settings:{quoteCostDefaults:{kml:2,dieselNA:27,dieselForeign:26,driverRate:.5,mdcRate:73.3,maintenanceRate:2,tyreRate:1,insuranceRate:1,ownershipRate:2,days:1,foodRate:200,tolls:0,waitingDays:0,standingRate:0,other:0,margin:20,minimum:0,rounding:100,vatRate:15}},quotes:[]});
const helpers={recalc(s,t){t.recalculated=true},editInvoice(s,i,v){Object.assign(i,v)}};
test('purchase request resolves truck, previews without changing state, then saves with receipt in Review',async()=>{
 const s=state(),req=P.parse('I bought parts for truck ANG 12 on 2026-10-24 for N$1200'),before=structuredClone(s),p=P.plan(req,s,'admin',true);
 a.deepEqual(s,before);a.equal(p.values.truckId,'tr');a.equal(p.values.amount,1200);
 const out=await P.apply(s,p,'Admin','admin',helpers,{id:'proof'});a.equal(out.recordType,'expense');a.equal(s.expenses[0].receiptUploadId,'proof');a.equal(s.expenses[0].status,'Review');a.equal(s.expenses[0].companyPaid,true);
});
test('diesel spelling and manual calculations with no fabricated proof',async()=>{
 const s=state(),p=P.plan(P.parse('Record disel 100 litres total N$2700 for truck ANG 12 on 2026-10-24 odometer 123456'),s,'finance');
 await P.apply(s,p,'Finance','finance',helpers);a.equal(s.diesel[0].total,2700);a.equal(s.diesel[0].price,27);a.equal(s.diesel[0].receiptMissing,true);a.equal(s.diesel[0].odometer,123456);
});
test('does not guess date, amount, truck or ambiguous slip',()=>{
 const s=state();a.throws(()=>P.plan(P.parse('I bought parts for truck ANG 12 N$1200'),s,'admin'),/valid date/);
 a.throws(()=>P.plan({operation:'expense',collection:'expenses',values:{date:'2026-10-24',amount:20}},s,'admin'),/Specify a truck/);
 s.trucks.push({id:'other',fleetName:'ANG 12'});a.throws(()=>P.resolve(s,'trucks','ANG 12'),/More than one/);
});
test('permission checks occur in planning and again during approval with current role',async()=>{
 const s=state(),p=P.plan(P.parse('Delete invoice INV-1001'),s,'admin');
 a.throws(()=>P.plan(P.parse('Delete invoice INV-1001'),s,'driver'),/cannot/);
 await a.rejects(P.apply(s,p,'Driver','driver',helpers),/role cannot/);
 a.equal(P.catalog('driver').length,0);a.ok(!P.catalog('dispatcher').some(c=>c.operation==='invoice'));
});
test('stale previews reject changes even when edited record has no updatedAt field',async()=>{
 const s=state(),p=P.plan(P.parse('Edit invoice INV-1001 notes to Check delivery'),s,'finance');s.invoices[0].amount=2000;
 await a.rejects(P.apply(s,p,'Finance','finance',helpers),/changed after preview/);
});
test('paid invoice and linked trip deletion use existing blockers',async()=>{
 const s=state(),p=P.plan(P.parse('Delete invoice INV-1001'),s,'admin');
 await a.rejects(P.apply(s,p,'Admin','admin',helpers),/payments/);
 s.trips[0].invoiceId='i';const tp=P.plan(P.parse('Delete trip AT-101'),s,'admin');await a.rejects(P.apply(s,tp,'Admin','admin',helpers),/linked invoice/);
});
test('approved quotation deletion archives original record and invalidates stale state',async()=>{
 const s=state();s.quotes=[{id:'q',number:'Q-1001'}];const p=P.plan(P.parse('Delete quotation Q-1001'),s,'finance');await P.apply(s,p,'Finance','finance',helpers);
 a.equal(s.quotes.length,0);a.equal(s.recordHistory[0].record.number,'Q-1001');a.ok(s.recordDeletionVersion);
});
test('arbitrary fields and approval/status injection are rejected',()=>{
 const s=state();for(const field of ['__proto__','verified','approved','status','tripId','lines']){
  const values=JSON.parse('{"'+field+'":true}');if(field==='__proto__')continue;
  a.throws(()=>P.plan({operation:'edit',collection:'diesel',target:'missing',values},s,'admin'));
 }
 a.throws(()=>P.plan({operation:'expense',collection:'expenses',values:{truck:'ANG 12',date:'2026-10-24',amount:1,verified:true}},s,'admin'),/Unsupported input/);
});
test('posted slip moves to truck and preserves proof while recalculating old trip',async()=>{
 const s=state();s.expenses=[{id:'e',receiptNo:'PART-77',amount:100,tripId:'t',truckId:'tr',receiptUploadId:'proof'}];
 const p=P.plan(P.parse('Assign slip PART-77 to truck ANG 12'),s,'admin');await P.apply(s,p,'Admin','admin',helpers);
 a.equal(s.expenses[0].tripId,'');a.equal(s.expenses[0].truckId,'tr');a.equal(s.expenses[0].receiptUploadId,'proof');a.equal(s.trips[0].recalculated,true);
});
test('receipt duplicate cannot be captured again with same known slip number',()=>{
 const s=state();s.diesel=[{id:'f',truckId:'tr',slip:'F77'}];a.throws(()=>P.plan({operation:'diesel',collection:'diesel',values:{truck:'ANG 12',date:'2026-10-24',litres:100,total:2700,slip:'F77'}},s,'admin'),/already recorded/);
});
test('quotation uses shared cost engine and stores compatible per-km breakdown',async()=>{
 const s=state(),p=P.plan({operation:'quote',collection:'quotes',values:{route:'Windhoek to Walvis',client:'Example',date:'2026-10-24',amount:20000}},s,'finance');
 a.equal(s.quotes.length,0);a.equal(p.values.costing.litres,200);a.equal(p.values.costing.namibiaKm,400);
 await P.apply(s,p,'Finance','finance',helpers);a.equal(s.quotes[0].quotedIncome,20000);a.equal(s.quotes[0].totalInclVat,23000);a.ok(s.quotes[0].costing.rows.some(r=>r.label==='MDC'));
 const edit=P.plan(P.parse('Edit quotation Q-1001 amount to 22000'),s,'finance');await P.apply(s,edit,'Finance','finance',helpers);a.equal(s.quotes[0].totalInclVat,25300);a.equal(s.quotes[0].legs[0].quotedAmount,22000);
});
test('quotation requires saved costs and never assumes cross-border Namibia km',()=>{
 const s=state(),r={operation:'quote',collection:'quotes',values:{route:'Windhoek to Walvis',client:'Example',date:'2026-10-24',amount:10000}};
 delete s.settings.quoteCostDefaults;a.throws(()=>P.plan(r,s,'finance'),/costing defaults/);s.routes[0].crossBorder=true;delete s.routes[0].namibiaKm;a.throws(()=>P.plan(r,s,'finance'),/Namibia kilometres/);
});
test('POD requires real attachment and exact multi-load leg, never guesses',()=>{
 const s=state();s.trips[0].legs=[{id:'l1',sequence:1},{id:'l2',sequence:2}];
 a.throws(()=>P.plan(P.parse('Attach POD to trip AT-101'),s,'admin'),/Attach the POD/);
 a.throws(()=>P.plan(P.parse('Attach POD to trip AT-101'),s,'admin',true),/multiple loads/);
 const p=P.plan(P.parse('Attach POD to trip AT-101 leg 2'),s,'admin',true);a.equal(p.values.legId,'l2');
});
test('invoice delegates to shared billing helper, with explicit load selection',async()=>{
 const s=state(),p=P.plan(P.parse('Create invoice for trip AT-101 leg 1'),s,'finance');let args;
 await P.apply(s,p,'Finance','finance',{...helpers,invoice(...v){args=v;return{invoice:{id:'new'}}}});a.deepEqual(args.slice(1),['t','l']);
 s.trips[0].legs.push({id:'l2',sequence:2});a.throws(()=>P.plan(P.parse('Create invoice for trip AT-101'),s,'finance'),/leg number/);
});
test('NBL invoice scopes billing period and detects changed billing dependencies',async()=>{
 const s=state(),p=P.plan(P.parse('Generate NBL consolidated invoice for 2026-10'),s,'finance');s.expenses.push({id:'e'});
 await a.rejects(P.apply(s,p,'Finance','finance',helpers),/changed after preview/);
});
test('live record and tender summaries enforce roles and return stable record IDs',()=>{
 const s=state();a.match(P.read('Show invoice INV-1001',s,'finance').answer,/INV-1001/);a.equal(P.read('List invoices',s,'driver').source,'record-permission');a.match(P.read('Show tender information',s,'finance').answer,/Namibia MDC/);
});
