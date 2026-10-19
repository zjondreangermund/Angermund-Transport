const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/app.js','utf8');
function context(){const nodes={},c={page:'dispatch',adminSlipBatch:null,num:Number,Date,Promise,$:id=>nodes[id]??=( {classList:{remove(){},add(){}},innerHTML:''}),renderAdminBatchReview(){c.reviewed=true},adminScanDraft:x=>({...x}),confirm:()=>true,notify(){},refreshCentralState:async()=>{},render(){c.rendered=true},go(){throw Error('Must stay on Dispatch')}};vm.createContext(c);return c}
test('batch scans at most two photos concurrently, preserves order and isolates failures',async()=>{
 const c=context();let active=0,peak=0;
 c.scanDriverReceipt=async file=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,file===0?5:1));active--;if(file===1)throw Error('Unreadable');return {file,date:'2026-10-19'}};
 vm.runInContext(source.slice(source.indexOf('async function openAdminBatchSlips('),source.indexOf('function batchTripOptions(')),c);
 await c.openAdminBatchSlips([0,1,2]);assert.equal(peak,2);assert.equal(c.reviewed,true);assert.equal(c.adminSlipBatch.items[0].scan.file,0);assert.equal(c.adminSlipBatch.items[1].status,'error');assert.equal(c.adminSlipBatch.items[2].scan.file,2);assert.equal(c.adminSlipBatch.returnPage,'dispatch');
});
test('batch posting stays on Dispatch and retains only failed or unchecked slips',async()=>{
 const c=context();vm.runInContext(source.slice(source.indexOf('async function confirmAdminBatch('),source.indexOf('async function openAdminSmartSlip(')),c);
 const item=id=>({id,status:'ready',include:true,draft:{date:'2026-10-19'}}),a=item('a'),b=item('b'),skip={...item('skip'),include:false};
 c.adminSlipBatch={returnPage:'dispatch',items:[a,b,skip]};c.postAdminSlipDraft=async x=>{if(x.id==='b')throw Error('Save failed')};
 await c.confirmAdminBatch();assert.equal(c.page,'dispatch');assert.equal(c.adminSlipBatch.items.length,2);assert.equal(c.adminSlipBatch.items[0].id,'b');assert.equal(c.adminSlipBatch.items[1].id,'skip');assert.equal(a.status,'posted');
 c.adminSlipBatch.items=[{...item('retry')}];c.postAdminSlipDraft=async()=>{};await c.confirmAdminBatch();assert.equal(c.adminSlipBatch,null);assert.equal(c.rendered,true);
});
test('AI scan skips OCR processing and uploads a bounded image while preserving source',async()=>{
 const c=context();c.providerConfig={receiptAI:{enabled:true}};const file={name:'original'};c.prepareReceiptForOcr=()=>{throw Error('Unnecessary OCR preprocessing')};c.prepareArchiveImage=async(f,size,quality)=>{assert.equal(f,file);assert.equal(size,2400);assert.equal(quality,.94);return {name:'scan-copy'}};c.scanReceiptFile=async f=>f.name;
 vm.runInContext(source.slice(source.indexOf('async function scanDriverReceipt('),source.indexOf('function plateKey(')),c);
 assert.equal(await c.scanDriverReceipt(file),'scan-copy');assert.equal(file.name,'original');
});
