'use strict';
(function(root,make){
 const api=make();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.AngermundSiteAssistant=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const aliases=[
  ['monthlyPnl',/\b(monthly income|income (this|last|per) month|monthly revenue|monthly profit|monthly (p[& ]?l|earnings|turnover)|profit and loss|overheads|net profit)\b/i],
  ['reports',/\b(all.time (income|revenue|profit)|performance reports|fleet profit|operational reports)\b/i],
  ['invoices',/\b(invoice|invoicing|payment|debtors?|outstanding balance|unpaid)\b/i],
  ['rates',/\b(quote|quotation|transport rate|price per km|tender)\b/i],
  ['dispatch',/\b(dispatch|assign driver|send truck|allocate truck|board)\b/i],
  ['trips',/\b(trip|journey|load|delivery)\b/i],
  ['shunterRecon',/\b(shunter|shunting|reconciliation|recon)\b/i],
  ['tracking',/\b(gps|location|geofence|track(ing)?|where.*truck)\b/i],
  ['diesel',/\b(diesel|fuel slip|fuel usage|litres|odometer)\b/i],
  ['driverUploads',/\b(pod|proof of delivery|uploaded slip|receipt upload)\b/i],
  ['roadCharges',/\b(mdc|mass distance|road charges)\b/i],
  ['payroll',/\b(salary|salaries|payslip|payroll|staff wages)\b/i],
  ['loans',/\b(worker loan|employee loan|staff loan|repayment)\b/i],
  ['fleet',/\b(truck status|fleet|vehicle|tracker device|registration)\b/i],
  ['workshop',/\b(workshop|service|repair|maintenance)\b/i],
  ['tyres',/\b(tyres?|tires?)\b/i],
  ['documents',/\b(permit|roadworthy|passport|prdp|compliance document)\b/i],
  ['insurance',/\b(insurance|policy|insured assets?)\b/i],
  ['driverAccounts',/\b(driver account|staff account|employee account|password)\b/i],
  ['clients',/\b(client|customer|routes?)\b/i],
  ['imports',/\b(import excel|spreadsheet upload|import workbook)\b/i],
  ['tasks',/\b(tasks?|approvals?|to.do|reminders?)\b/i],
  ['notifications',/\b(notification|push alerts?|warnings?)\b/i]
 ];
 function findPage(question,pages=[]){
  const q=String(question||'').trim();
  if(!q)return null;
  const allowed=new Map(pages.map(p=>[p.id,p]));
  for(const [id,re] of aliases)if(re.test(q)&&allowed.has(id))return allowed.get(id);
  const words=q.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>2&&!['how','the','where','can','see','find','open','my','our','show','what','does','with','for','page','this','that','help'].includes(x));
  let best=null,score=0;
  for(const p of pages){
    const hay=String(p.label||'').toLowerCase()+' '+String(p.description||'').toLowerCase();
    const n=words.filter(w=>hay.includes(w)).length;
    if(n>score){score=n;best=p}
  }
  return score>=1?best:null;
 }
 function answer(message,context){
  const q=String(message||''),pages=context?.pages||[],p=findPage(q,pages);
  if(!p)return{answer:'I can guide you through Angermund Transport. Ask about monthly income, invoices, GPS, diesel, trips or another page. I will only open pages your account can access.',page:null,action:null};
  let explanation='Open '+p.label+' from the navigation menu. '+String(p.description||'').replace(/\.$/,'')+'.';
  const finance=context?.financials;
  if(p.id==='monthlyPnl'){
    explanation='Open Admin → Monthly P&L & Overheads. Choose the month/year at the top. You will see truck income, operating costs, overheads and net profit.';
    if(finance&&/^\d{4}-\d{2}$/.test(finance.period)){
      const fmt=x=>'N$ '+Number(x||0).toLocaleString('en-NA',{minimumFractionDigits:2,maximumFractionDigits:2});
      explanation+=' For '+finance.period+': income '+fmt(finance.revenue)+', operating costs '+fmt(finance.tripCosts)+', overheads '+fmt(finance.overheadTotal)+', net '+fmt(finance.net)+'. '+(finance.source==='imported'?'These are figures from the saved imported monthly P&L.':'These are live calculated operational figures, not confirmed bank receipts.');
    }
  }else if(p.id==='invoices')explanation='Open Finance & Invoicing → Invoices & Payments to see invoices, customer payments, unpaid balances and debtors.';
  else if(p.id==='tracking')explanation='Open Tracking → Live GPS & Geofences for truck positions, saved geofences and GPS test journeys.';
  else if(p.id==='reports')explanation='Open Admin → Reports & P&L for all-time revenue and performance. For a specific month choose Monthly P&L & Overheads instead.';
  const creating=/\b(create|add|new|start|enter|record)\b/i.test(q);
  const action=creating&&p.id==='trips'&&pages.some(p=>p.id==='dispatch')?'new_trip':
    creating&&p.id==='tasks'?'new_task':null;
  if(action==='new_trip')explanation='Open the new trip form; select route, truck, driver and client, then review details before saving.';
  if(action==='new_task')explanation='Open Tasks & Approvals, select Add Task, enter the owner, due date and priority, and review before saving.';
  return {answer:explanation,page:action==='new_trip'?'dispatch':p.id,action};
 }
 return {findPage,answer};
});
