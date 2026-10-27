'use strict';
// A trip/load number is never a receipt identity. Multiple fills per trip are valid.
function reference(row){
 const value=String(row.slip||row.receiptNo||'').trim();
 if(!value||/^(?:workbook\b|n\/?a$|none$|unknown$|missing$|slip stored$)/i.test(value))return '';
 return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function uploads(row){return [...new Set([row.receiptUploadId,...(row.receiptUploadIds||[])].filter(Boolean))]}
function sameReceipt(a,b){
 const ref=reference(a);
 return Boolean(ref&&ref===reference(b))||uploads(a).some(id=>uploads(b).includes(id));
}
function conflict(row){const e=Error('Diesel slip '+(row.slip||row.receiptNo||'image')+' is already recorded. Open the existing entry to correct or move it; a second entry was not saved.');e.status=409;return e}
function assertNew(rows,row){const existing=rows.find(x=>x.id!==row.id&&sameReceipt(x,row));if(existing)throw conflict(existing)}
function assertChanges(before,after){
 const old=new Map(before.map(x=>[x.id,x]));
 for(let i=0;i<after.length;i++)for(let j=0;j<i;j++){
  const a=after[i],b=after[j];if(!sameReceipt(a,b))continue;
  // Existing duplicates must not prevent unrelated work or their removal.
  if(old.has(a.id)&&old.has(b.id)&&sameReceipt(old.get(a.id),old.get(b.id)))continue;
  throw conflict(b);
 }
}
function possibleDuplicate(a,b){
 if(sameReceipt(a,b))return true;
 // Without a receipt number this is only a review candidate, never auto-merged.
 if(reference(a)&&reference(b))return false;
 return Boolean(a.truckId&&a.truckId===b.truckId&&a.date&&a.date===b.date&&a.tripId===b.tripId&&Number(a.litres)>0&&Number(a.litres)===Number(b.litres)&&Number(a.price)>0&&Number(a.price)===Number(b.price)&&Number(a.odometer||0)===Number(b.odometer||0));
}
function pairs(rows){const result=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(possibleDuplicate(rows[i],rows[j]))result.push({keep:rows[j],duplicate:rows[i],reason:sameReceipt(rows[i],rows[j])?'Matching receipt number or image':'Matching fuel details — compare receipt images'});return result}
module.exports={reference,uploads,sameReceipt,assertNew,assertChanges,possibleDuplicate,pairs};
