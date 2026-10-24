'use strict';
const crypto=require('node:crypto');
const Trip=require('./assistant-trip-actions');
const key=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
const perms={
 task_update:['admin','manager','dispatcher'],
 trip_note:['admin','manager','dispatcher'],
 trip_reference:['admin','manager','dispatcher','finance']
};
const can=(role,kind)=>(perms[kind]||[]).includes(role);
function kind(text){
 const q=String(text||'');
 if(/\b(?:mark|set|move|change|update|assign)\b/i.test(q)&&/\btask\b/i.test(q))return'task_update';
 if(/\b(?:add|append|record)\b/i.test(q)&&/\bnote\b/i.test(q)&&/\b(?:trip|truck)\b/i.test(q))return'trip_note';
 if(/\b(?:set|change|update|add)\b/i.test(q)&&/\b(?:order|customer|source)\s+(?:reference|ref)\b/i.test(q)&&/\b(?:trip|truck)\b/i.test(q))return'trip_reference';
 return null;
}
function fail(s){return{error:s}}
function trip(s,q){try{return{row:require('./assistant-trip-resolver').resolve(s,q)}}catch(e){return{error:e.message}}}

function task(s,q){
 const quoted=/"([^"]{3,180})"/.exec(q)?.[1];
 const xs=(s.tasks||[]).filter(t=>t.title&&(quoted?key(t.title)===key(quoted):(' '+key(q)+' ').includes(' '+key(t.title)+' ')));
 return xs.length===1?{row:xs[0]}:{error:xs.length?'Multiple tasks match; specify the exact title in double quotes.':'Task not found. Put the exact task title in double quotes.'};
}
function person(s,q){
 const xs=(s.drivers||[]).filter(d=>d.name&&!['Inactive','Terminated'].includes(d.status)&&
   (' '+key(q)+' ').includes(' '+key(d.name)+' '));
 const partial=xs.length?xs:(s.drivers||[]).filter(d=>d.name&&(' '+key(q)+' ').includes(' '+key(d.name.split(/\s+/)[0])+' '));
 return partial.length===1?{row:partial[0]}:{error:partial.length?'Multiple drivers match; use a full name.':'Mention the exact driver name.'};
}
function iso(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
 const d=new Date(date+'T12:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date;
}
function plan(query,s){
 const q=String(query||'').trim(),k=kind(q);if(!k)return null;
 if(k==='task_update'){
  const t=task(s,q);if(t.error)return t;
  const item=t.row;if(['Completed','Cancelled'].includes(item.status))return fail('That task is completed/cancelled. Open Tasks to reopen it.');
  let field,value;
  if(/\b(?:in progress|in-progress|started|working on)\b/i.test(q)){field='status';value='In progress';}
  else if(/\b(?:completed|complete|done|finished)\b/i.test(q))return fail('Completing a task may require proof or an expense receipt. Open Tasks to complete it with the required evidence.');
  else if(/\b(?:priority)\b/i.test(q)){
   const match=/\b(critical|high|normal|low)\b/i.exec(q);
   if(!match)return fail('Choose Low, Normal, High or Critical priority.');
   field='priority';value=match[1][0].toUpperCase()+match[1].slice(1).toLowerCase();
  }else if(/\b(?:due|deadline)\b/i.test(q)){
   const date=/\b(20\d{2}-\d{2}-\d{2})\b/.exec(q)?.[1];
   if(!date||!iso(date))return fail('Give a valid task due date: YYYY-MM-DD.');
   field='due';value=date;
  }else if(/\bassign\b/i.test(q)){
   const d=person(s,q);if(d.error)return d;field='assignedDriverId';value=d.row.id;
  }else return fail('Try: Mark task "TITLE" in progress, Set task "TITLE" priority to High, Set task "TITLE" due 2026-11-02, or Assign task "TITLE" to driver NAME.');
  const old=field==='assignedDriverId'?(s.drivers||[]).find(d=>d.id===item.assignedDriverId)?.name||'Unassigned':String(item[field]||'Not set');
  const next=field==='assignedDriverId'?(s.drivers||[]).find(d=>d.id===value)?.name:value;
  if(old===next)return fail('Task already has that setting.');
  return{kind:k,entityId:item.id,old,next,field,value,description:'Update task: '+item.title,page:'tasks',
   expected:{updatedAt:item.updatedAt||'',status:item.status,fieldValue:item[field]||''},
   lines:[['Task',item.title],['Change',field],['Before',old],['After',next]],
   warning:'Task changes are saved after approval. Completing tasks and attaching receipts still use the existing proof workflow.'};
 }
 const found=trip(s,q);if(found.error)return found;const t=found.row;
 if(k==='trip_note'){
  const match=/\b(?:add|append|record)\s+(?:a\s+)?note\s+(?:to|for)\s+(?:trip|truck)\s+[^:]+:\s*(.+)$/i.exec(q);
  if(!match)return fail('Use: Add note to truck ANG 12: Driver expects arrival at 14:00.');
  const note=match[1].trim();
  if(note.length<4||note.length>400)return fail('Trip note must be between 4 and 400 characters.');
  const old=String(t.notes||'');
  if(old.length+note.length>1600)return fail('Trip notes are full. Edit the existing notes from the trip details.');
  return{kind:k,tripId:t.id,tripNumber:t.number,old:old.slice(-170)||'No notes',
   next:note,value:note,description:'Append note to '+t.number,page:'trips',
   expected:{number:t.number,updatedAt:t.updatedAt||'',oldNotes:old},
   lines:[['Trip',t.number],['Note to add',note]],
   warning:'This appends to internal trip notes; it does not send an NBL/customer update.'};
 }
 if(k==='trip_reference'){
  const m=/\b(?:to|as|:)\s*([A-Za-z0-9][A-Za-z0-9._/-]{1,99})\s*$/i.exec(q);
  if(!m)return fail('Use: Set order reference for truck ANG 12 to YOUR-ORDER-REF.');
  const value=m[1].trim();if(!/^[a-zA-Z0-9][A-Za-z0-9._/-]{1,99}$/.test(value))return fail('Invalid order reference.');
  const old=String(t.sourceOrderRef||'');
  if(key(old)===key(value))return fail('Trip already has that order reference.');
  return{kind:k,tripId:t.id,tripNumber:t.number,old:old||'Not set',next:value,value,description:'Update order reference for '+t.number,page:'trips',
   expected:{number:t.number,updatedAt:t.updatedAt||'',oldRef:old},
   lines:[['Trip',t.number],['Order reference before',old||'Not set'],['New reference',value]],
   warning:'Changes the internal trip order reference, not an external NBL system or already-issued invoice.'};
 }
 return null;
}
function reject(message){const e=Error(message);e.status=409;throw e}
function apply(s,p,actor='Staff approval',now=new Date().toISOString()){
 if(!p||!can(p.actorRole,p.kind))reject('Your role cannot perform this operation.');
 let result={},linkType,linkId;
 if(p.kind==='task_update'){
  const t=(s.tasks||[]).find(t=>t.id===p.entityId);
  if(!t||String(t.updatedAt||'')!==p.expected.updatedAt||t.status!==p.expected.status||
     String(t[p.field]||'')!==String(p.expected.fieldValue))reject('Task changed after preview. Request a new one.');
  if(!['status','priority','due','assignedDriverId'].includes(p.field))reject('Unknown task field.');
  if(p.field==='status'&&(p.value!=='In progress'||!['Open','In progress'].includes(t.status)))reject('Invalid task status');
  if(p.field==='priority'&&!['Low','Normal','High','Critical'].includes(p.value))reject('Invalid task priority');
  if(p.field==='due'&&!iso(p.value))reject('Invalid task due date');
  if(p.field==='assignedDriverId'&&!(s.drivers||[]).some(d=>d.id===p.value))reject('Driver not available.');
  t[p.field]=p.value;
  if(p.field==='assignedDriverId'){t.assignedUserId='';t.ownerRole='Driver';}
  t.updatedAt=now;linkType='task';linkId=t.id;result={entityId:t.id,recordType:'task'};
 }else if(p.kind==='trip_note'||p.kind==='trip_reference'){
  const t=(s.trips||[]).find(t=>t.id===p.tripId);
  if(!t||t.number!==p.expected.number||String(t.updatedAt||'')!==p.expected.updatedAt)reject('Trip changed after preview.');
  if(p.kind==='trip_note'){
   if(String(t.notes||'')!==p.expected.oldNotes)reject('Trip notes changed; ask again.');
   t.notes=(String(t.notes||'')?String(t.notes).trimEnd()+'\n':'')+'['+now.slice(0,16)+' · '+actor+'] '+p.value;
  }else{
   if(String(t.sourceOrderRef||'')!==p.expected.oldRef)reject('Order reference changed; ask again.');
   if(!/^[a-zA-Z0-9][A-Za-z0-9._/-]{1,99}$/.test(p.value))reject('Invalid order reference');
   t.sourceOrderRef=p.value;t.loadEditedAt=now;
  }
  t.updatedAt=now;t.updatedBy=actor;linkType='trip';linkId=t.id;
  result={tripId:t.id,entityId:t.id,recordType:'trip'};
 }else reject('Unsupported action');
 s.audit??=[];
 s.audit.unshift({id:'log_'+crypto.randomUUID(),at:now,actor,action:'Assistant-approved: '+p.description,linkedType:linkType,linkedId:linkId});
 s.audit=s.audit.slice(0,100);
 return result;
}
module.exports={kind,plan,apply,can,iso};
