'use strict';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const cash=v=>'N$ '+n(v).toFixed(2);
function detects(q){return !/^\s*(?:create|edit|delete|set|change|update|add|remove)\b/i.test(q)&&/\b(?:trips?|loads?|journeys?)\b/i.test(q)&&/\b(?:profit|profits|profitable|profitability|margins?|loss|losses|losing money|contribution)\b/i.test(q)}
function legIncome(l){const rate=n(l.unitRate),manual=n(l.agreedAmount||l.income);switch(l.pricingMethod){case 'Per km':return rate*n(l.distance);case 'Per ton':return rate*n(l.tons);case 'Per pallet':return rate*n(l.pallets);case 'Flat trip':return rate>0?rate:manual;default:return manual}}
function figures(t,s){
 const income=t.legs?.length?t.legs.reduce((v,l)=>v+legIncome(l),0):n(t.income);
 const fuel=(s.diesel||[]).filter(x=>x.tripId===t.id),expenses=(s.expenses||[]).filter(x=>x.tripId===t.id);
 const diesel=fuel.length?fuel.reduce((v,x)=>v+(n(x.printedTotal)||n(x.total)||n(x.litres)*n(x.price)),0):n(t.dieselCost);
 const costs=diesel+expenses.reduce((v,x)=>v+n(x.amount),0)+(expenses.some(x=>/^toll$/i.test(x.category||''))?0:n(t.tolls))+n(t.allowance)+n(t.other);
 const warnings=[];if(income<=0)warnings.push('missing or zero income');if(costs<=0)warnings.push('no positive costs recorded');if(!fuel.length&&diesel<=0)warnings.push('diesel cost missing');if(fuel.some(x=>!x.verified))warnings.push('unverified diesel');
 return{id:t.id,number:t.number||t.id,date:t.date||'',truckId:t.truckId,income,costs,contribution:income-costs,margin:income>0?(income-costs)/income*100:null,warnings};
}
function run(q,s,{dates,truck,truckRequested,person}={}){
 const response=answer=>({answer,page:'trips',source:'verified-trip-profit',aiEnabled:false});
 if(truckRequested&&!truck)return response('No saved truck matches that ANG number. Please check the truck number.');
 if(person?.ambiguous)return response('Several drivers match. Please use the full driver name.');
 const scope=(s.trips||[]).filter(t=>!/^cancelled|^canceled|^void/i.test(t.status||'')&&(!truck||t.truckId===truck.id)&&(!person?.match||t.driverId===person.match.driver?.id)&&(!dates?.from||String(t.date||'').slice(0,10)>=dates.from)&&(!dates?.to||String(t.date||'').slice(0,10)<=dates.to));
 const completed=scope.filter(t=>Number(t.stage)>=4||/^(?:Delivered|Completed|Closed|Invoiced)$/i.test(t.status||''));
 const all=completed.map(t=>figures(t,s));
 const threshold=/\b(?:below|under|less than)\s*(\d+(?:\.\d+)?)\s*%/i.exec(q);
 const loss=/\b(?:loss|losses|losing money|loss-making)\b/i.test(q);
 const best=/\b(?:best|highest|most profitable|strongest)\b/i.test(q);
 const ranked=all.filter(x=>x.margin!==null&&x.costs>0&&(!threshold||x.margin<Number(threshold[1]))&&(!loss||x.contribution<0)).sort((a,b)=>best?b.margin-a.margin:a.margin-b.margin);
 const range=dates?.from?dates.from+' to '+dates.to:'all saved dates';
 let answer='Trip operating contribution · '+range+(truck?' · '+truck.fleetName:'')+'\n'+completed.length+' delivered/completed trips checked; '+(scope.length-completed.length)+' unfinished trips excluded.\n';
 answer+=threshold?'Margins below '+threshold[1]+'%:\n':loss?'Trips with recorded losses:\n':best?'Highest recorded margins:\n':'Lowest recorded margins (no weak-margin threshold specified):\n';
 const label=x=>(x.number)+' · '+((s.trucks||[]).find(t=>t.id===x.truckId)?.fleetName||'Truck not assigned')+' · '+x.date;
 answer+=ranked.length?ranked.slice(0,10).map(x=>label(x)+' — income '+cash(x.income)+', recorded costs '+cash(x.costs)+', contribution '+cash(x.contribution)+', margin '+x.margin.toFixed(1)+'%'+(x.warnings.length?' [Provisional: '+x.warnings.join('; ')+']':'')).join('\n'):'No trips with sufficient recorded income and costs match this selection.';
 if(ranked.length>10)answer+='\nShowing 10 of '+ranked.length+' matching trips.';
 const missing=all.filter(x=>x.margin===null||x.costs<=0);
 if(missing.length)answer+='\nNot ranked — incomplete financial records ('+missing.length+'):\n'+missing.slice(0,10).map(x=>label(x)+' — '+x.warnings.join('; ')).join('\n');
 answer+='\nMargin = (trip income − recorded trip costs) ÷ trip income × 100. Uses saved leg income, linked diesel/expenses and trip allowances, matching Trips & Loads. Missing costs can overstate margins. Shared overheads and unrecorded costs are excluded; this is operating contribution, not final net profit.';
 return{...response(answer),figures:ranked.slice(0,10),records:ranked.slice(0,10).map(x=>({kind:'trip',id:x.id,label:x.number}))};
}
module.exports={detects,figures,run};
