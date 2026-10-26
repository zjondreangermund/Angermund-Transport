(function(root){
'use strict';
function isDriver(employee,drivers=[]){
 if(!employee)return false;
 const title=String(employee.jobTitle||employee.title||employee.role||'').trim().toLowerCase(),category=String(employee.category||'').trim().toLowerCase();
 const driverTitle=/\bdriver\b/.test(title)&&! /\b(non[- ]?driver|assistant|helper)\b/.test(title);
 if(driverTitle||category==='driver'||category==='drivers')return true;
 // An explicitly non-driving job cannot become a driver merely through a
 // matching name. Generic workforce imports can have IDs different to drivers.
 if(title&&!['employee','staff',''].includes(title))return false;
 if(category&&!['employee','staff',''].includes(category))return false;
 const linkedIds=[employee.driverId,employee.driver_id,employee.linkedDriverId,employee.id].filter(Boolean).map(String);
 if(drivers.some(d=>linkedIds.includes(String(d.id))))return true;
 const key=x=>String(x||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ');
 const name=key(employee.name||[employee.firstName,employee.lastName].filter(Boolean).join(' '));
 return Boolean(name&&drivers.filter(d=>key(d.name)===name).length===1);
}
const api={isDriver};if(typeof module==='object'&&module.exports)module.exports=api;else root.PayrollEligibility=api;
})(typeof globalThis!=='undefined'?globalThis:this);
