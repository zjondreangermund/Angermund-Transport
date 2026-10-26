'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Link=require('../payroll-trip-link');
test('payroll resolves a separate workforce record to the assigned driver without changing trip ownership',()=>{
 const s={drivers:[{id:'drv_anton',name:'Anton Munangwa'},{id:'drv_other',name:'Josef'}]};
 assert.equal(Link.resolveDriver(s,{id:'emp_anton',name:'Anton Munangwa'}).id,'drv_anton');
 assert.equal(Link.resolveDriver(s,{id:'emp_1',driverId:'drv_other',name:'Anton Munangwa'}).id,'drv_other');
 assert.equal(Link.resolveDriver(s,{id:'emp_missing',name:'Nobody'}),null);
});
test('ambiguous names cannot merge different driver payroll',()=>{
 const s={drivers:[{id:'a',name:'Anton'},{id:'b',name:'Anton'}]};
 assert.equal(Link.resolveDriver(s,{id:'employee',name:'Anton'}),null);
});
test('pay only trips assigned to that driver, including legacy completed status',()=>{
 const s={trips:[
 {id:'a',driverId:'drv_anton',date:'2026-10-21',stage:4,status:'Delivered'},
 {id:'b',driverId:'drv_anton',date:'2026-10-22',status:'Completed'},
 {id:'c',driverId:'drv_anton',date:'2026-10-23',stage:1,status:'Planned'},
 {id:'d',driverId:'drv_anton',date:'2026-10-24',stage:4,status:'Cancelled'},
 {id:'e',driverId:'drv_other',date:'2026-10-25',stage:4},
 {id:'f',driverId:'drv_anton',date:'2026-09-25',stage:4}
 ]};
 assert.deepEqual(Link.eligibleTrips(s,{id:'drv_anton'},'2026-10-01','2026-11-01').map(t=>t.id),['a','b']);
});
test('server payroll uses linked driver and does not regenerate approved payslips',()=>{
 const fs=require('node:fs'),src=fs.readFileSync('server.js','utf8');
 assert.match(src,/PayrollTripLink\.resolveDriver\(state,employee\)/);
 assert.match(src,/PayrollTripLink\.eligibleTrips\(state,driver,start,end,/);
 assert.match(src,/if\(existing&&\['Approved','Paid'\]\.includes\(existing\.status\)\)/);
});
