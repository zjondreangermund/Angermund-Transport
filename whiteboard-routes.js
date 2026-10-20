'use strict';
const fs=require('fs'),path=require('path'),review=require('./whiteboard-review');
module.exports=function install(app,{auth,roles,readOpsState,mutateOpsState,storeCompanyReceipt}){
 const source=path.join(__dirname,'imports','whiteboard-2026-10-20.jpg'),access=[auth,roles('admin','manager')];
 app.get('/api/admin/whiteboard/source',...access,(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.sendFile(source)});
 app.get('/api/admin/whiteboard',...access,async(req,res)=>{try{const state=await readOpsState();res.json({...review.current(state),assets:{trucks:(state.trucks||[]).map(x=>({id:x.id,name:x.fleetName||x.registration,registration:x.registration,expiry:x.licenseExpiry||''})),trailers:(state.trailers||[]).map(x=>({id:x.id,name:x.name||x.registration,registration:x.registration,expiry:x.licenseExpiry||''}))},sourceUrl:'/api/admin/whiteboard/source'})}catch(e){res.status(500).json({error:e.message})}});
 async function change(req,res,approve){
  try{
   if(approve&&req.body.confirmed!==true)return res.status(400).json({error:'Review and confirm the handwritten values first'});
   const changed=await mutateOpsState(async state=>{
    const existing=review.current(state);
    if(existing.status==='approved'){if(approve)return{duplicate:true,...existing.result};throw Object.assign(Error('This upload was already approved'),{status:409})}
    if(Number(req.body.revision)!==existing.revision)throw Object.assign(Error('This review changed on another device. Refresh it before saving.'),{status:409});
    const rows=review.validate(req.body.rows,state);
    if(approve){
     if(!rows.some(r=>r.include))throw Error('Select at least one item');
     // Apply to a clone first so an invalid destination cannot leave partial edits.
     review.apply(structuredClone(state),rows,'preview',req.user.name||req.user.email||'Admin');
     const receipt=await storeCompanyReceipt({buffer:fs.readFileSync(source),mimetype:'image/jpeg',originalname:'Whiteboard_20_October_2026.jpg'},req.user,'fleet-document-import',review.ID,'whiteboard-source');
     return review.apply(state,rows,receipt.id,req.user.name||req.user.email||'Admin');
    }
    state.whiteboardReviews??={};state.whiteboardReviews[review.ID]={id:review.ID,status:'pending',revision:existing.revision+1,rows,savedAt:new Date().toISOString()};return state.whiteboardReviews[review.ID];
   });res.json(changed.result);
  }catch(e){res.status(e.status||400).json({error:e.message})}
 }
 app.put('/api/admin/whiteboard',...access,(req,res)=>change(req,res,false));
 app.post('/api/admin/whiteboard/approve',...access,(req,res)=>change(req,res,true));
};
