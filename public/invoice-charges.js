(function(root){
'use strict';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const fail=m=>{const e=Error(m);e.status=400;throw e};
function valid(v,label){const n=Number(v);if(!Number.isFinite(n)||n<0)fail('Invalid '+label);return n}
function legKm(state,t,leg){const r=(state.routes||[]).find(x=>x.id===(leg.routeId||t.routeId))||{};if(r.mdcRule==='Not applicable')return 0;const distance=Number(leg.distance)||Number(r.distance)||0;return Math.max(0,r.crossBorder?(Number(leg.namibiaKm)||Number(r.namibiaKm)||0):(Number(leg.namibiaKm)||distance))}
function calculate(state,inv,options={}){
 const c=(state.clients||[]).find(x=>x.id===inv.clientId)||{};
 if(options.newInvoice){inv.chargesVersion=1;inv.transportSubtotal=Number(inv.amount||0);inv.vatRate=c.vatRate===undefined?15:valid(c.vatRate,'VAT rate');inv.includeMdc=true}
 if(options.vatRate!==undefined){const rate=valid(options.vatRate,'VAT rate');if(![0,15].includes(rate))fail('Choose 15% VAT or no VAT');inv.vatRate=rate;inv.chargesVersion=1}
 if(options.includeMdc!==undefined){if(![true,false,'true','false'].includes(options.includeMdc))fail('Invalid MDC setting');inv.includeMdc=options.includeMdc===true||options.includeMdc==='true';inv.chargesVersion=1}
 if(!inv.chargesVersion)return inv;
 if(inv.vatRate===undefined)inv.vatRate=0;
 const base=inv.lines?.length?inv.lines.reduce((a,l)=>a+valid(l.amount||0,'transport amount'),0):valid(inv.transportSubtotal??inv.amount??0,'transport amount');
 const seen=new Set(),mdcLines=[];
 const lines=inv.lines?.length?inv.lines:[{tripId:inv.tripId,legId:inv.legId}];
 if(inv.includeMdc)for(const line of lines){
  const t=(state.trips||[]).find(x=>x.id===line.tripId);if(!t)continue;
  const legs=t.legs?.length?t.legs:[t];const selected=line.legId?legs.filter(l=>l.id===line.legId):legs;
  const expense=(state.expenses||[]).find(x=>x.tripId===t.id&&(x.mdc===true||/mass distance charge/i.test(String(x.category||''))));
  const rate=valid(expense?.mdcRatePer100km??state.settings?.mdcRatePer100km??73.30,'MDC rate');
  for(const leg of selected){const key=t.id+':'+(leg.id||'trip');if(seen.has(key))continue;seen.add(key);const km=legKm(state,t,leg);if(km>0)mdcLines.push({tripId:t.id,legId:leg===t?'':leg.id||'',tripNumber:t.number||t.id,namibiaKm:km,ratePer100km:rate,amount:round(km/100*rate)})}
 }
 inv.transportSubtotal=round(base);inv.mdcLines=mdcLines;inv.mdcAmount=round(mdcLines.reduce((a,l)=>a+l.amount,0));inv.subtotal=round(base+inv.mdcAmount);inv.vatAmount=round(inv.subtotal*valid(inv.vatRate,'VAT rate')/100);inv.amount=round(inv.subtotal+inv.vatAmount);return inv;
}
const api={calculate,legKm};if(typeof module==='object'&&module.exports)module.exports=api;else root.InvoiceCharges=api;
})(typeof globalThis!=='undefined'?globalThis:this);
