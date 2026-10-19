const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const server=fs.readFileSync('server.js','utf8'),client=fs.readFileSync('public/app.js','utf8');
const c={num:v=>Number(v)||0,receiptSupplier:()=> 'Station',classifyReceipt:()=>({category:'Diesel',confidence:98}),RECEIPT_AI_SOL_THRESHOLD:80};
vm.createContext(c);
vm.runInContext(server.slice(server.indexOf('function receiptDateISO('),server.indexOf('async function recognizeReceiptBest(')),c);
vm.runInContext(server.slice(server.indexOf('function finalizeReceiptExtraction('),server.indexOf('async function openAiReceiptExtract(')),c);
vm.runInContext(client.slice(client.indexOf('function weakReceiptResult('),client.indexOf('function mergeSupportingReceipt(')),c);
vm.runInContext(client.slice(client.indexOf('function receiptClientScore('),client.indexOf('async function scanReceiptFile(')),c);
test('reads numeric, spaced and named receipt dates; rejects impossible dates',()=>{
 for(const date of ['19/10/26','2026 - 10 - 19','19-Oct-2026','19 October 26'])assert.equal(c.receiptDateISO(date),'2026-10-19');
 assert.equal(c.receiptDateISO('31/02/2026'),'');assert.equal(c.receiptDateISO('29/02/2024'),'2024-02-29');
});
test('extracts named date, grouped odometer and fuel values together',()=>{
 for(const label of ['ODOMETER','ODO','Odemeter','Mileage','KM reading']){
  const r=c.extractReceiptFields('Station\nDate: 19-Oct-2026\n'+label+': 123 456 km\n100 (L) 25.00 2500.00\nTOTAL N$ 2500.00');
  assert.equal(r.date,'2026-10-19');assert.equal(r.odometer,123456);assert.equal(r.litres,100);assert.equal(r.suggestedAmount,2500);
 }
 assert.equal(c.receiptOdometer('123,456'),123456);assert.equal(c.receiptOdometer('123.456'),123456);assert.equal(c.receiptOdometer('unknown'),null);
});
test('missing dates and odometers trigger retry and review even with good fuel maths',()=>{
 const full={category:'Diesel',categoryConfidence:98,extractionConfidence:99,date:'2026-10-19',odometer:123456,litres:100,pricePerLitre:25,suggestedAmount:2500};
 assert.equal(c.weakReceiptResult(full),false);assert.equal(c.receiptNeedsSol(full,full,null,0),false);
 for(const key of ['date','odometer']){const r={...full,[key]:null};assert.equal(c.weakReceiptResult(r),true);assert.equal(c.receiptNeedsSol(c.finalizeReceiptExtraction(r),r,null,0),key==='date');assert.equal(c.finalizeReceiptExtraction(r).needsReview,true)}
});
test('merges preserve existing text fields and fill only missing details',()=>{
 const primary={category:'Diesel',categoryConfidence:99,date:'2026-10-19',supplier:'Correct Station',documentNumber:'F123',litres:100,suggestedAmount:2500};
 const second={category:'Diesel',categoryConfidence:70,date:'2026-10-18',supplier:'Other',documentNumber:'wrong',odometer:123456};
 for(const merge of [c.mergeReceiptExtractions,c.mergeClientReceiptResults]){
  const r=merge===c.mergeReceiptExtractions?merge([primary,second]):merge(primary,second);
  assert.equal(r.date,primary.date);assert.equal(r.supplier,primary.supplier);assert.equal(r.documentNumber,primary.documentNumber);assert.equal(r.odometer,123456);
 }
});
