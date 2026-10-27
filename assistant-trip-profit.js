'use strict';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const cash=v=>'N$ '+n(v).toLocaleString('en-NA',{minimumFractionDigits:2,maximumFractionDigits:2});
const percent=v=>n(v).toFixed(1)+'%';
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
function detects(q){
 const x=String(q||'');
 if(/^\s*(?:create|edit|delete|set|change|update|add|remove|pay|approve)\b/i.test(x))return false;
 const topic=/\b(?:profit(?:s|ability)?|profitable|margins?|loss(?:es)?|losing money|contribution)\b/i.test(x);
 const trip=/\b(?:trips?|loads?|journeys?|transport|fleet|truck)\b/i.test(x);
 const advice=/\b(?:how (?:can|do|should)|suggest(?:ions)?|recommend(?:ations)?|advice|ways to|improv(?:e|ing)|increas(?:e|ing)|boost|lift|rais(?:e|ing)|reduc(?:e|ing)|cut|sav(?:e|ing)|optimis\w*|optimiz\w*)\b/i.test(x);
 return topic&&(trip||advice);
}
function wantsAdvice(q){return /\b(?:how (?:can|do|should)|suggest(?:ions)?|recommend(?:ations)?|advice|ways to|improv(?:e|ing)|increas(?:e|ing)|boost|lift|rais(?:e|ing)|reduc(?:e|ing)|cut|sav(?:e|ing)|optimis\w*|optimiz\w*|make (?:more|them) profitable)\b/i.test(q)}
function legIncome(l){
 const rate=n(l.unitRate),manual=n(l.agreedAmount||l.income);
 switch(l.pricingMethod){
  case 'Per km':return rate*n(l.distance);
  case 'Per ton':return rate*n(l.tons);
  case 'Per pallet':return rate*n(l.pallets);
  case 'Flat trip':return rate>0?rate:manual;
  default:return manual;
 }
}
function figures(t,s){
 const income=t.legs?.length?t.legs.reduce((v,l)=>v+legIncome(l),0):n(t.income);
 const fuel=(s.diesel||[]).filter(x=>x.tripId===t.id),expenses=(s.expenses||[]).filter(x=>x.tripId===t.id);
 const diesel=fuel.length?fuel.reduce((v,x)=>v+(n(x.printedTotal)||n(x.total)||n(x.litres)*n(x.price)),0):n(t.dieselCost);
 const expenseTotal=expenses.reduce((v,x)=>v+n(x.amount),0);
 const toll=expenses.some(x=>/^toll$/i.test(x.category||''))?0:n(t.tolls);
 const costs=diesel+expenseTotal+toll+n(t.allowance)+n(t.other);
 const warnings=[];
 if(income<=0)warnings.push('missing or zero income');
 if(costs<=0)warnings.push('no positive costs recorded');
 if(!fuel.length&&diesel<=0)warnings.push('diesel cost missing');
 if(fuel.some(x=>!x.verified))warnings.push('unverified diesel');
 const distance=n(t.startKm)>0&&n(t.endKm)>n(t.startKm)?n(t.endKm)-n(t.startKm):
  (Array.isArray(t.legs)&&t.legs.length&&t.legs.every(l=>n(l.distance)>0)?t.legs.reduce((v,l)=>v+n(l.distance),0):n(t.distance));
 if(!(distance>0))warnings.push('trip kilometres missing');
 return{id:t.id,number:t.number||t.id,date:t.date||'',truckId:t.truckId,income,costs,diesel,expenses:expenseTotal+toll+n(t.allowance)+n(t.other),
  distance,contribution:income-costs,margin:income>0?(income-costs)/income*100:null,warnings};
}
function adviceFor(rows,all){
 const advice=[],reliable=all.filter(x=>x.income>0&&x.costs>0),losses=reliable.filter(x=>x.contribution<0);
 const worst=[...losses].sort((a,b)=>a.contribution-b.contribution)[0];
 if(worst)advice.push('Prioritise '+worst.number+': recorded costs exceed revenue by '+cash(-worst.contribution)+'. Check pricing, route kilometres and linked expenses before quoting that journey again.');
 const fuelHeavy=[...reliable].filter(x=>x.diesel>0).sort((a,b)=>(b.diesel/b.income)-(a.diesel/a.income))[0];
 if(fuelHeavy){
  const share=fuelHeavy.diesel/fuelHeavy.income*100;
  advice.push('Review diesel for '+fuelHeavy.number+': '+cash(fuelHeavy.diesel)+' is '+percent(share)+' of its revenue. Check receipt duplicates, route length, idling and tyre/service condition. Purchased litres alone do not prove fuel consumed.');
 }
 const low=rows.find(x=>x.margin<20&&x.income>0&&x.costs>0);
 if(low){
  const extraRevenue=Math.max(0,low.costs/0.8-low.income),costReduction=Math.max(0,low.costs-low.income*0.8);
  if(extraRevenue>0)advice.push('Illustrative 20% operating-margin target for '+low.number+': at unchanged recorded costs, require '+cash(extraRevenue)+' more revenue OR '+cash(costReduction)+' lower costs. This is a scenario, not an approved quote.');
 }
 const doubtful=all.filter(x=>x.warnings.length);
 if(doubtful.length)advice.push('Resolve incomplete figures first: '+doubtful.length+' trip(s) have missing or unverified costs, revenue or kilometres. Confirm diesel slips, POD, tolls and driver trip money before trusting margin rankings.');
 advice.push('For future tenders, compare the full return journey cost/km with the agreed rate/km; include empty return kilometres, driver payments, MDC, tolls and offloading, then negotiate the rate before accepting a weak-margin load.');
 return advice.slice(0,5);
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
 const range=dates?.from?dates.from+' to '+dates.to:'all saved dates',useAll=/\b(?:all|every|full|detailed|complete list)\b/i.test(q);
 const shown=ranked.slice(0,useAll?20:5),eligible=all.filter(x=>x.income>0&&x.costs>0),income=eligible.reduce((a,x)=>a+x.income,0),
  costs=eligible.reduce((a,x)=>a+x.costs,0),contribution=income-costs,margin=income>0?contribution/income*100:null;
 const name=x=>((s.trucks||[]).find(t=>t.id===x.truckId)?.fleetName||'Truck not assigned');
 const lines=['TRIP PROFITABILITY','Period: '+range+(truck?' · '+truck.fleetName:''),
  'Reviewed: '+completed.length+' delivered/completed trip(s) · '+(scope.length-completed.length)+' unfinished excluded',
  'SUMMARY','Revenue: '+cash(income),'Recorded costs: '+cash(costs),
  'Operating contribution: '+cash(contribution),'Weighted margin: '+(margin===null?'not available':percent(margin))+' (provisional)'];
 lines.push('TRIPS');
 lines.push(threshold?'Margins below '+threshold[1]+'%':loss?'Recorded loss-making trips':best?'Highest recorded margins':'Lowest recorded margins');
 if(!shown.length)lines.push('No trips with sufficient recorded income and costs match this selection.');
 shown.forEach((x,i)=>{
  lines.push((i+1)+'. '+clean(x.number)+' · '+name(x)+' · '+String(x.date).slice(0,10));
  lines.push('Income '+cash(x.income)+'  |  Costs '+cash(x.costs));
  lines.push('Contribution '+cash(x.contribution)+'  |  Margin '+percent(x.margin));
  if(x.warnings.length)lines.push('Review: '+x.warnings.join('; '));
 });
 if(ranked.length>shown.length)lines.push('Showing '+shown.length+' of '+ranked.length+' matching trips. Ask for "all trip profit margins" to see more.');
 const missing=all.filter(x=>x.margin===null||x.costs<=0);
 if(missing.length){
  lines.push('NEEDS REVIEW');
  missing.slice(0,5).forEach(x=>lines.push(x.number+' · '+name(x)+' — '+x.warnings.join('; ')));
  if(missing.length>5)lines.push((missing.length-5)+' more trip(s) with incomplete records');
 }
 const adviceWanted=wantsAdvice(q);
 if(adviceWanted){
  lines.push('HOW TO IMPROVE MARGINS');
  adviceFor(ranked,all).forEach((a,i)=>lines.push((i+1)+'. '+a));
 }else lines.push('TIP','Ask "How can we improve trip profit margins?" for cost-saving and rate suggestions based on these records.');
 lines.push('METHOD','Margin = (income − recorded costs) ÷ income. These are operating contributions, not net profit. Missing fuel, driver pay, receipts, overheads or duplicate expenses can change the result.');
 return{...response(lines.join('\n')),figures:ranked.slice(0,20),records:shown.map(x=>({kind:'trip',id:x.id,label:x.number})),profitSummary:{income,costs,contribution,margin,reviewed:completed.length,eligible:eligible.length},advice:adviceWanted?adviceFor(ranked,all):[]};
}
module.exports={detects,wantsAdvice,figures,run,adviceFor};
