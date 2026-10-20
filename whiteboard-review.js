'use strict';
const ID='whiteboard-1001025828-2026-10-20',key=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const seed=[];
function row(kind,name,registration,expiry='',personal='',border='',note=''){
 seed.push({id:'wb_'+(seed.length+1),include:true,kind,name,registration,expiry,personal,border,personalType:'Personal permit',targetId:'',note});
}
row('truck','Ang 2','N228751W','2027-04-30');
row('truck','Ang 3','N228757W','2026-12-31','','2027-06-07');
row('truck','Ang 4','N60518W','2026-10-31','2028-05-26','','Confirm personal document type and date.');
row('truck','Ang 5','N48332W','2027-08-31','2027-06-04','','Confirm personal document type and date.');
row('truck','Ang 10','N57660W','2027-03-31','2027-02-19','','Confirm personal document type.');
row('truck','Ang 11','N78215W','2027-03-31');
row('truck','Ang 12','N46928W','2027-05-31');
for(const [regs,date] of [[['N191231W','N191232W'],'2027-04-30'],[['N177260W','N173559W'],'2027-06-30'],[['N138587W','N138588W'],'2026-10-31'],[['N49108W','N49078W'],'2026-11-30'],[['N70413W','N71184W'],'2027-02-28'],[['N113256W','N97297W'],'2027-02-28'],[['N187021W','N187023W'],'2027-03-31']])for(const reg of regs)row('trailer','Trailer '+reg,reg,date,'','','Shared bracket date on board — confirm this is the licence expiry.');
row('trailer','3AS / 3-axle','N173063W','','','','No expiry date written. Confirm registration and trailer description.');
row('trailer','Plat wa','N171485W','2027-03-31','','','Confirm handwritten name and registration.');
row('trailer','Shona','N11080W','2026-11-30','','','Confirm handwritten name and registration.');
row('trailer','Beeswa','N98915W','2027-04-30');
row('trailer','Klein wa','N59981W','2027-08-31');
for(const [name,reg,date,note] of [
 ['MAN','N245780W','','No expiry date written. Confirm vehicle category.'],
 ['O. Bay','N67099W','2027-06-30','Confirm handwritten name and registration.'],
 ['PA','N216990W','2026-12-31','Confirm name; this is a vehicle label, not a driver assignment.'],
 ['Sils','N216986W','2026-11-30','Confirm handwritten name.'],
 ['ZoZ','N1279265W','2027-08-31','Registration is unclear (appears to have seven digits). Check against the photo before confirming.'],
 ['Kesh','N116599W','2026-09-30','Confirm name and registration; expiry appears to be 30-09-26.'],
 ['Ranger','N132794W','2026-11-30',''],['Tie','N115230W','2026-11-30','Confirm handwritten name.'],
 ['D. Cab','N187553W','2026-11-30','Confirm handwritten name and registration.'],['Plaas','N69730W','2026-11-30',''],['Polo','N48209W','2027-05-31','']
])row(name==='MAN'?'truck':'vehicle',name,reg,date,'','',note);
function assets(state,kind){return kind==='trailer'?(state.trailers||[]):(state.trucks||[])}
function initial(state){return{id:ID,status:'pending',revision:0,rows:seed.map(r=>({...r,targetId:assets(state,r.kind).find(a=>key(a.registration)===key(r.registration))?.id||''}))}}
function current(state){return state.whiteboardReviews?.[ID]||initial(state)}
function validate(rows,state){
 if(!Array.isArray(rows)||rows.length!==seed.length)throw Error('Review must contain every original whiteboard row; untick items you do not want.');
 const seen=new Set(),plates=new Set(),targets=new Set();
 return rows.map(r=>{
  if(!seed.some(x=>x.id===r.id)||seen.has(r.id))throw Error('Invalid or duplicate whiteboard row');seen.add(r.id);
  const x={};for(const f of ['id','kind','name','registration','expiry','personal','border','personalType','targetId','note'])x[f]=String(r[f]||'').trim().slice(0,f==='note'?1000:150);x.include=r.include===true;
  if(!['truck','vehicle','trailer'].includes(x.kind))throw Error('Select truck, other vehicle or trailer');
  if(!x.include)return x;
  if(!x.name||!key(x.registration))throw Error('Enter a name and registration for every checked item');
  if(!/^N\d{1,7}[A-Z]{1,3}$/.test(key(x.registration)))throw Error('Check registration for '+x.name);
  if(plates.has(key(x.registration)))throw Error('Duplicate registration: '+x.registration);plates.add(key(x.registration));
  if(x.targetId&&!assets(state,x.kind).some(a=>a.id===x.targetId))throw Error('Selected destination no longer exists for '+x.name);
  if(x.targetId&&targets.has(x.targetId))throw Error('Two rows target the same vehicle');if(x.targetId)targets.add(x.targetId);
  for(const f of ['expiry','personal','border'])if(x[f]){const d=new Date(x[f]+'T12:00:00Z');if(!/^20\d{2}-\d{2}-\d{2}$/.test(x[f])||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==x[f])throw Error('Invalid date for '+x.name)}
  if(x.personal&&!x.personalType)throw Error('Confirm the personal document type for '+x.name);
  return x;
 });
}
function apply(state,rows,receiptId,actor){
 const review=current(state);if(review.status==='approved')return{duplicate:true,...review.result};
 const checked=validate(rows,state).filter(r=>r.include);if(!checked.length)throw Error('Select at least one item to apply');
 state.trucks??=[];state.trailers??=[];state.permits??=[];
 const result={created:0,updated:0,permits:0,items:[]};
 for(const r of checked){
  const collection=assets(state,r.kind),matched=r.targetId?collection.find(x=>x.id===r.targetId):collection.find(x=>key(x.registration)===key(r.registration));
  const opposite=assets(state,r.kind==='trailer'?'truck':'trailer').find(x=>key(x.registration)===key(r.registration));if(opposite)throw Error(r.registration+' already exists under another category. Change its destination before approval.');
  let asset=matched;if(!asset){asset={id:'asset_'+ID+'_'+r.id,registration:r.registration,type:r.kind==='trailer'?'Trailer':r.kind==='truck'?'Truck':'Other',status:'Available',odometer:0,licenseExpiry:'',roadworthyExpiry:''};collection.push(asset);result.created++}else result.updated++;
  asset.registration=r.registration;if(r.kind==='trailer')asset.name=r.name;else asset.fleetName=r.name;
  asset.whiteboardSourceReceiptId=receiptId;asset.whiteboardSourceUrl='/api/admin/whiteboard/source';
  if(r.expiry)asset.licenseExpiry=r.expiry;
  const ownerType=r.kind==='trailer'?'trailer':'truck',destinations=[];
  for(const [suffix,type,expiry] of [['vehicle','Vehicle licence',r.expiry],['personal',r.personalType||'Personal permit',r.personal],['border','Cross-border permit',r.border]]){
   if(!expiry)continue;
   // Keep personal documents out of the app's broad vehicle-licence matcher.
   const safeType=suffix==='personal'?'Personal permit':type;
   let p=state.permits.find(x=>x.id===ID+'_'+r.id+'_'+suffix)||state.permits.find(x=>x.ownerId===asset.id&&x.ownerType===ownerType&&x.type===safeType);
   if(!p){p={id:ID+'_'+r.id+'_'+suffix,ownerType,ownerId:asset.id};state.permits.push(p)}
   Object.assign(p,{type:safeType,reference:r.registration,expiry,status:expiry<new Date().toISOString().slice(0,10)?'Expired':'Active',sourceReceiptId:receiptId,sourceUrl:'/api/admin/whiteboard/source',sourceImportId:ID,notes:[suffix==='personal'?'Whiteboard label: Personal licence. Confirmed document description: '+r.personalType:'Whiteboard expiry confirmed by '+actor,r.note].filter(Boolean).join(' · ')});result.permits++;destinations.push(safeType+' → Documents & Permits');
  }
  result.items.push({registration:r.registration,name:r.name,assetId:asset.id,destination:r.kind==='trailer'?'Fleet → Trailers':'Fleet → Vehicles',documents:destinations});
 }
 state.recordDeletionVersion='whiteboard-approved-'+ID;
 state.whiteboardReviews??={};state.whiteboardReviews[ID]={id:ID,status:'approved',revision:review.revision+1,rows,approvedAt:new Date().toISOString(),approvedBy:actor,sourceReceiptId:receiptId,result};
 return result;
}
module.exports={ID,seed,current,validate,apply};
