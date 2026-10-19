(function(root){
'use strict';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const fail=m=>{const e=Error(m);e.status=400;throw e};
function valid(v,label){const n=Number(v);if(!Number.isFinite(n)||n<0)fail('Invalid '+label);return n}
function legKm(state,t,leg){const r=(state.routes||[]).find(x=>x.id===(leg.routeId||t.routeId))||{};if(r.mdcRule==='Not applicable')return 0;const distance=Number(leg.distance)||Number(r.distance)||0;return Math.max(0,r.crossBorder?(Number(leg.namibiaKm)||Number(r.namibiaKm)||0):(Number(leg.namibiaKm)||distance))}
function calculate(state,inv,options={}){
 const c=(state.clients||[]).find(x=>x.id===inv.clientId)||{};
 if(options.newInvoice){inv.chargesVersion=1;inv.transportSubtotal=Number(inv.amount||0);inv.vatRate=15;inv.vatMode='route';inv.includeMdc=true}
 if(options.vatRate==='auto'){inv.vatMode='route';inv.vatRate=15;inv.chargesVersion=1}
 else if(options.vatRate!==undefined){inv.vatMode='manual';const rate=valid(options.vatRate,'VAT rate');if(![0,15].includes(rate))fail('Choose 15% VAT or no VAT');inv.vatRate=rate;inv.chargesVersion=1}
 if(options.includeMdc!==undefined){if(![true,false,'true','false'].includes(options.includeMdc))fail('Invalid MDC setting');inv.includeMdc=options.includeMdc===true||options.includeMdc==='true';inv.chargesVersion=1}
 if(!inv.chargesVersion)return inv;
 if(inv.vatRate===undefined)inv.vatRate=0;
 const base=inv.lines?.length?inv.lines.reduce((a,l)=>a+valid(l.amount||0,'transport amount'),0):valid(inv.transportSubtotal??inv.amount??0,'transport amount');
 if(options.mdcOverrideKm!==undefined){inv.mdcOverrideKm=options.mdcOverrideKm===''||options.mdcOverrideKm===null?null:valid(options.mdcOverrideKm,'total Namibian kilometres')}
 if(options.mdcRatePer100km!==undefined&&options.mdcRatePer100km!=='')inv.mdcRatePer100km=valid(options.mdcRatePer100km,'MDC rate');
 const seen=new Set(),mdcLines=[],missing=[];
 const lineBorder=line=>{const t=(state.trips||[]).find(t=>t.id===line.tripId)||{},legs=t.legs?.length?t.legs:[t],selected=line.legId?legs.filter(l=>l.id===line.legId):legs;const picked=selected.length?selected:legs;return picked.some(l=>((state.routes||[]).find(r=>r.id===(l.routeId||t.routeId))||{}).crossBorder===true)};
 const lines=inv.lines?.length?inv.lines:[{tripId:inv.tripId,legId:inv.legId}];
 if(inv.includeMdc&&inv.mdcOverrideKm!==null&&inv.mdcOverrideKm!==undefined){
  const km=valid(inv.mdcOverrideKm,'total Namibian kilometres'),rate=valid(inv.mdcRatePer100km??state.settings?.mdcRatePer100km??73.30,'MDC rate');
  if(km<=0)fail('Enter total Namibian kilometres greater than zero, or clear the override for automatic calculation');
  mdcLines.push({tripId:'',tripNumber:'Invoice MDC',namibiaKm:km,ratePer100km:rate,amount:round(km/100*rate),manual:true});
 }else if(inv.includeMdc)for(const line of lines){
  const t=(state.trips||[]).find(x=>x.id===line.tripId);if(!t){missing.push({tripId:line.tripId||'',tripNumber:line.tripNumber||'Invoice',reason:'Trip kilometres not linked'});continue}
  const legs=t.legs?.length?t.legs:[t];let selected=line.legId?legs.filter(l=>l.id===line.legId):legs;
  if(!selected.length&&legs.length===1&&String(line.legId||'').startsWith('legacy_'))selected=legs;
  if(!selected.length){missing.push({tripId:t.id,tripNumber:t.number||t.id,reason:'Load leg not found'});continue}
  const expense=(state.expenses||[]).find(x=>x.tripId===t.id&&(x.mdc===true||/mass distance charge/i.test(String(x.category||''))));
  const rate=valid(expense?.mdcRatePer100km??state.settings?.mdcRatePer100km??73.30,'MDC rate');
  const raw=legs.map(l=>legKm(state,t,l)),unknown=legs.filter((l,i)=>raw[i]<=0&&((state.routes||[]).find(r=>r.id===(l.routeId||t.routeId))||{}).mdcRule!=='Not applicable');
  const recorded=Number(expense?.mdcKm)||Number(t.namibiaKm)||0,known=raw.reduce((a,k)=>a+k,0);
  for(const leg of selected){const key=t.id+':'+(leg.id||'trip');if(seen.has(key))continue;seen.add(key);const route=(state.routes||[]).find(r=>r.id===(leg.routeId||t.routeId))||{};if(route.mdcRule==='Not applicable')continue;
   let km=legKm(state,t,leg);
   if(legs.length===1&&recorded>0)km=recorded;
   else if(!km&&unknown.length===1&&recorded>known)km=recorded-known;
   if(!km&&legs.length===1&&!route.crossBorder)km=Number(t.distance)||0;
   if(km<=0){missing.push({tripId:t.id,legId:leg.id||'',tripNumber:t.number||t.id,reason:'Namibian kilometres missing'});continue}
   mdcLines.push({crossBorder:route.crossBorder===true,tripId:t.id,legId:leg===t?'':leg.id||'',tripNumber:t.number||t.id,namibiaKm:km,ratePer100km:rate,amount:round(km/100*rate)});
  }
 }
 inv.mdcMissingTrips=missing;inv.mdcReady=!inv.includeMdc||!missing.length;inv.mdcKm=round(mdcLines.reduce((a,l)=>a+l.namibiaKm,0));
 if(options.newInvoice&&!inv.mdcReady)fail('MDC kilometres are missing for '+missing.length+' load(s). Enter total Namibian kilometres or update the linked trips before creating the invoice.');

 inv.transportSubtotal=round(base);inv.mdcLines=mdcLines;inv.mdcAmount=round(mdcLines.reduce((a,l)=>a+l.amount,0));inv.subtotal=round(base+inv.mdcAmount);
 const chargeLines=inv.lines?.length?inv.lines:[{tripId:inv.tripId,legId:inv.legId,amount:base}];
 const localTransport=chargeLines.reduce((a,l)=>a+(lineBorder(l)?0:valid(l.amount||0,'transport amount')),0),hasLocal=chargeLines.some(l=>!lineBorder(l)),hasBorder=chargeLines.some(lineBorder);
 let localMdc=mdcLines.filter(l=>!l.crossBorder&&!l.manual).reduce((a,l)=>a+l.amount,0);
 if(mdcLines.some(l=>l.manual)){
  if(hasLocal&&hasBorder)fail('For a mixed local/cross-border invoice, use kilometres on each linked trip instead of a combined kilometre override so VAT can be allocated correctly.');
  localMdc=hasBorder?0:inv.mdcAmount;
 }
 inv.vatRate=inv.vatMode==='route'?15:valid(inv.vatRate,'VAT rate');inv.vatTaxableSubtotal=round(localTransport+localMdc);inv.vatExcludedSubtotal=round(inv.subtotal-inv.vatTaxableSubtotal);inv.vatAmount=round(inv.vatTaxableSubtotal*inv.vatRate/100);inv.amount=round(inv.subtotal+inv.vatAmount);return inv;
}
const api={calculate,legKm};if(typeof module==='object'&&module.exports)module.exports=api;else root.InvoiceCharges=api;
})(typeof globalThis!=='undefined'?globalThis:this);
