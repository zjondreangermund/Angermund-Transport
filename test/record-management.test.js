const test=require('node:test'),assert=require('node:assert/strict');
const {deleteRecord,editRecord,allowed}=require('../record-management');
function fixture(){return{invoices:[{id:'i',number:'TEST',amount:100}],trips:[{id:'t',invoiceId:'i',invoiceIds:['i'],stage:5,status:'Invoiced',pod:true,legs:[{id:'l',invoiceId:'i',status:'Invoiced',pod:true}]}],shunterRecons:[{id:'sh',invoiceId:'i'}],payments:[],diesel:[],expenses:[]}}
test('deleting an unpaid invoice releases loads and shunter references while preserving POD and trips',()=>{const s=fixture();deleteRecord(s,'invoices','i','Owner');assert.equal(s.invoices.length,0);assert.equal(s.trips.length,1);assert.equal(s.trips[0].legs[0].invoiceId,'');assert.equal(s.trips[0].stage,4);assert.equal(s.trips[0].status,'Delivered');assert.equal(s.trips[0].pod,true);assert.deepEqual(s.trips[0].invoiceIds,[]);assert.equal(s.shunterRecons[0].invoiceId,'');assert.equal(s.recordHistory[0].record.number,'TEST');assert.ok(s.recordDeletionVersion)});
test('payment must be removed before invoice; removing payment refreshes its balance',()=>{const s=fixture();s.payments=[{id:'p',invoiceId:'i',amount:25}];s.invoices[0].paidAmount=25;assert.throws(()=>deleteRecord(s,'invoices','i'),/payments/);assert.equal(s.invoices.length,1);deleteRecord(s,'payments','p');assert.equal(s.invoices[0].paidAmount,0);assert.equal(s.invoices[0].balance,100);deleteRecord(s,'invoices','i');assert.equal(s.invoices.length,0)});
test('trip deletion protects invoices but automatically removes its own diesel and expenses',()=>{const s=fixture();assert.throws(()=>deleteRecord(s,'trips','t'),/invoice/);deleteRecord(s,'invoices','i');s.diesel=[{id:'f',tripId:'t'},{id:'otherfuel',tripId:'other'}];s.expenses=[{id:'e',tripId:'t',category:'Toll',amount:175},{id:'mdc',tripId:'t',mdc:true,amount:80},{id:'otherexp',tripId:'other',amount:20}];const result=deleteRecord(s,'trips','t');assert.equal(s.trips.length,0);assert.equal(result.removedDiesel,1);assert.equal(result.removedExpenses,2);assert.deepEqual(s.diesel.map(x=>x.id),['otherfuel']);assert.deepEqual(s.expenses.map(x=>x.id),['otherexp']);assert.equal(s.recordHistory[0].kind,'trips');assert.deepEqual(s.recordHistory[0].related.filter(x=>x.kind==='diesel').map(x=>x.record.id),['f']);assert.deepEqual(s.recordHistory[0].related.filter(x=>x.kind==='expenses').map(x=>x.record.id),['e','mdc'])});
test('deleting payroll reverses only its posted loan deductions and suppresses automatic regeneration',()=>{const s={payroll:[{id:'p',period:'2026-10',employeeId:'e',status:'Paid'}],loans:[{id:'loan',balance:40,status:'Active',repayments:[{payrollId:'p',amount:30},{payrollId:'other',amount:10}]}]};deleteRecord(s,'payroll','p');assert.equal(s.loans[0].balance,70);assert.equal(s.loans[0].repayments.length,1);assert.equal(s.loans[0].repayments[0].payrollId,'other');assert.deepEqual(s.deletedPayrollPeriods,['2026-10:e']);assert.equal(s.recordHistory[0].related[0].record.balance,40)});
test('background payroll honors deleted employee/period while explicit generation remains available',()=>{const fs=require('node:fs'),vm=require('node:vm'),src=fs.readFileSync(require.resolve('../server.js'),'utf8'),ctx={workforceEmployees:()=>[{id:'e'}],payrollProfile:()=>({}),calculatePayrollRecord:()=>({id:'new',period:'2026-10',employeeId:'e'})};vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('function generatePayrollPeriod('),src.indexOf('function monthPeriod(')),ctx);const s={payroll:[],deletedPayrollPeriods:['2026-10:e']};ctx.generatePayrollPeriod(s,'2026-10',true);assert.equal(s.payroll.length,0);ctx.generatePayrollPeriod(s,'2026-10',false);assert.equal(s.payroll.length,1)});
test('quotation edits change saved line prices and totals without creating another quotation',()=>{const s={quotes:[{id:'q',quotedIncome:100,estimatedCost:20,legs:[{manualAmount:100}]}]};editRecord(s,'quotes','q',{number:'UPDATED',lineAmounts:{0:150}});assert.equal(s.quotes.length,1);assert.equal(s.quotes[0].quotedIncome,150);assert.equal(s.quotes[0].expectedProfit,130);assert.equal(s.quotes[0].legs[0].manualAmount,150)});
test('diesel corrections keep quantities and totals consistent and reject stale edits',()=>{const s={diesel:[{id:'f',litres:10,total:100,tripId:'t'}],trips:[{id:'t',truckId:'truck',driverId:'driver'}]};editRecord(s,'diesel','f',{litres:20,total:300});assert.equal(s.diesel[0].price,15);assert.equal(s.diesel[0].printedTotal,300);assert.equal(s.diesel[0].truckId,'truck');assert.throws(()=>editRecord(s,'diesel','f',{expectedUpdatedAt:'old',total:200}),/changed/);assert.throws(()=>editRecord(s,'diesel','f',{litres:-1}),/non-negative/)});
test('record management enforces roles and protects master/account records',()=>{assert.equal(allowed('invoices','driver'),false);assert.equal(allowed('invoices','dispatcher'),false);assert.equal(allowed('invoices','finance'),true);assert.equal(allowed('maintenance','workshop'),true);assert.equal(allowed('users','admin'),false);assert.throws(()=>deleteRecord({},'users','u'),/Unsupported/)});
test('state saves require deletion version so old browsers cannot restore deleted records',()=>{const s=require('node:fs').readFileSync(require.resolve('../server.js'),'utf8');assert.ok(s.includes("String(state.recordDeletionVersion||'')!==String(incoming.recordDeletionVersion||'')"));assert.ok(s.includes("String(incoming.recordDeletionVersion||'')"))});
test('trip deletion protects shunter reconciliation charges until its reference is removed',()=>{const s={trips:[{id:'t',number:'NBL-12345678',truckId:'ang4',externalTmsId:'12345678',shunterReconId:'r'}],shunterRecons:[{id:'r',truckId:'ang4',tmsIds:['12345678'],charge:4700}]};assert.throws(()=>deleteRecord(s,'trips','t'),/Shunter Recon/);assert.equal(s.trips.length,1);deleteRecord(s,'shunterRecons','r');deleteRecord(s,'trips','t');assert.equal(s.trips.length,0);assert.equal(s.recordHistory[0].kind,'trips')});

test('deleting trip cleans linked expense task and approval references but preserves other tasks',()=>{
 const state={trips:[{id:'t',number:'AT-501'},{id:'other',number:'AT-502'}],
  diesel:[{id:'fuel',tripId:'t'}],expenses:[{id:'exp1',tripId:'t'},{id:'exp2',tripId:'other'}],
  tasks:[{id:'task1',expenseId:'exp1',expenseAmount:250,fundsUsed:true,linkedType:'trip',linkedId:'t'},
    {id:'task2',expenseId:'exp2',expenseAmount:100,fundsUsed:true,linkedType:'trip',linkedId:'other'}],
  approvals:[{id:'approval1',linkedType:'expense',linkedId:'exp1',status:'Pending'},
    {id:'approval2',linkedType:'expense',linkedId:'exp2',status:'Pending'}]};
 const result=deleteRecord(state,'trips','t','Manager');
 assert.equal(result.removedDiesel,1);assert.equal(result.removedExpenses,1);
 assert.equal(state.tasks[0].expenseId,'');assert.equal(state.tasks[0].expenseAmount,0);assert.equal(state.tasks[0].fundsUsed,false);
 assert.equal(state.tasks[0].linkedId,'');assert.equal(state.tasks[1].expenseId,'exp2');
 assert.equal(state.approvals[0].status,'Cancelled');assert.equal(state.approvals[0].linkedId,'');
 assert.equal(state.approvals[1].status,'Pending');assert.equal(state.approvals[1].linkedId,'exp2');
 assert.ok(state.recordHistory[0].related.some(x=>x.kind==='task'&&x.record.expenseId==='exp1'));
 assert.ok(state.recordHistory[0].related.some(x=>x.kind==='approval'&&x.record.linkedId==='exp1'));
});
test('trip delete checks linked shunter records before touching diesel/expenses',()=>{
 const state={trips:[{id:'t',number:'NBL-12345',truckId:'ang4',shunterReconId:'recon'}],
  shunterRecons:[{id:'recon',truckId:'ang4',tmsIds:['12345']}],
  diesel:[{id:'fuel',tripId:'t'}],expenses:[{id:'exp',tripId:'t'}]};
 assert.throws(()=>deleteRecord(state,'trips','t'),/Shunter Recon/);
 assert.equal(state.trips.length,1);assert.equal(state.diesel.length,1);assert.equal(state.expenses.length,1);
 assert.equal(state.recordHistory,undefined);
});
test('trip delete refuses invoice MDC lines before deleting any linked costs',()=>{
 const state={trips:[{id:'t',number:'AT-501'}],invoices:[{id:'inv',mdcLines:[{tripId:'t',amount:120}]}],
  diesel:[{id:'fuel',tripId:'t'}],expenses:[{id:'mdc',tripId:'t',mdc:true}]};
 assert.throws(()=>deleteRecord(state,'trips','t'),/invoice/);
 assert.equal(state.diesel.length,1);assert.equal(state.expenses.length,1);
 assert.equal(state.trips.length,1);
});
test('unrelated record deletion retains existing behavior and does not cascade trip fuel',()=>{
 const state={trips:[{id:'t',number:'AT-201'}],diesel:[{id:'f',tripId:'t'}],expenses:[{id:'e',tripId:'t'}]};
 const result=deleteRecord(state,'diesel','f');
 assert.equal(result.removedDiesel,0);assert.equal(state.expenses.length,1);assert.equal(state.trips.length,1);
});
