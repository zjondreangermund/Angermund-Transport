'use strict';
const compact=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const token=(text,value)=>{const pattern=String(value||'').trim().split(/[\s-]+/).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s-]*');return !!pattern&&new RegExp('(^|[^a-z0-9])'+pattern+'(?=$|[^a-z0-9])','i').test(text)};
function resolve(s,input,purpose='open'){
 const q=String(input||'').trim(),date=/\b(20\d{2}-\d{2}-\d{2})\b/.exec(q)?.[1],trips=s.trips||[];
 const direct=trips.filter(t=>t.id===q||t.number&&token(q,t.number));
 if(direct.length>1)throw Error('More than one load reference matched. Give the truck number and date for one load.');
 if(direct.length===1){if(['invoice','pod'].includes(purpose)&&(s.trucks||[]).some(t=>t.id!==direct[0].truckId&&t.fleetName&&token(q,t.fleetName)))throw Error('The truck number and load reference do not match. Confirm which truck should receive this document/invoice.');if(date&&!String(direct[0].date||'').startsWith(date))throw Error('That load reference does not match the requested date.');return direct[0];}
 const trucks=(s.trucks||[]).filter(t=>{
  const fleet=String(t.fleetName||''),n=/^ang[\s-]*(\d+)$/i.exec(fleet);
  return t.id===q||token(q,fleet)||t.registration&&token(q,t.registration)||n&&(new RegExp('\\bang[\\s-]*0*'+Number(n[1])+'\\b','i').test(q)||new RegExp('^(?:truck\\s*(?:(?:nr|no|number)[. ]*)?)?0*'+Number(n[1])+'$','i').test(q))||compact(fleet)&&compact(q.replace(/^(?:truck|trip)\s+/i,''))===compact(fleet);
 });
 if(trucks.length!==1)throw Error(trucks.length?'More than one truck was mentioned. Choose one truck number.':'Use your truck number, for example ANG 12, to find its trip; add the load date if needed.');
 const truck=trucks[0];let found=trips.filter(t=>t.truckId===truck.id&&!/cancelled/i.test(t.status||'')&&(!date||String(t.date||'').startsWith(date)));
 if(purpose==='invoice')found=found.filter(t=>(t.legs?.length?t.legs:[t]).some(l=>!l.invoiceId&&(l.pod||t.pod||Number(t.stage)>=4)));
 else if(purpose==='pod')found=found.filter(t=>Number(t.stage||1)<5&&(t.legs?.length?t.legs:[t]).some(l=>!l.pod));
 else if(!date)found=found.filter(t=>Number(t.stage||1)<5&&!/closed|completed|invoiced/i.test(t.status||''));
 if(found.length===1)return found[0];
 const choices=found.slice(0,5).map(t=>{const route=(s.routes||[]).find(r=>r.id===t.routeId);return [t.date,route?.name||t.load,t.status].filter(Boolean).join(' · ')}).join('; ');
 throw Error(found.length?'More than one load matches '+truck.fleetName+'. Specify its date/load: '+choices:'No matching '+(purpose==='invoice'?'unbilled delivered load':purpose==='pod'?'load needing a POD':'open load')+' found for '+truck.fleetName+(date?' on '+date:'')+'. Give the load date to check its history.');
}
module.exports={resolve};
