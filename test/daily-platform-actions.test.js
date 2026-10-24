const test=require('node:test'),assert=require('node:assert/strict'),D=require('../daily-platform-actions');
const now=Date.parse('2026-10-23T12:00:00Z');
test('one daily group contains every affected trip and remains one on repeated checks',()=>{
 const state={trips:[{id:'a',number:'A',date:'2026-10-23',stage:4},{id:'b',number:'B',date:'2026-10-23',stage:4}]};
 let rows=D.reconcile(state,now);assert.equal(rows.find(x=>x.key==='missing-pod').items.length,2);const id=rows.find(x=>x.key==='missing-pod').id;
 rows=D.reconcile(state,now+1000);assert.equal(rows.filter(x=>x.key==='missing-pod').length,1);assert.equal(rows.find(x=>x.key==='missing-pod').id,id);
 state.trips[0].pod=true;rows=D.reconcile(state,now+2000);assert.equal(rows.find(x=>x.key==='missing-pod').items.filter(x=>x.completed).length,1);
 state.trips[1].pod=true;rows=D.reconcile(state,now+3000);assert.equal(rows.find(x=>x.key==='missing-pod').status,'Completed');
});
test('unresolved groups get exactly one new day identity at Windhoek midnight',()=>{
 const state={permits:[{id:'p',type:'Vehicle licence',expiry:'2026-10-01'}]};
 const a=D.reconcile(state,Date.parse('2026-10-23T21:59:00Z')).find(x=>x.key==='document-renewal');
 const b=D.reconcile(state,Date.parse('2026-10-23T22:01:00Z')).find(x=>x.key==='document-renewal');
 assert.notEqual(a.id,b.id);assert.equal(b.date,'2026-10-24');assert.equal(D.reconcile(state,Date.parse('2026-10-23T22:02:00Z')).filter(x=>x.key==='document-renewal').length,1);
});
test('a resolved condition returning today reuses the same notification identity',()=>{
 const state={permits:[{id:'p',expiry:'2026-10-01'}]};let a=D.reconcile(state,now).find(x=>x.key==='document-renewal');
 state.permits[0].expiry='2028-01-01';assert.equal(D.reconcile(state,now)[0].status,'Completed');
 state.permits[0].expiry='2026-10-01';assert.equal(D.reconcile(state,now)[0].id,a.id);
});
test('role scope and historical/cancelled trip exclusions',()=>{
 const state={trips:[{id:'old',date:'2026-09-01'},{id:'cancelled',date:'2026-10-23',status:'Cancelled'}]};
 assert.equal(D.collect(state,now).length,0);assert.equal(D.allowed({roles:['finance']},'dispatcher'),false);assert.equal(D.allowed({roles:['finance']},'admin'),true);
});
test('no missing POD or diesel tasks for a planned trip; shunters need no trip diesel',()=>{
 const rows=D.collect({trips:[{id:'p',stage:1},{id:'s',stage:4,shunter:true,pod:true}]},now);
 assert.equal(rows.some(x=>x.key==='missing-pod'),false);assert.equal(rows.some(x=>x.key==='trip-diesel'),false);
});

test('linked POD tasks complete only when every required load has proof',()=>{
 const state={tasks:[{id:'task',title:'Upload POD for A',status:'Open',linkedType:'trip',linkedId:'a'}],trips:[{id:'a',legs:[{pod:true},{pod:false}]}]};
 D.reconcile(state,now);assert.equal(state.tasks[0].status,'Open');state.trips[0].legs[1].pod=true;D.reconcile(state,now);assert.equal(state.tasks[0].status,'Completed');assert.match(state.tasks[0].completionReason,/proof/);
});
test('unrelated tasks and tasks with financial completion controls are not guessed complete',()=>{
 const state={tasks:[{id:'review',title:'Review POD process',status:'Open',linkedType:'trip',linkedId:'a'},{id:'funds',title:'Upload POD for A',status:'Open',fundsUsed:true,linkedType:'trip',linkedId:'a'}],trips:[{id:'a',pod:true}]};
 D.reconcile(state,now);assert.ok(state.tasks.every(t=>t.status==='Open'));
});
test('expired compliance is critical while renewed compliance becomes completed',()=>{
 const state={permits:[{id:'p',expiry:'2026-10-01'}]};let group=D.reconcile(state,now).find(g=>g.key==='document-renewal');assert.equal(group.priority,'Critical');
 state.permits[0].expiry='2028-01-01';group=D.reconcile(state,now).find(g=>g.key==='document-renewal');assert.equal(group.status,'Completed');assert.equal(group.priority,'Completed');
});

test('payroll review identifies workers and month, not internal UUIDs',()=>{
 const state={
  employees:[{id:'emp_keshia',name:'Keshia Employee'}],
  drivers:[{id:'drv_elia',name:'Elia Driver'}],
  payroll:[
   {id:'pay_558ad200-9e83-47ef-a7bb-29c7ed702e58',employeeId:'emp_keshia',period:'2026-10',status:'Draft'},
   {id:'pay_1b70fa58-540c-4772-987d-ab84acb66251',employeeId:'drv_elia',period:'2026-10',status:'Draft'},
   {id:'pay_53ce0d1e-8e03-4900-b7e1-e0de728654cb',employeeId:'missing_worker',period:'2026-10',status:'Draft'}
  ]
 };
 const group=D.reconcile(state,now).find(g=>g.key==='payroll-review');
 assert.equal(group.items.length,3);
 assert.deepEqual(group.items.map(x=>x.title),[
  'Keshia Employee · Payslip 2026-10','Elia Driver · Payslip 2026-10','Employee · Payslip 2026-10'
 ]);
 assert.equal(group.items[0].linkedId,'pay_558ad200-9e83-47ef-a7bb-29c7ed702e58');
 assert.ok(group.items.every(x=>!x.title.includes('pay_')));
});
test('opaque internal record references stay as linked IDs and not visible titles',()=>{
 const state={expenses:[{id:'exp_1a2b3c4d-55ff-66dd-77bb-88bb99aa00cc',status:'Pending',category:'Meals'}]};
 const group=D.collect(state,now).find(g=>g.key==='expense-review');
 assert.ok(group);assert.equal(group.items[0].title,'Expense');
 assert.equal(group.items[0].linkedId,state.expenses[0].id);
});
