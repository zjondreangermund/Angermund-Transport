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
  function fuelSummary(state,selection){
    const number=v=>Number.isFinite(Number(v))?Number(v):0;
    const cost=x=>number(x.printedTotal)||number(x.total)||number(x.litres)*number(x.price);
    const fuel=rows(state,'diesel',selection),litres=fuel.reduce((a,x)=>a+Math.max(0,number(x.litres)),0),spend=fuel.reduce((a,x)=>a+cost(x),0);
    let distance=0,matchedLitres=0,matchedSpend=0,matchedTrips=0,excludedTrips=0;
    for(const t of rows(state,'trips',selection)){
      const done=number(t.stage)>=4||/^(delivered|invoiced|closed|completed)$/i.test(String(t.status||''));
      const entries=(state.diesel||[]).filter(x=>x.tripId===t.id),litres=entries.reduce((a,x)=>a+Math.max(0,number(x.litres)),0),km=number(t.startKm)>0&&number(t.endKm)>number(t.startKm)?number(t.endKm)-number(t.startKm):0;
      if(!done||!km||!litres){excludedTrips++;continue}
      distance+=km;matchedLitres+=litres;matchedSpend+=entries.reduce((a,x)=>a+cost(x),0);matchedTrips++;
    }
    const ready=distance>0&&matchedLitres>0;
    return{litres,spend,pricePerL:litres>0?spend/litres:null,distance,matchedLitres,matchedTrips,excludedTrips,kmPerL:ready?distance/matchedLitres:null,litresPerKm:ready?matchedLitres/distance:null,litresPer100Km:ready?matchedLitres/distance*100:null,costPerKm:ready?matchedSpend/distance:null};
  }
  const api={normalize,truckIds,rowDate,matches,rows,fuelSummary};if(typeof module==='object'&&module.exports)module.exports=api;else root.RecordFilters=api;
})(typeof globalThis!=='undefined'?globalThis:this);
