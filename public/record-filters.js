(function(root){
  'use strict';
  function normalize(value={}){const year=/^\d{4}$/.test(String(value.year))?String(value.year):'',month=/^(0[1-9]|1[0-2])$/.test(String(value.month))?String(value.month):'';return{truckId:String(value.truckId||''),year,month:year?month:''}}
  function truckIds(row,state){
    const ids=new Set();if(row.truckId)ids.add(row.truckId);
    const tripIds=new Set([row.tripId,...(row.tripIds||[]),...(row.lines||[]).map(x=>x.tripId)].filter(Boolean));
    if(row.linkedType==='trip'&&row.linkedId)tripIds.add(row.linkedId);
    if(row.linkedType==='truck'&&row.linkedId)ids.add(row.linkedId);
    for(const t of state.trips||[])if(tripIds.has(t.id)&&t.truckId)ids.add(t.truckId);
    for(const line of row.lines||[])if(line.truckId)ids.add(line.truckId);
    return ids;
  }
  function rowDate(row,state){const trip=(state.trips||[]).find(t=>t.id===row.tripId);return String(row.date||row.period||row.createdAt||row.created_at||trip?.date||'').slice(0,10)}
  function matches(row,state,selection,{master=false}={}){const f=normalize(selection);if(f.truckId&&!truckIds(row,state).has(f.truckId))return false;if(master||!f.year)return true;const date=rowDate(row,state);return date.startsWith(f.year+'-')&&(!f.month||date.slice(5,7)===f.month)}
  function rows(state,key,selection){return(state[key]||[]).filter(row=>matches(row,state,selection))}
  const api={normalize,truckIds,rowDate,matches,rows};if(typeof module==='object'&&module.exports)module.exports=api;else root.RecordFilters=api;
})(typeof globalThis!=='undefined'?globalThis:this);
