'use strict';
const Metrics=require('./public/trip-metrics'),Search=require('./trip-search');
function reply(message,s,role){
 if(!/\b(why|missing|not showing|not calculated|not worked out|explain|diagnose)\b/i.test(message)||!/\b(trips?|diesel|fuel|km|payslips?|payroll|POD)\b/i.test(message))return null;
 const payroll=/payslip|payroll/i.test(message);
 if(!(payroll?['admin','manager','finance']:['admin','manager','finance','dispatcher']).includes(role))return{answer:'Your account cannot access those records.',source:'record-permission'};
 const q=String(message),exact=(s.trips||[]).filter(t=>t.number&&q.toLowerCase().includes(t.number.toLowerCase())),truck=q.match(/\bang[\s-]*\d+\b/i)?.[0];
 const cargo=['charcoal','furniture'].filter(x=>q.toLowerCase().includes(x));
 let trips=exact.length?exact:truck?Search.find(s,truck):cargo.length?(s.trips||[]).filter(t=>cargo.some(c=>[t,...(t.legs||[])].some(l=>String(l.load||'').toLowerCase().includes(c)))):[];
 if(!exact.length&&!truck&&!cargo.length)return{answer:'Give the truck number, trip reference or cargo so I can check its saved distance, linked diesel, POD and payroll eligibility. For a payslip, include the month (YYYY-MM).',page:payroll?'payroll':'trips',source:'live-records'};
 const period=q.match(/\b20\d{2}-\d{2}\b/)?.[0];
 const lines=trips.slice(0,20).map(t=>{
  const m=Metrics.fuel(t,(s.diesel||[]).filter(x=>x.tripId===t.id)),driver=(s.drivers||[]).find(x=>x.id===t.driverId),fuel=m.ready?m.kmPerL.toFixed(2)+' km/L; '+m.litresPerKm.toFixed(3)+' L/km; N$ '+m.costPerKm.toFixed(2)+'/km ('+m.distanceSource+')':m.reason;
  const reasons=[];
  if(!t.driverId)reasons.push('No assigned driver');
  if(Number(t.stage||0)<3)reasons.push('Payroll excludes trips before stage 3');
  if(period&&String(t.date||'').slice(0,7)!==period)reasons.push('Trip date is outside '+period);
  const slips=(s.payroll||[]).filter(p=>p.employeeId===t.driverId&&(!period||p.period===period));
  if(payroll){if(!slips.length)reasons.push('No matching payslip saved for this driver/month');else for(const p of slips){const included=p.tripBreakdown?.some(x=>x.tripId===t.id);reasons.push('Payslip '+p.period+' ('+p.status+'): '+(included?'trip included':!Array.isArray(p.tripBreakdown)?'older payslip has no detail snapshot':'trip not in saved breakdown')+(['Approved','Paid'].includes(p.status)?'; refresh preserves this finalized payslip':'; refresh Draft after correcting source records'));}}
  return[t.number||t.id,(s.trucks||[]).find(x=>x.id===t.truckId)?.fleetName,t.date,driver?.name,t.status,'Fuel: '+fuel,'POD: '+((t.legs?.length?t.legs:[t]).every(l=>l.pod)?'received':'missing on one or more legs'),...reasons].filter(Boolean).join(' · ');
 });
 return{answer:lines.length?lines.join('\n')+'\nTrip lists may hide records through date, truck or completion filters. Search All trips. Payroll uses the assigned driver, trip date and stage 3 or later. Fuel figures describe linked purchases, not measured tank consumption.':'No matching trip is in the saved records available to me. I cannot confirm whether it was never saved or removed. Try its truck number/date or check the import preview.',page:payroll?'payroll':'trips',source:'live-records',records:trips.slice(0,20).map(t=>({id:t.id,kind:'trip',label:t.number||t.id}))};
}
module.exports={reply};
