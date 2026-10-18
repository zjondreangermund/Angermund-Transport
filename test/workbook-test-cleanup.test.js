const test=require('node:test'),assert=require('node:assert/strict');
const {removeWorkbookTests}=require('../workbook-test-cleanup');
const {collectOperationalAlerts}=require('../operational-alerts');
test('remove dated workbook tests and linked costs, preserving real imports and new transactions',()=>{
 const state={trips:[{id:'trip_xlsx_06',number:'AT-XLS-06',date:'2026-09-22'},{id:'real',number:'NBL-123',date:'2026-09-22',sourceWorkbook:'NBL.xlsx'}],diesel:[{id:'testfuel',tripId:'trip_xlsx_06'},{id:'realFuel',tripId:'real'}],expenses:[{tripId:'trip_xlsx_06'},{tripId:'real'}],quotes:[{id:'quote'}]};
 const result=removeWorkbookTests(state);assert.equal(result.counts.trips,1);assert.deepEqual(state.trips.map(t=>t.id),['real']);assert.deepEqual(state.diesel.map(t=>t.id),['realFuel']);assert.equal(state.expenses.length,1);assert.equal(state.quotes.length,1);assert.equal(removeWorkbookTests(state).counts.trips,0);
});
test('partial saves do not erase trips and still reject stale linked test costs',()=>{const s={expenses:[{tripId:'trip_xlsx_06'}]};removeWorkbookTests(s);assert.equal('trips' in s,false);assert.deepEqual(s.expenses,[])});
test('tests and old historical trips never create current alerts but real trips still do',()=>{
 const bad={date:'2026-09-22',stage:5,pod:true,income:100,startKm:1000,endKm:1100};
 const state={trips:[{...bad,id:'test',number:'AT-XLS-06'},{...bad,id:'history',number:'HIST-20220419-2',date:'2022-04-19'},{...bad,id:'real',number:'NBL-123'}],diesel:['test','history','real'].map(id=>({id:'f-'+id,tripId:id,litres:100,total:95,receiptMissing:true}))};
 const events=collectOperationalAlerts(state).events;assert.ok(events.length>0);assert.ok(events.every(e=>e.linkedId==='real'||e.linkedId==='f-real'));
});
