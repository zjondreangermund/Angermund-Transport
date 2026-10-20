const test=require('node:test'),assert=require('node:assert/strict');
const {VERSION,importAllowed,pruneOperationalHistory}=require('../operational-cutoff');
test('inclusive cutoff removes old transactions, keeps newer records and master data',()=>{
 const master={trucks:[{id:'truck',purchased:'2020-01-01'}],drivers:[{id:'driver'}],clients:[{id:'client'}],settings:{vat:15},quotes:[{date:'2026-01-01'}]};
 const s={...structuredClone(master),trips:[{id:'old',date:'2026-09-19'},{id:'keep',date:'2026-09-20'}],diesel:[{id:'f1',date:'2026-09-19',tripId:'old'},{id:'f2',date:'2026-09-20',tripId:'old',truckId:'truck',receiptUploadId:'proof'}],expenses:[{id:'e',tripId:'old'}],payroll:[{id:'aug',period:'2026-08',createdAt:'2026-10-01'},{id:'sep',period:'2026-09'}],lastImportBackup:{snapshot:{trips:[{id:'old'}]}}};
 const r=pruneOperationalHistory(s,{initial:true});assert.deepEqual(s.trips.map(x=>x.id),['keep']);assert.deepEqual(s.diesel.map(x=>x.id),['f2']);assert.equal(s.diesel[0].tripId,'');assert.equal(s.diesel[0].receiptUploadId,'proof');assert.equal(s.diesel[0].scope,'company');assert.equal(s.expenses.length,0);assert.deepEqual(s.payroll.map(x=>x.id),['sep']);assert.equal(s.lastImportBackup,null);assert.equal(s.recordDeletionVersion,VERSION);for(const k of Object.keys(master))assert.deepEqual(s[k],master[k]);assert.equal(r.counts.trips,1);
});
test('repeated cleanup is stable; date validation and undated imports do not invent dates',()=>{
 assert.equal(importAllowed('2026-09-19'),false);assert.equal(importAllowed('2026-09-20'),true);assert.equal(importAllowed('2026-10-20'),true);assert.equal(importAllowed('2026-02-31'),false);assert.equal(importAllowed(''),false);
 const s={trips:[{id:'x',date:'2026-09-20'}],monthlyPnl:{},audit:[]};pruneOperationalHistory(s,{initial:true});const before=structuredClone(s);pruneOperationalHistory(s);assert.deepEqual(s,before);
});
test('old fuel on a retained trip is removed from cached costs without changing new fuel',()=>{
 const s={trips:[{id:'t',date:'2026-09-20',income:1000,dieselCost:300,actualTripCost:300}],diesel:[{id:'old',tripId:'t',date:'2026-09-19',total:100},{id:'new',tripId:'t',date:'2026-09-20',total:200}]};pruneOperationalHistory(s);assert.equal(s.trips[0].dieselCost,200);assert.equal(s.trips[0].actualTripCost,200);assert.equal(s.trips[0].actualProfit,800);
});
test('database migration backs up before deletion and rolls back on failure',async()=>{
 const {applyOperationalCutoff}=require('../operational-cutoff-db'),queries=[];
 const c={async query(q){queries.push(q);if(q.startsWith('SELECT payload'))return{rows:[{payload:{trips:[{id:'old',date:'2026-01-01'},{id:'new',date:'2026-09-20'}],trucks:[{id:'truck'}]}}]};if(q.startsWith('WITH removed'))throw Error('database failure');return{rows:[]}},release(){queries.push('RELEASE')}};
 await assert.rejects(()=>applyOperationalCutoff({connect:async()=>c}),/database failure/);assert.ok(queries.findIndex(x=>x.startsWith('INSERT INTO app_state_backups'))<queries.findIndex(x=>x.startsWith('WITH removed')));assert.equal(queries.includes('ROLLBACK'),true);assert.equal(queries.includes('COMMIT'),false);
});
