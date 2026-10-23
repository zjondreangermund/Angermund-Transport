const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
function harness(api,refresh=async()=>{}){
  const context=vm.createContext({FormData:class{append(){}},api,refreshCentralState:refresh,render(){},notify(){},num:v=>Number(v||0),db:{importHistory:[{id:'saved'}]},excelImportBusy:false,excelImportFile:{name:'carrier.xlsx'},excelImportPreview:{kind:'nbl-carrier'},excelImportStatus:null});
  vm.runInContext(source.slice(source.indexOf('async function applyExcelWorkbook(){'),source.indexOf('async function undoExcelWorkbook')),context);
  return context;
}
test('explicit preview confirmation sends the import without a native dialog',async()=>{
  let calls=0;const c=harness(async()=>{calls++;return{id:'saved',created:10}});
  await c.applyExcelWorkbook();assert.equal(calls,1);assert.equal(c.excelImportStatus.title,'Excel import saved');assert.equal(c.excelImportFile,null);assert.equal(c.excelImportBusy,false);
});
test('server failures remain visible and preserve the preview',async()=>{
  const c=harness(async()=>{throw Error('Database unavailable')});await c.applyExcelWorkbook();assert.match(c.excelImportStatus.message,/Database unavailable/);assert.ok(c.excelImportFile);assert.ok(c.excelImportPreview);assert.equal(c.excelImportBusy,false);
});
test('a failed refresh does not report a saved import as a failed save',async()=>{
  const c=harness(async()=>({id:'saved',created:10}),async()=>{throw Error('Offline')});await c.applyExcelWorkbook();assert.equal(c.excelImportStatus.title,'Import saved — refresh failed');assert.equal(c.excelImportFile,null);
});
test('double clicks cannot send two simultaneous imports',async()=>{
  let release,calls=0;const c=harness(()=>{calls++;return new Promise(r=>release=r)});const first=c.applyExcelWorkbook();await c.applyExcelWorkbook();assert.equal(calls,1);release({id:'saved',created:10});await first;
});
test('stale refreshed history is shown separately from server success',async()=>{
  const c=harness(async()=>({id:'new',created:10}));await c.applyExcelWorkbook();assert.equal(c.excelImportStatus.title,'Import saved — refresh needed');
});
