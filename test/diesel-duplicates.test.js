'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../diesel-duplicates');
const row=(id,extra={})=>({id,slip:'RC-12345',truckId:'ang10',tripId:'nbl65964343',date:'2026-10-07',litres:679.97,price:28.35,odometer:123456,...extra});
test('receipt numbers ignore spacing, punctuation and case across trips and uploads',()=>{
 const a=row('a'),b=row('b',{slip:' rc 12345 ',tripId:'other',receiptUploadId:'new-photo'});
 assert.throws(()=>D.assertNew([a],b),{status:409});assert.throws(()=>D.assertChanges([a],[a,b]),{status:409});
});
test('same trip permits separate numbered fuel receipts and dates',()=>{
 const a=row('a'),b=row('b',{slip:'RC-54321',date:'2026-10-13',litres:308.34});
 assert.doesNotThrow(()=>D.assertChanges([a],[a,b]));assert.equal(D.pairs([a,b]).length,0);
});
test('same image cannot be recorded under another slip number',()=>{
 assert.throws(()=>D.assertNew([row('a',{receiptUploadIds:['photo']})],row('b',{slip:'different',receiptUploadId:'photo'})),{status:409});
});
test('manual edits cannot create a duplicate and existing entries can still be corrected',()=>{
 const a=row('a'),b=row('b',{slip:'different'});
 assert.throws(()=>D.assertChanges([a,b],[a,{...b,slip:a.slip}]),{status:409});
 assert.doesNotThrow(()=>D.assertChanges([a],[{...a,litres:680}]));
});
test('existing duplicates do not block unrelated saves, but a third copy is rejected',()=>{
 const a=row('a'),b=row('b');
 assert.doesNotThrow(()=>D.assertChanges([a,b],[a,b]));
 assert.doesNotThrow(()=>D.assertChanges([a,b],[a]));
 assert.throws(()=>D.assertChanges([a,b],[a,b,row('c')]),{status:409});
});
test('no receipt number and workbook labels never become unique receipt identities',()=>{
 for(const slip of ['', 'N/A', 'Unknown', 'Workbook · sheet row 2']){
 const a=row('a',{slip}),b=row('b',{slip});
 assert.doesNotThrow(()=>D.assertNew([a],b));
 assert.equal(D.sameReceipt(a,b),false);
 }
});
test('identical screenshot fuel rows without a number are review candidates only',()=>{
 const a=row('a',{slip:''}),b=row('b',{slip:''});
 assert.equal(D.pairs([a,b]).length,1);
 assert.equal(D.pairs([a,{...b,litres:350.35}]).length,0);
 assert.doesNotThrow(()=>D.assertNew([a],b));
});
test('different actual receipt numbers are not proposed for deletion just for matching amounts',()=>{
 assert.equal(D.pairs([row('a'),row('b',{slip:'RC-999'})]).length,0);
});
test('guard and cleanup are wired into server and browser',()=>{
 const fs=require('node:fs'),s=fs.readFileSync('server.js','utf8');
 assert.equal((s.match(/DieselDuplicates.assertChanges\(previousDiesel,state.diesel\|\|\[\]\)/g)||[]).length,2);
 for(const match of s.matchAll(/state.diesel.unshift\(rec\)/g))assert.ok(s.slice(match.index-60,match.index).includes('DieselDuplicates.assertNew'));
 assert.match(s,/diesel-duplicates\/resolve',auth,roles\('admin','manager','finance'\)/);
 assert.match(s,/deleteRecord\(state,'diesel',duplicate.id/);
 assert.match(fs.readFileSync('public/app.js','utf8'),/reviewDieselDuplicates/);
});
