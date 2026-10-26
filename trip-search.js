'use strict';
const norm=v=>String(v??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\bang[\s-]*0*(\d+)\b/g,'ang$1').replace(/[^a-z0-9]+/g,' ').trim();
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function terms(input){
 let q=norm(input),date=null;
 const iso=/\b(20\d{2}) (\d{2}) (\d{2})\b/.exec(q),named=/\b(\d{1,2}) (january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?: (20\d{2}))?\b/.exec(q),numeric=/\b(\d{1,2}) (\d{1,2}) (20\d{2})\b/.exec(q);
 const m=iso||named||numeric;
 if(m){date=iso?{year:m[1],month:m[2],day:m[3]}:named?{year:m[3]||'',month:String(months.indexOf(m[2].slice(0,3))+1).padStart(2,'0'),day:m[1].padStart(2,'0')}:{year:m[3],month:m[2].padStart(2,'0'),day:m[1].padStart(2,'0')};q=q.replace(m[0],' ');}
 q=q.replace(/\b(?:can|could|would|you|please|i|im|am|looking|look|for|where|is|are|was|were|my|our|the|a|an|me|show|find|search|list|view|open|locate|pull|up|trip|trips|journey|journeys|load|loads|truck|trucks|number|nr|no|on|from|to|with|by|of|in|that|which|went|entered|added|manually)\b/g,' ');
 return{date,manual:/\bmanual(?:ly)?\b/i.test(input),tokens:q.split(/\s+/).filter(Boolean).filter(x=>x!=='manual')};
}
function isQuery(q){return !/\b(?:delete|remove|edit|change|update|create|add|assign|attach|record|generate|invoice|cancel|start|stop)\b/i.test(q)&&/\b(?:show|find|search|list|view|locate|looking|where|look\s+for|pull\s+up)\b/i.test(q)&&/\b(?:trips?|journeys?|loads?|truck|ang[\s-]*\d+)\b/i.test(q);}
function manual(t){return t.source==='manual'||Boolean(t.createdBy&&!t.externalTmsId&&!t.sourceTmsId&&!t.sourceWorkbook&&!t.importedAt)||/^AT-\d+$/i.test(t.number||'')&&!t.externalTmsId;}
function find(state,input){
 const q=terms(input),get=(key,id)=>(state[key]||[]).find(x=>x.id===id)||{};
 return(state.trips||[]).filter(t=>{
  if(q.manual&&!manual(t))return false;
  const dates=[t.date,t.plannedDropDate,...(t.legs||[]).flatMap(l=>[l.date,l.plannedDropDate])].map(x=>String(x||'').slice(0,10));
  if(q.date&&!dates.some(d=>d.slice(5,7)===q.date.month&&d.slice(8,10)===q.date.day&&(!q.date.year||d.slice(0,4)===q.date.year)))return false;
  const truck=get('trucks',t.truckId),driver=get('drivers',t.driverId);
  const related=[t,...(t.legs||[])].flatMap(l=>[l.number,l.load,l.label,l.notes,get('routes',l.routeId).name,get('clients',l.clientId).name]);
  const c=t.carrierDetails||{},text=norm([t.id,t.number,t.externalTmsId,t.sourceTmsId,t.sourceOrderRef,t.date,t.status,t.notes,truck.fleetName,truck.registration,driver.name,c.orderRef,c.origin?.name,c.destination?.name,...related].join(' '));
  return q.tokens.every(token=>/^ang\d+$/.test(token)?text.split(' ').includes(token):text.includes(token));
 }).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(a.number||a.id).localeCompare(String(b.number||b.id)));
}
function reply(state,input){const all=find(state,input),rows=all.slice(0,20),get=(k,id)=>(state[k]||[]).find(x=>x.id===id)||{};
 const records=rows.map(t=>({id:t.id,kind:'trip',label:[get('trucks',t.truckId).fleetName,t.number,t.date].filter(Boolean).join(' · ')}));
 return{answer:all.length?all.length+' matching trip(s) across all saved dates and statuses'+(all.length>rows.length?' (showing the first '+rows.length+')':'')+':\n'+rows.map(t=>[get('trucks',t.truckId).fleetName,t.number,t.date,get('drivers',t.driverId).name,get('routes',t.routeId).name,t.load,t.status].filter(Boolean).join(' · ')).join('\n'):'No saved trips match that search. Try the truck number, driver, route or trip date. This search includes completed and manually entered trips.',records,page:'trips',source:'live-records'};}
module.exports={find,terms,isQuery,reply};
