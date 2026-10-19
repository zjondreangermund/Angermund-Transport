(function(root){
'use strict';
function isDriver(employee,drivers=[]){
 if(!employee)return false;
 const title=String(employee.jobTitle||employee.title||employee.role||'').trim().toLowerCase(),category=String(employee.category||'').trim().toLowerCase();
 const driverTitle=/\bdriver\b/.test(title)&&! /\b(non[- ]?driver|assistant|helper)\b/.test(title);
 if(title)return driverTitle;
 if(category)return category==='driver'||category==='drivers';
 return drivers.some(d=>d.id===employee.id);
}
const api={isDriver};if(typeof module==='object'&&module.exports)module.exports=api;else root.PayrollEligibility=api;
})(typeof globalThis!=='undefined'?globalThis:this);
