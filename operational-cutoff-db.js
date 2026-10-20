'use strict';
const crypto=require('crypto');
const {CUTOFF,VERSION,TRANSACTIONS,pruneOperationalHistory}=require('./operational-cutoff');
async function applyOperationalCutoff(pool){
 if(!pool)return {skipped:true,reason:'persistent database required'};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const original=(await c.query('SELECT payload FROM app_state WHERE id=1 FOR UPDATE')).rows[0]?.payload||{};
  if(original.operationalCutoffVersion===VERSION){await c.query('ROLLBACK');return{skipped:true,...original.operationalCutoffSummary}}
  await c.query('INSERT INTO app_state_backups(id,version,payload,note) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),VERSION,original,'Owner confirmed: remove transactions before 2026-09-20; preserve newer records and master data']);
  const state=structuredClone(original),result=pruneOperationalHistory(state,{initial:true});
  const tripIds=(result.removed.trips||[]).map(x=>x.id),removedIds=result.removedIds;
  const protectedIds=new Set();
  function collect(x){if(!x||typeof x!=='object')return;for(const [k,v] of Object.entries(x)){if(/(?:receipt|upload|document).*ids?$/i.test(k)){for(const id of Array.isArray(v)?v:[v])if(typeof id==='string'&&id)protectedIds.add(id)}if(v&&typeof v==='object')collect(v)}}
  collect(state);
  await c.query('CREATE TABLE IF NOT EXISTS ops_reset_aux_backups(version text NOT NULL,table_name text NOT NULL,payload jsonb NOT NULL,created_at timestamptz DEFAULT now(),PRIMARY KEY(version,table_name))');
  const aux={};
  async function move(table,where,params){
   const found=await c.query(`WITH removed AS (DELETE FROM ${table} WHERE ${where} RETURNING *) INSERT INTO ops_reset_aux_backups(version,table_name,payload) SELECT $1,$2,COALESCE(jsonb_agg(to_jsonb(removed)),'[]'::jsonb) FROM removed RETURNING jsonb_array_length(payload) AS count`,[VERSION,table,...params]);
   aux[table]=Number(found.rows[0].count);
  }
  for(const table of ['driver_uploads','trip_documents'])await move(table,"(trip_id=ANY($3::text[]) OR created_at < $4::timestamptz) AND NOT(id::text=ANY($5::text[]))",[tripIds,CUTOFF+'T00:00:00+02:00',[...protectedIds]]);
  await move('company_receipts',"linked_type NOT IN ('truck','trailer','driver','company','insurance','insurance-policy') AND (linked_id=ANY($3::text[]) OR created_at<$4::timestamptz) AND NOT(id::text=ANY($5::text[]))",[removedIds,CUTOFF+'T00:00:00+02:00',[...protectedIds]]);
  await move('scan_jobs',"COALESCE(NULLIF(extracted->>'date',''),to_char(created_at AT TIME ZONE 'Africa/Windhoek','YYYY-MM-DD')) < $3",[CUTOFF]);
  await move('gps_positions','trip_id=ANY($3::text[]) OR recorded_at<$4::timestamptz',[tripIds,CUTOFF+'T00:00:00+02:00']);
  await move('notifications',"linked_id=ANY($3::text[]) OR created_at<$4::timestamptz OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(details,'[]'::jsonb)) d WHERE d->>'linkedId'=ANY($3::text[]))",[removedIds,CUTOFF+'T00:00:00+02:00']);
  await move('operational_notification_outbox',"EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(payload->'items',jsonb_build_array(payload))) d WHERE d->>'linkedId'=ANY($3::text[])) OR created_at<$4::timestamptz",[removedIds,CUTOFF+'T00:00:00+02:00']);
  // Verify preserved master data byte-for-byte before committing.
  for(const key of ['trucks','trailers','drivers','clients','routes','settings','permits','insurancePolicies','companyAssets','quotes'])if(JSON.stringify(state[key])!==JSON.stringify(original[key]))throw Error('Cutoff unexpectedly changed master data: '+key);
  const summary={cutoff:CUTOFF,removed:result.counts,unknownDates:result.unknownDates,retained:Object.fromEntries(TRANSACTIONS.filter(k=>Array.isArray(state[k])).map(k=>[k,state[k].length])),auxRemoved:aux};
  state.operationalCutoffSummary=summary;
  state.audit??=[];state.audit.unshift({id:'cutoff_'+VERSION,at:new Date().toISOString(),actor:'Owner-authorized cleanup',action:'Removed transactions before '+CUTOFF+'; kept newer transactions and master data',linkedType:'system',linkedId:VERSION});
  await c.query('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1',[state]);
  await c.query('COMMIT');console.log('Operational date cutoff completed',JSON.stringify(summary));return summary;
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
module.exports={applyOperationalCutoff};
