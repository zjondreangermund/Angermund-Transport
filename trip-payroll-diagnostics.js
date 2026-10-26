'use strict';
const Link=require('./payroll-trip-link');
const Metrics=require('./public/trip-metrics');
const normalize=x=>String(x||'').toLowerCase();
function inspect(state,period='2026-10'){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Invalid payroll month');
 const start=period+'-01',end=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),1)).toISOString().slice(0,10);
 const employees=(state.employees?.length?state.employees:state.drivers||[]).filter(e=>e.active!==false&&e.status!=='Inactive');
 const payroll=employees.map(e=>{
  const isDriver=require('./public/payroll-eligibility').isDriver(e,state.drivers||[]);
  const d=isDriver?Link.resolveDriver(state,e):null;
  const assignments=d?(state.trips||[]).filter(t=>String(t.driverId)===String(d.id)&&String(t.date||'').slice(0,10)>=start&&String(t.date||'').slice(0,10)<end):[];
  const eligible=Link.eligibleTrips(state,d,start,end);
  const row=(state.payroll||[]).find(p=>p.employeeId===e.id&&p.period===period);
  return{employeeId:e.id,employee:e.name||'',isDriver,matchedDriver:d?.name||null,driverId:d?.id||null,payslipStatus:row?.status||null,payslipKm:row?.tripKm??null,payslipTripPay:row?.tripPay??null,eligibleTrips:eligible.map(t=>({id:t.id,number:t.number||'',date:t.date,...Metrics.distance(t,(state.diesel||[]).filter(x=>x.tripId===t.id))})),excludedTrips:assignments.filter(t=>!eligible.includes(t)).map(t=>({id:t.id,number:t.number||'',date:t.date,status:t.status||'',stage:t.stage||0,reason:'Trip not yet delivered/completed or cancelled'})),missingDistance:eligible.filter(t=>Metrics.distance(t,(state.diesel||[]).filter(x=>x.tripId===t.id)).distance<=0).map(t=>t.number||t.id),partialDistances:eligible.filter(t=>Metrics.distance(t,(state.diesel||[]).filter(x=>x.tripId===t.id)).partial).map(t=>t.number||t.id),issue:!isDriver?'Employee not classified as a driver':!d?'No unique linked driver record':!assignments.length?'No trips assigned to this driver in the period':!eligible.length?'Assigned trips are not completed':eligible.every(t=>Metrics.distance(t,(state.diesel||[]).filter(x=>x.tripId===t.id)).distance<=0)?'Eligible trips lack recorded kilometres':row?.status==='Approved'||row?.status==='Paid'?'Approved/Paid payslip is locked':row?.tripKm===0?'Draft payslip requires refresh':null};
 });
 const matches=(state.trips||[]).filter(t=>[t,...(t.legs||[])].some(x=>/charcoal|furniture/i.test([x.load,x.label,x.notes].join(' '))));
 const manual=(state.trips||[]).filter(t=>t.source==='manual'||/^AT-\d+$/i.test(t.number||'')&&!t.externalTmsId);
 const describe=t=>({id:t.id,number:t.number||'',date:t.date||'',status:t.status||'',stage:t.stage||0,source:t.source||'',truck:(state.trucks||[]).find(x=>x.id===t.truckId)?.fleetName||'',driver:(state.drivers||[]).find(x=>x.id===t.driverId)?.name||'',loads:[t,...(t.legs||[])].map(x=>x.load).filter(Boolean),distance:Metrics.distance(t).distance});
 return{period,tripsTotal:(state.trips||[]).length,manualTrips:manual.map(describe).slice(0,100),cargoMatches:matches.map(describe).slice(0,100),payroll,notice:'Live app_state only; backup tables not included. No data was modified.'};
}
module.exports={inspect};
