const {calculate:calculateInvoiceCharges}=require('./public/invoice-charges');
'use strict';
const fail=m=>{const e=Error(m);e.status=400;throw e};
function date(v,label){v=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Invalid '+label);return v}
function bounds(body){const start=date(body.periodStart,'billing start date'),end=date(body.periodEnd,'billing end date');if(start>end)fail('Billing start must be before the end date');return{start,end}}
function editInvoice(state,inv,body,h){
  if(body.expectedUpdatedAt!==undefined&&String(inv.updatedAt||'')!==String(body.expectedUpdatedAt))fail('Invoice changed. Reopen it before saving.');
  const before=structuredClone(inv);
  if(body.number!==undefined){const n=String(body.number).trim();if(!n)fail('Invoice number is required');if((state.invoices||[]).some(x=>x.id!==inv.id&&x.number===n))fail('Invoice number already exists');inv.number=n}
  for(const k of ['date','due'])if(body[k]!==undefined)inv[k]=date(body[k],k);
  for(const k of ['reference','notes'])if(body[k]!==undefined)inv[k]=String(body[k]||'').trim().slice(0,2000);
  if(body.periodStart!==undefined||body.periodEnd!==undefined){
    const {start,end}=bounds({...inv,...body});
    if(!inv.consolidated&&!inv.shunterRecon)fail('Billing periods apply to consolidated invoices');
    if(start!==inv.periodStart||end!==inv.periodEnd||body.rebuild===true){
      if(inv.shunterRecon)fail('Shunter date ranges are managed in Shunter Recon; this editor can change its invoice dates and amounts');
      const affected=[];
      for(const t of state.trips||[]){let removed=false;for(const l of h.ensureTripLegs(state,t))if(l.invoiceId===inv.id){l.invoiceId='';delete l.invoiceStatus;l.status='Delivered';removed=true}if(removed){if(t.invoiceId===inv.id)t.invoiceId='';t.invoiceIds=(t.invoiceIds||[]).filter(id=>id!==inv.id);h.syncJourneyWorkflow(t);affected.push(t)}}
      const nbl=(state.clients||[]).find(x=>x.id===inv.clientId);if(!nbl)fail('Client not found');
      const found=h.collectNblInvoiceLines(state,nbl,start,end);if(!found.lines.length)fail('No eligible delivered loads in these dates');
      inv.lines=found.lines;inv.tripIds=[...new Set(inv.lines.map(l=>l.tripId))];inv.lineCount=inv.lines.length;h.linkNblInvoiceLines(state,inv,inv.lines);
    }
    inv.periodStart=start;inv.periodEnd=end;inv.billingCycle='Custom billing dates';inv.cutoffDay=null;
  }
  for(const line of inv.lines||[]){
    const key=line.legId||line.shunterReconId||line.tripId,raw=body.lineAmounts?.[key];if(raw===undefined)continue;
    const amount=Number(raw);if(!Number.isFinite(amount)||amount<0)fail('Enter valid line amounts');if(Number(amount.toFixed(2))===Number(line.amount))continue;line.amount=Number(amount.toFixed(2));
    const t=(state.trips||[]).find(x=>x.id===line.tripId),leg=t?h.ensureTripLegs(state,t).find(x=>x.id===line.legId):null;
    if(leg){leg.pricingMethod='Manual negotiated';leg.agreedAmount=line.amount;leg.income=line.amount;h.syncTripFromLegs(state,t);h.recalcTripCosts(state,t);t.loadEditedAt=new Date().toISOString();if(t.legs[0]?.id===leg.id){t.sourceRate=leg.income;if(t.carrierDetails)t.carrierDetails.rate=leg.income}}
    if(line.shunterReconId){const r=(state.shunterRecons||[]).find(x=>x.id===line.shunterReconId);if(r){r.charge=line.amount;r.rateBasis='manual'}}
  }
  if(inv.lines?.length)inv.amount=Number(inv.lines.reduce((a,l)=>a+Number(l.amount||0),0).toFixed(2));
  else if(body.amount!==undefined){const amount=Number(body.amount);if(!Number.isFinite(amount)||amount<0)fail('Invalid invoice amount');inv.amount=Number(amount.toFixed(2));inv.transportSubtotal=inv.amount;const t=(state.trips||[]).find(x=>x.id===inv.tripId);if(t){const legs=h.ensureTripLegs(state,t);const l=inv.legId?legs.find(x=>x.id===inv.legId):legs.length===1?legs[0]:null;if(!l)fail('Edit each journey leg amount for this multi-load invoice');l.pricingMethod='Manual negotiated';l.agreedAmount=inv.amount;l.income=inv.amount;h.syncTripFromLegs(state,t);h.recalcTripCosts(state,t);t.loadEditedAt=new Date().toISOString();if(t.legs[0]?.id===l.id){t.sourceRate=l.income;if(t.carrierDetails)t.carrierDetails.rate=l.income}}}
  calculateInvoiceCharges(state,inv,{vatRate:body.vatRate,includeMdc:body.includeMdc,mdcOverrideKm:body.mdcOverrideKm,mdcRatePer100km:body.mdcRatePer100km});
  const paid=Math.max(Number(inv.paidAmount||0),(state.payments||[]).filter(p=>p.invoiceId===inv.id).reduce((a,p)=>a+Number(p.amount||0),0));
  if(inv.amount<paid-.005)fail('Invoice total cannot be less than payments already received');
  inv.paidAmount=paid;inv.balance=Number((inv.amount-paid).toFixed(2));inv.status=inv.balance<=.005?'Paid':paid>0?'Part Paid':inv.due<new Date().toISOString().slice(0,10)?'Overdue':'Unpaid';inv.updatedAt=new Date().toISOString();return{invoice:inv,before};
}
module.exports={editInvoice,bounds};
