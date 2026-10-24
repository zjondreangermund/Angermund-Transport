const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../server.js'),'utf8');
function run(trip,src,extra={}){
 const state={trips:[trip],clients:[{id:'cli_nbl'}],routes:[],trailers:[],...extra};
 const ctx={num:v=>Number(v||0),importAllowed:require('../operational-cutoff').importAllowed,
 findImportTruck:(_s,p)=>p==='ANG 10'?{id:'truck10'}:null,defaultDriverId:()=> 'anton',
 excelImportKey:v=>String(v||'').toLowerCase(),excelImportSlug:v=>String(v),fleetKey:v=>v,
 trailerTypeFromImport:()=> 'Trailer',isShunterTruckId:()=>false,setTripTypeFromTruck:()=>{},
 ensureTripLegs:(_s,t)=>t.legs,recalcTripCosts:()=>{},applyTruckDriverDefaults:()=>{},
 upsertImportedShunterRecon:()=>{}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function applyCarrierWorkbookRows'),source.indexOf('function applyInsuranceWorkbookData')),ctx);
 return {state,result:ctx.applyCarrierWorkbookRows(state,[{tmsId:'66029454',pickDate:'2026-10-21',pro:'ANG 10',origin:'Windhoek',destination:'Ondangwa',rate:34883,product:'Beer',weightUom:'kg',weightKg:1000,...src}],'new.xlsx','batch')};
}
const fixture=()=>({id:'trip_tms_66029454',externalTmsId:'66029454',loadEditedAt:'2026-10-24',truckId:'',driverId:'',stage:3,status:'In transit',podUploadId:'pod',legs:[{id:'leg1',status:'In transit',pod:true}],dieselCost:123});
test('new workbook updates manually edited existing load and assigns ANG 10 without duplicate or loss of proof/progress',()=>{
 const t=fixture(),{state,result}=run(t);assert.equal(result.updated,1);assert.equal(result.skipped,0);assert.equal(state.trips.length,1);assert.equal(t.truckId,'truck10');assert.equal(t.driverId,'anton');assert.equal(t.income,34883);assert.equal(t.podUploadId,'pod');assert.equal(t.legs[0].pod,true);assert.equal(t.status,'In transit');assert.equal(t.legs[0].status,'In transit');assert.equal(t.dieselCost,123);
});
test('blank truck on later workbook keeps saved assignment',()=>{const t=fixture();t.truckId='truck10';t.driverId='anton';run(t,{pro:''});assert.equal(t.truckId,'truck10');assert.equal(t.driverId,'anton')});
test('invoiced load is protected from workbook overwrite',()=>{for(const extra of [{invoiceId:'invoice'},{legs:[{invoiceId:'invoice'}]}]){const t={...fixture(),...extra},before=JSON.stringify(t),{result}=run(t);assert.equal(result.skipped,1);assert.equal(JSON.stringify(t),before)}});
test('numeric TMS references match existing load without duplicate',()=>{const t=fixture();t.externalTmsId=66029454;const {state,result}=run(t,{tmsId:66029454});assert.equal(result.updated,1);assert.equal(state.trips.length,1)});
