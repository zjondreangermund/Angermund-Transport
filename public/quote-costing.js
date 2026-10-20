/* Shared quotation arithmetic. Distances are explicit totals; no automatic return multiplier. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AngermundQuoteCosting=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function nonnegative(value,label){const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error(label+' must be zero or more');return n}
  function calculate(legs,inputs){
    const v=(key)=>nonnegative(inputs[key]??0,key);
    const kml=v('kml'),margin=v('margin');
    if(kml<=0)throw Error('Fuel consumption must be greater than zero');
    if(margin>=100)throw Error('Profit margin must be below 100%');
    let distance=0,namibiaKm=0,quotedIncome=0;
    const legTotals=legs.map(l=>{
      const km=nonnegative(l.actualKm,'Actual km'),na=nonnegative(l.namibiaKm,'Namibian km');
      if(na>km)throw Error('Namibian km cannot exceed actual km');
      nonnegative(l.tenderKm,'Tender km');
      const amount=l.empty?0:nonnegative(l.amount,'Quoted amount');
      distance+=km;namibiaKm+=na;quotedIncome+=amount;
      return {...l,amount};
    });
    if(!legs.length||distance<=0)throw Error('Add at least one journey leg with actual kilometres');
    const foreignKm=distance-namibiaKm,litres=distance/kml;
    const rows=[
      ['Diesel',namibiaKm/kml*v('dieselNA')+foreignKm/kml*v('dieselForeign'),litres.toFixed(2)+' L; Namibia '+v('dieselNA')+'/L, outside Namibia '+v('dieselForeign')+'/L'],
      ['Driver kilometre payment',distance*v('driverRate'),distance+' km × '+v('driverRate')],
      ['MDC',namibiaKm/100*v('mdcRate'),namibiaKm+' Namibian km ÷ 100 × '+v('mdcRate')],
      ['Maintenance',distance*v('maintenanceRate'),distance+' km × '+v('maintenanceRate')],
      ['Tyres',distance*v('tyreRate'),distance+' km × '+v('tyreRate')],
      ['Insurance',distance*v('insuranceRate'),distance+' km × '+v('insuranceRate')],
      ['Truck ownership / overhead',distance*v('ownershipRate'),distance+' km × '+v('ownershipRate')],
      ['Driver food allowance',v('days')*v('foodRate'),v('days')+' days × '+v('foodRate')],
      ['Tolls / borders / permits',v('tolls'),'Entered total'],
      ['Standing / detention',v('waitingDays')*v('standingRate'),v('waitingDays')+' days × '+v('standingRate')],
      ['Other costs',v('other'),'Entered total']
    ].map(([label,amount,calculation])=>({label,amount,calculation}));
    const totalCost=rows.reduce((a,r)=>a+r.amount,0),minimum=v('minimum'),unrounded=Math.max(minimum,totalCost/(1-margin/100)),rounding=v('rounding');
    const recommended=rounding?Math.ceil((unrounded-1e-9)/rounding)*rounding:unrounded;
    const profit=quotedIncome-totalCost,vatRate=v('vatRate'),vat=quotedIncome*vatRate/100;
    return {distance,namibiaKm,foreignKm,litres,rows,totalCost,unrounded,recommended,quotedIncome,profit,actualMargin:quotedIncome?profit/quotedIncome*100:0,vat,vatRate,total:quotedIncome+vat,legs:legTotals};
  }
  return {calculate};
});