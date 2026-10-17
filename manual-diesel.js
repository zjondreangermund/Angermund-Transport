'use strict';
function createManualDiesel(state,body,id,actor,now=new Date().toISOString()){
  const fail=message=>{const e=new Error(message);e.status=400;throw e};
  const value=k=>{const n=Number(body[k]||0);if(!Number.isFinite(n)||n<0)fail('Enter valid diesel amounts');return n};
  const litres=value('litres'),enteredTotal=value('total'),enteredPrice=value('price');
  if(litres<=0||(!enteredTotal&&!enteredPrice))fail('Enter litres and either total paid or price per litre');
  const total=Number((enteredTotal||litres*enteredPrice).toFixed(2)),price=enteredTotal?enteredTotal/litres:enteredPrice;
  const trip=body.tripId?(state.trips||[]).find(t=>t.id===body.tripId):null;
  if(body.tripId&&!trip)fail('Trip not found');
  const truckId=trip?.truckId||String(body.truckId||''),driverId=trip?.driverId||String(body.driverId||'');
  if(!(state.trucks||[]).some(t=>t.id===truckId))fail('Select a truck for this diesel entry');
  if(driverId&&!(state.drivers||[]).some(d=>d.id===driverId))fail('Driver not found');
  const date=String(body.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('Enter a valid diesel date');
  const slip=String(body.slip||'').trim().slice(0,120),missing=body.receiptStatus!=='Reference available'||!slip;
  const legs=(trip?.legs||[]).slice().sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0));
  const leg=body.legId?legs.find(l=>l.id===body.legId):legs.find(l=>!['Delivered','Invoiced','Closed'].includes(l.status))||legs.at(-1);
  if(body.legId&&!leg)fail('Journey leg not found');
  const rec={id,date,tripId:trip?.id||'',truckId,driverId,legId:leg?.id||'',litres,price,total,odometer:value('odometer'),supplier:String(body.supplier||'').trim().slice(0,160),slip,notes:String(body.notes||'').trim().slice(0,1000),manualEntry:true,receiptMissing:missing,receiptStatus:missing?'Slip missing':'Reference available',receiptUploadId:'',receiptUploadIds:[],receiptCount:0,verified:false,status:missing?'Receipt missing':'Review',createdAt:now,createdBy:actor};
  state.diesel??=[];state.diesel.unshift(rec);return rec;
}
module.exports={createManualDiesel};
