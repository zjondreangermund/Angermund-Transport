const express=require('express'),path=require('path'),crypto=require('crypto'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs'),multer=require('multer'),webpush=require('web-push'),ExcelJS=require('exceljs');
const {Pool}=require('pg');const {createWorker}=require('tesseract.js');
const app=express(),root=path.join(__dirname,'public'),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024}});
const PORT=process.env.PORT||3000,JWT_SECRET=process.env.JWT_SECRET||'development-only-change-before-production',DATABASE_URL=process.env.DATABASE_URL;
const num=value=>Number(value||0);
function supplierKey(value){return String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function receiptSupplier(raw){
  const text=String(raw||'');
  const known=[
    [/\bVIVO\s*ENERGY(?:\s*NAMIBIA)?\b/i,'VIVO Energy Namibia'],[/\bOKAHANDJA\s*TRUCK\s*STOP\b/i,'Okahandja Truck Stop'],
    [/\bPUMA\b/i,'Puma'],[/\bSHELL\b/i,'Shell'],[/\bENGEN\b/i,'Engen'],[/\bTOTAL(?:ENERGIES)?\b/i,'TotalEnergies'],[/\bBP\b/i,'BP'],
    [/\bKFC\b/i,'KFC'],[/\bHUNGRY\s*LION\b/i,'Hungry Lion'],[/\bWIMPY\b/i,'Wimpy'],[/\bSTEERS\b/i,'Steers'],[/\bSPUR\b/i,'Spur'],[/\bNANDO'?S\b/i,"Nando's"],[/\bDEBONAIRS\b/i,'Debonairs'],
    [/\bSHOPRITE\b/i,'Shoprite'],[/\bCHECKERS\b/i,'Checkers'],[/\bPICK\s*N\s*PAY\b/i,'Pick n Pay'],[/\bWOERMANN\b/i,'Woermann Brock'],[/\bSPAR\b/i,'SPAR']
  ];
  for(const [re,name] of known)if(re.test(text))return name;
  const generic=/^(tax\s*)?(invoice|receipt|cash\s*sale|customer\s*copy|duplicate|original|vat|date|time|total|subtotal|change|cashier|thank\s*you|tel|telephone|address|item|qty|price|amount|code|rate|payment)\b/i;
  const lines=text.split(/\r?\n/).map(x=>x.replace(/[“”"']/g,'').replace(/\s+/g,' ').trim()).filter(x=>x.length>=3&&x.length<=70);
  const believable=line=>{
    if(generic.test(line)||/^[\d\W]+$/.test(line))return false;
    const letters=(line.match(/[A-Za-z]/g)||[]).length,digits=(line.match(/\d/g)||[]).length,punct=(line.match(/[^A-Za-z0-9\s&.-]/g)||[]).length;
    const words=line.split(/\s+/).filter(Boolean),realWords=words.filter(w=>/[A-Za-z]{3,}/.test(w)),singleLetters=words.filter(w=>/^[A-Za-z]$/.test(w)).length;
    if(letters<4||realWords.length<1)return false;
    if(punct>2||singleLetters>2)return false;
    if(digits>letters*1.2)return false;
    return letters/Math.max(1,line.length)>.42;
  };
  return lines.find(believable)||null;
}
function classifyReceipt(raw,supplier,state={},facts={}){
  const text=(String(supplier||'')+'\n'+String(raw||'')).toLowerCase(),key=supplierKey(supplier),rules=state.supplierCategoryRules||{},has=re=>re.test(text);
  const fuzzyDiesel=/d[i1l][e3]s[e3][l1]/i,litreWord=/\bl[i1]t(?:re|res|er|ers)\b/i;
  const fuelBrand=/\b(puma|shell|engen|totalenergies|total|bp|vivo\s*energy)\b/i;
  const fuelOperational=/\b(pump|nozzle)\b|fuel\s*save|fuelsave|sfs\s*d[i1l][e3]s[e3][l1]|price\s*\/?\s*l[i1]t(?:re|res|er|ers)/i;
  const numericFuel=Number(facts.litres)>0&&(Number(facts.pricePerLitre)>0||Number(facts.suggestedAmount)>0);
  if(fuzzyDiesel.test(text)||has(fuelOperational)||(numericFuel&&has(fuelBrand)))return{category:'Diesel',confidence:numericFuel?99:98,reason:numericFuel?'Fuel litres and price/amount detected':'Diesel/fuel receipt wording detected',source:'ocr'};
  if(Number(facts.litres)>0&&Number(facts.pricePerLitre)>0)return{category:'Diesel',confidence:99,reason:'Litres and price per litre detected',source:'structure'};
  if(Number(facts.litres)>0&&has(/\b(pump|nozzle|truck\s*stop|service\s*station)\b/))return{category:'Diesel',confidence:97,reason:'Fuel volume and filling-station details detected',source:'structure'};
  if(has(/\btoll\b|toll\s*plaza|e[ -]?tag|vehicle\s*class|lane\s*\d+/))return{category:'Toll',confidence:96,reason:'Toll or plaza wording detected',source:'ocr'};
  if(has(/cross[ -]?border|border\s*post|road\s*fund|customs|transit\s*permit|border\s*permit|entry\s*permit/))return{category:'Border permit',confidence:94,reason:'Border/permit wording detected',source:'ocr'};
  if(has(/\bparking\b|parkade|parking\s*ticket|entry\s*time|exit\s*time/))return{category:'Parking',confidence:94,reason:'Parking wording detected',source:'ocr'};
  if(has(/hotel|lodge|guest\s*house|guesthouse|accommodation|room\s*(?:no|number|rate)|check[ -]?in|check[ -]?out|overnight/))return{category:'Accommodation',confidence:92,reason:'Hotel/lodge/room wording detected',source:'ocr'};
  if(has(/tyre|tire|puncture|workshop|mechanic|wheel\s*alignment|battery|brake|spare\s*part|auto\s*parts|vehicle\s*repair|repair\s*labou?r/))return{category:'Emergency repair',confidence:91,reason:'Vehicle repair/parts wording detected',source:'ocr'};
  if(has(/offload|offloading|loading\s*fee|handling\s*fee|warehouse|forklift|weighbridge|cargo\s*handling/))return{category:'Loading / offloading',confidence:90,reason:'Loading/handling wording detected',source:'ocr'};
  if(has(/restaurant|take[ -]?away|\bfood\b|\bmeal\b|burger|chicken|pizza|coffee|cafe|\bkfc\b|hungry\s*lion|wimpy|steers|spur|nando'?s|debonairs|shoprite|checkers|pick\s*n\s*pay|woermann|\bspar\b|grocery|grocer/))return{category:'Meals',confidence:89,reason:'Food/restaurant wording detected',source:'ocr'};
  let learned=rules[key];
  if(!learned&&key.length>=4){const match=Object.keys(rules).find(k=>k.length>=4&&(key.includes(k)||k.includes(key)));if(match)learned=rules[match]}
  if(learned?.category)return{category:learned.category,confidence:99,reason:'Recognised supplier from a previous confirmed slip',source:'learned'};
  if(Number(facts.litres)>0||litreWord.test(text))return{category:'Diesel',confidence:82,reason:'Fuel volume wording detected',source:'structure'};
  return{category:'Other',confidence:40,reason:'No strong category match found',source:'ocr'};
}
function rememberSupplierCategory(state,supplier,category){
  const key=supplierKey(supplier);
  if(key.length<3||!category||category==='Other')return;
  state.supplierCategoryRules??={};
  state.supplierCategoryRules[key]={supplier:String(supplier).trim().slice(0,100),category,updatedAt:new Date().toISOString(),source:'confirmed'};
}
function scoreReceiptText(raw){
  const text=String(raw||''),lower=text.toLowerCase();
  let score=0;
  const signals=[
    [/diesel|fuel|sfsdiesel|fuelsave/i,18],
    [/price\s*\/?\s*litre|price\s*\/?\s*litres|per\s*litre/i,16],
    [/\b(pump|nozzle)\b/i,10],
    [/\b(vivo\s*energy|shell|puma|engen|totalenergies|bp)\b/i,12],
    [/\b(total|amount\s*in\s*nad|amount\s*due)\b/i,8],
    [/\bodometer\b/i,8],
    [/\b\d+(?:[.,]\d+)?\s*\(\s*l\s*\)/i,12],
    [/\b\d+(?:[.,]\d+)?\s*(?:l|ltr|litre|litres)\b/i,10],
    [/\b(receipt|invoice|ticket|duplicate|tax)\b/i,4]
  ];
  for(const [re,pts] of signals)if(re.test(text))score+=pts;
  score+=Math.min(18,(text.match(/\d+[.,]\d{2,4}/g)||[]).length*2);
  score+=Math.min(12,Math.floor(text.replace(/\s/g,'').length/120));
  const weird=(text.match(/[^\x09\x0A\x0D\x20-\x7E]/g)||[]).length;
  score-=Math.min(20,weird*2);
  if(lower.includes('shell fuelsave'))score+=12;
  if(lower.includes('vivo energy namibia'))score+=12;
  return score;
}

function extractReceiptFields(raw,state={}){
  const text=String(raw||''),toN=v=>Number(String(v??'').replace(/\s/g,'').replace(/,/g,'')),lines=text.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const amountCandidates=[...text.matchAll(/(?:N\$|NAD|R)?\s*(-?\d[\d ,]*[.,]\d{2})/gi)].map(x=>x[1]);
  const fuelTransactions=[],seen=new Set();
  const fuelRow=/(\d{2,5}(?:[.,]\d{1,3})?)\s*\(\s*[LlI1]\s*\)\s*(\d{1,3}(?:[.,]\d{1,4})?)\s+(\d[\d ,]*[.,]\d{2})/i;
  for(let i=0;i<lines.length;i++){
    const candidates=[lines[i],i+1<lines.length?lines[i]+' '+lines[i+1]:''];
    for(const candidate of candidates){
      const m=candidate.match(fuelRow);
      if(!m)continue;
      const litres=toN(m[1]),price=toN(m[2]),amount=toN(m[3]);
      if(!(litres>0&&litres<5000&&price>5&&price<100&&amount>10))continue;
      const key=[litres.toFixed(3),price.toFixed(4),amount.toFixed(2)].join('|');
      if(seen.has(key))continue;
      seen.add(key);fuelTransactions.push({litres:Number(litres.toFixed(3)),pricePerLitre:Number(price.toFixed(4)),amount:Number(amount.toFixed(2))});
    }
  }
  const printedTotalPatterns=[
    /^\s*(?:grand\s*)?total\s*[:=-]?\s*(?:N\$|NAD|R)?\s*(-?\d[\d ,]*[.,]\d{2})\s*$/im,
    /^\s*amount\s+in\s+nad\s*[:=-]?\s*(-?\d[\d ,]*[.,]\d{2})\s*$/im,
    /^\s*amount\s+due\s*[:=-]?\s*(?:N\$|NAD|R)?\s*(-?\d[\d ,]*[.,]\d{2})\s*$/im
  ];
  let printedTotal=null;
  for(const re of printedTotalPatterns){const m=text.match(re);if(m){printedTotal=toN(m[1]);break}}
  const explicitLitres=(text.match(/(?:sfs\s*d[i1l][e3]s[e3][l1]|fuel\s*save\s*d[i1l][e3]s[e3][l1]|d[i1l][e3]s[e3][l1])[\s\S]{0,35}?\bL\s*[:=-]?\s*(\d+(?:[.,]\d{1,3})?)/i)||[])[1];
  const priceLine=(text.match(/(?:PRICE\s*\/\s*LITRES?|PRICE\s*\/\s*LITRE|PRICE\s*\/\s*L|PER\s*LITRE|LITRE\s*PRICE)[^0-9]{0,16}(\d+(?:[.,]\d{1,4})?)/i)||[])[1];
  const lineLitres=fuelTransactions.reduce((a,x)=>a+x.litres,0),lineAmount=fuelTransactions.reduce((a,x)=>a+x.amount,0);
  let litres=lineLitres||toN(explicitLitres)||null;
  if(!litres){
    const single=(text.match(/(\d+(?:[.,]\d{1,3})?)\s*(?:L|LTR|LITRE|LITRES)\b/i)||[])[1];
    litres=toN(single)||null;
  }
  let suggestedAmount=printedTotal;
  if(!(suggestedAmount>0)&&lineAmount>0)suggestedAmount=Number(lineAmount.toFixed(2));
  if(!(suggestedAmount>0)){
    const nums=amountCandidates.map(toN).filter(x=>Number.isFinite(x)&&x>0);
    suggestedAmount=nums.length?Math.max(...nums):null;
  }
  let pricePerLitre=toN(priceLine)||null;
  if(!(pricePerLitre>0)&&litres>0&&suggestedAmount>0)pricePerLitre=suggestedAmount/litres;
  const itemWeighted=fuelTransactions.length&&lineLitres>0?lineAmount/lineLitres:null;
  if(itemWeighted&&(!pricePerLitre||Math.abs(itemWeighted-pricePerLitre)>.5))pricePerLitre=itemWeighted;
  const adjustment=printedTotal!==null&&lineAmount>0?Number((printedTotal-lineAmount).toFixed(2)):null;
  const odometerMatch=text.match(/ODOMETER\s*[:#-]?\s*(\d{4,9})/i);
  const supplier=receiptSupplier(text);
  const facts={litres,pricePerLitre,suggestedAmount};
  const classification=classifyReceipt(text,supplier,state,facts);
  return{
    documentNumber:(text.match(/(?:invoice|slip|pod|ref|receipt|ticket)\s*(?:no|number|#)?\s*[:.-]?\s*([A-Z0-9/-]+)/i)||[])[1]||null,
    date:(text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/)||[])[0]||null,
    registration:(text.match(/\bN\s?\d{1,6}\s?[A-Z]{1,3}\b/i)||[])[0]||null,
    odometer:odometerMatch?toN(odometerMatch[1]):null,
    amountCandidates:amountCandidates.slice(0,20),
    suggestedAmount:suggestedAmount?Number(suggestedAmount.toFixed(2)):null,
    printedTotal:printedTotal!==null?Number(printedTotal.toFixed(2)):null,
    litres:litres?Number(litres.toFixed(3)):null,
    pricePerLitre:pricePerLitre?Number(pricePerLitre.toFixed(4)):null,
    supplier,
    fuelTransactions,
    fuelTransactionCount:fuelTransactions.length||((litres&&classification.category==='Diesel')?1:0),
    fuelLineAmount:lineAmount?Number(lineAmount.toFixed(2)):null,
    adjustment,
    category:classification.category,
    categoryConfidence:classification.confidence,
    categoryReason:classification.reason,
    categorySource:classification.source,
    requiresManualAmountConfirmation:!(printedTotal>0||lineAmount>0)
  };
}
async function recognizeReceiptBest(buffer){
  const worker=await createWorker('eng');
  const passes=[
    {psm:'6',label:'receipt-block'},
    {psm:'4',label:'single-column'},
    {psm:'11',label:'sparse-text'}
  ];
  const results=[];
  try{
    for(const pass of passes){
      await worker.setParameters({tessedit_pageseg_mode:pass.psm,preserve_interword_spaces:'1'});
      const r=await worker.recognize(buffer);
      const text=r.data.text||'';
      results.push({text,confidence:Number(r.data.confidence||0),score:scoreReceiptText(text),label:pass.label});
      if(scoreReceiptText(text)>=80&&Number(r.data.confidence||0)>=60)break;
    }
  }finally{await worker.terminate()}
  results.sort((a,b)=>(b.score+b.confidence*.18)-(a.score+a.confidence*.18));
  return results[0]||{text:'',confidence:0,score:0,label:'none'};
}


if(!DATABASE_URL)console.warn('DATABASE_URL missing: using development memory store. Set PostgreSQL for multi-device persistence.');
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(DATABASE_URL)?false:{rejectUnauthorized:false}}):null;
const memory={state:null,users:[],gps:[],geofences:[],notifications:[],subscriptions:[],uploads:[],scanJobs:[]};const clients=new Set();
app.use(express.json({limit:'10mb'}));app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','geolocation=(self), camera=(self)');next()});
const q=async(text,params=[])=>pool?(await pool.query(text,params)).rows:null;
async function initDb(){if(pool){await pool.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,name text NOT NULL,role text NOT NULL CHECK(role IN ('admin','manager','dispatcher','driver','warehouse','workshop','finance')),driver_id text,active boolean DEFAULT true,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app_state(id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),payload jsonb NOT NULL DEFAULT '{}'::jsonb,revision bigint NOT NULL DEFAULT 0,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS gps_positions(id bigserial PRIMARY KEY,vehicle_id text NOT NULL,driver_id text,trip_id text,latitude double precision NOT NULL,longitude double precision NOT NULL,speed double precision DEFAULT 0,heading double precision DEFAULT 0,accuracy double precision,source text DEFAULT 'driver',recorded_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS gps_vehicle_time ON gps_positions(vehicle_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS geofences(id uuid PRIMARY KEY,name text NOT NULL,latitude double precision NOT NULL,longitude double precision NOT NULL,radius_m double precision NOT NULL,event_types text[] DEFAULT ARRAY['enter','exit'],active boolean DEFAULT true,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS geofence_state(vehicle_id text NOT NULL,geofence_id uuid REFERENCES geofences(id) ON DELETE CASCADE,inside boolean NOT NULL,updated_at timestamptz DEFAULT now(),PRIMARY KEY(vehicle_id,geofence_id));
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,type text NOT NULL,severity text DEFAULT 'info',title text NOT NULL,message text NOT NULL,role text,driver_id text,linked_type text,linked_id text,read boolean DEFAULT false,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS push_subscriptions(id bigserial PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE CASCADE,subscription jsonb NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS scan_jobs(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),filename text,status text NOT NULL DEFAULT 'processing',raw_text text,extracted jsonb,confidence double precision,error text,created_at timestamptz DEFAULT now(),completed_at timestamptz);\nCREATE TABLE IF NOT EXISTS driver_uploads(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,trip_id text NOT NULL,kind text NOT NULL,filename text NOT NULL,mime_type text NOT NULL,content bytea NOT NULL,created_at timestamptz DEFAULT now());\nALTER TABLE notifications ADD COLUMN IF NOT EXISTS driver_id text;\nCREATE INDEX IF NOT EXISTS driver_uploads_trip ON driver_uploads(trip_id,created_at DESC);`);
 const email=(process.env.INITIAL_ADMIN_EMAIL||'admin@angermund.local').toLowerCase(),pass=process.env.INITIAL_ADMIN_PASSWORD||'ChangeMe123!';const found=await q('SELECT id FROM users WHERE email=$1',[email]);if(!found.length)await q('INSERT INTO users(id,email,password_hash,name,role) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),email,await bcrypt.hash(pass,12),'System Administrator','admin']);await q("INSERT INTO app_state(id,payload) VALUES(1,'{}') ON CONFLICT(id) DO NOTHING");
 }else if(!memory.users.length)memory.users.push({id:crypto.randomUUID(),email:(process.env.INITIAL_ADMIN_EMAIL||'admin@angermund.local').toLowerCase(),password_hash:await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD||'ChangeMe123!',10),name:'System Administrator',role:'admin',active:true});
 if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:angermundtransport@iway.na',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
}
function tokenFor(u){return jwt.sign({sub:u.id,email:u.email,name:u.name,role:u.role,driverId:u.driver_id||u.driverId||null},JWT_SECRET,{expiresIn:'12h'})}
function auth(req,res,next){const raw=req.headers.authorization?.replace(/^Bearer\s+/i,'')||req.query.token;if(!raw)return res.status(401).json({error:'Authentication required'});try{req.user=jwt.verify(raw,JWT_SECRET);next()}catch{return res.status(401).json({error:'Invalid or expired session'})}}
const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'Insufficient permission'});
function emit(type,data){const msg=`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of clients)res.write(msg)}
const distance=(a,b)=>{const R=6371000,p=x=>x*Math.PI/180,dLat=p(b.latitude-a.latitude),dLon=p(b.longitude-a.longitude),x=Math.sin(dLat/2)**2+Math.cos(p(a.latitude))*Math.cos(p(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))};
async function createNotification(n){const row={id:crypto.randomUUID(),type:n.type||'system',severity:n.severity||'info',title:n.title,message:n.message,role:n.role||null,driver_id:n.driverId||null,linked_type:n.linkedType||null,linked_id:n.linkedId||null,read:false,created_at:new Date().toISOString()};if(pool)await q('INSERT INTO notifications(id,type,severity,title,message,role,driver_id,linked_type,linked_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,row.type,row.severity,row.title,row.message,row.role,row.driver_id,row.linked_type,row.linked_id]);else memory.notifications.unshift(row);emit('notification',row);await sendExternal(row);return row}
async function sendExternal(n){
  const tasks=[];
  if(n.role!=='driver'&&process.env.RESEND_API_KEY&&process.env.ALERT_EMAIL_TO)tasks.push(fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Angermund Alerts <alerts@resend.dev>',to:[process.env.ALERT_EMAIL_TO],subject:n.title,html:`<h2>${n.title}</h2><p>${n.message}</p>`})}));
  if(n.role!=='driver'&&process.env.META_WHATSAPP_TOKEN&&process.env.META_PHONE_NUMBER_ID&&process.env.WHATSAPP_ALERT_TO)tasks.push(fetch(`https://graph.facebook.com/v21.0/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:process.env.WHATSAPP_ALERT_TO,type:'text',text:{body:`${n.title}\n${n.message}`}})}));
  let subs=[];
  if(pool){
    if(n.driver_id)subs=await q('SELECT ps.subscription FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.active=true AND u.driver_id=$1',[n.driver_id]);
    else if(n.role)subs=await q('SELECT ps.subscription FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.active=true AND u.role=$1',[n.role]);
    else subs=await q('SELECT subscription FROM push_subscriptions');
  }else subs=memory.subscriptions.filter(s=>!n.driver_id||s.driverId===n.driver_id).map(s=>({subscription:s.subscription||s}));
  for(const row of subs)if(process.env.VAPID_PUBLIC_KEY)tasks.push(webpush.sendNotification(row.subscription||row,JSON.stringify({title:n.title,body:n.message,linkedType:n.linked_type,linkedId:n.linked_id})).catch(()=>null));
  await Promise.allSettled(tasks);
}
async function evaluateGeofences(pos){
  const fences=pool?await q('SELECT * FROM geofences WHERE active=true'):memory.geofences.filter(x=>x.active!==false);
  for(const f of fences){
    const inside=distance(pos,{latitude:num(f.latitude),longitude:num(f.longitude)})<=num(f.radius_m||f.radiusM);
    const prev=pool?(await q('SELECT inside FROM geofence_state WHERE vehicle_id=$1 AND geofence_id=$2',[pos.vehicleId,f.id]))[0]:f.states?.[pos.vehicleId];
    if(prev!==undefined&&Boolean(prev.inside??prev)!==inside){
      await createNotification({type:'geofence',severity:inside?'info':'warning',title:(inside?'Entered ':'Exited ')+f.name,message:pos.vehicleId+' '+(inside?'entered':'left')+' the '+f.name+' geofence.',linkedType:'vehicle',linkedId:pos.vehicleId});
    }
    if(pool)await q('INSERT INTO geofence_state(vehicle_id,geofence_id,inside) VALUES($1,$2,$3) ON CONFLICT(vehicle_id,geofence_id) DO UPDATE SET inside=$3,updated_at=now()',[pos.vehicleId,f.id,inside]);
    else{f.states??={};f.states[pos.vehicleId]=inside}
  }
}
function routeTripZones(route){
  const loadLat=Number(route?.loadLat),loadLon=Number(route?.loadLon),offloadLat=Number(route?.offloadLat),offloadLon=Number(route?.offloadLon);
  if(!Number.isFinite(loadLat)||!Number.isFinite(loadLon)||!Number.isFinite(offloadLat)||!Number.isFinite(offloadLon)||(!loadLat&&!loadLon)||(!offloadLat&&!offloadLon))return null;
  const approachKm=Math.max(2,Math.min(5,num(route.approachKm)||5));
  const arrivalKm=Math.max(.5,Math.min(approachKm-.25,num(route.arrivalKm)||2));
  return{
    load:{latitude:loadLat,longitude:loadLon,name:String(route.loadName||'Loading point')},
    offload:{latitude:offloadLat,longitude:offloadLon,name:String(route.offloadName||'Offloading point')},
    approachM:approachKm*1000,
    arrivalM:arrivalKm*1000,
    departM:Math.min(approachKm*1000,Math.max(arrivalKm*1000+500,arrivalKm*1250)),
    roundTrip:Boolean(route.roundTrip)||/[↔]|round\s*trip|return/i.test(String(route.name||'')+' '+String(route.notes||''))
  };
}
async function tripGeoNotify(trip,title,message,severity='info'){
  await Promise.allSettled([
    createNotification({type:'trip-geofence',severity,title,message,role:'driver',driverId:trip.driverId,linkedType:'trip',linkedId:trip.id}),
    createNotification({type:'trip-geofence',severity,title,message,role:'dispatcher',linkedType:'trip',linkedId:trip.id})
  ]);
}
async function evaluateTripZones(pos){
  const snapshot=await readOpsState();
  const active=(snapshot.trips||[]).filter(t=>t.truckId===pos.vehicleId&&!t.driverComplete&&!['Closed','Invoiced'].includes(t.status)).sort((a,b)=>num(b.stage)-num(a.stage))[0];
  if(!active)return;
  const route=(snapshot.routes||[]).find(r=>r.id===active.routeId),zones=routeTripZones(route);
  if(!zones)return;
  const preliminaryGeo=active.geo||{},loadM=distance(pos,zones.load),offM=distance(pos,zones.offload),alreadyDeparted=Boolean(preliminaryGeo.loadDepartedAt)||num(active.stage)>=3||['In transit','At offloading','Return journey','Delivered','Returned'].includes(active.status);
  const possible=
    (!alreadyDeparted&&!preliminaryGeo.loadApproachAt&&loadM<=zones.approachM)||
    (!alreadyDeparted&&!preliminaryGeo.loadArrivedAt&&loadM<=zones.arrivalM)||
    (preliminaryGeo.loadArrivedAt&&!preliminaryGeo.loadDepartedAt&&loadM>=zones.departM)||
    (alreadyDeparted&&!preliminaryGeo.offloadApproachAt&&offM<=zones.approachM)||
    (alreadyDeparted&&!preliminaryGeo.offloadArrivedAt&&offM<=zones.arrivalM)||
    (preliminaryGeo.offloadArrivedAt&&!preliminaryGeo.offloadDepartedAt&&offM>=zones.departM)||
    (zones.roundTrip&&preliminaryGeo.offloadDepartedAt&&!preliminaryGeo.returnApproachAt&&loadM<=zones.approachM)||
    (zones.roundTrip&&preliminaryGeo.returnApproachAt&&!preliminaryGeo.returnArrivedAt&&loadM<=zones.arrivalM);
  if(!possible)return;
  const changed=await mutateOpsState(async state=>{
    const t=(state.trips||[]).find(x=>x.id===active.id),r=(state.routes||[]).find(x=>x.id===active.routeId),z=routeTripZones(r);
    if(!t||!z)return{events:[]};
    t.geo??={};
    state.tasks??=[];
    state.trucks??=[];
    state.drivers??=[];
    const g=t.geo,now=new Date().toISOString(),lm=distance(pos,z.load),om=distance(pos,z.offload),events=[],km=m=>(m/1000).toFixed(1);if((num(t.stage)>=3||['In transit','At offloading','Return journey','Delivered','Returned'].includes(t.status))&&!g.loadDepartedAt)g.loadDepartedAt=t.startedAt||now;
    if(!g.loadApproachAt&&lm<=z.approachM){
      g.loadApproachAt=now;
      events.push({title:t.number+' approaching loading point',message:pos.vehicleId+' is '+km(lm)+' km from '+z.load.name+'.'});
    }
    if(!g.loadArrivedAt&&lm<=z.arrivalM){
      g.loadArrivedAt=now;g.loadArrivalPosition={latitude:pos.latitude,longitude:pos.longitude};t.stage=Math.max(2,num(t.stage)||1);t.status='At loading';
      events.push({title:t.number+' arrived at loading',message:pos.vehicleId+' arrived at '+z.load.name+' ('+km(lm)+' km from pin).'});
    }
    if(g.loadArrivedAt&&!g.loadDepartedAt&&lm>=z.departM){
      g.loadDepartedAt=now;g.loadDeparturePosition={latitude:pos.latitude,longitude:pos.longitude};t.stage=Math.max(3,num(t.stage)||1);t.status='In transit';t.startedAt=t.startedAt||now;
      const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='On trip';
      const dr=state.drivers.find(x=>x.id===t.driverId);if(dr)dr.status='On trip';
      events.push({title:t.number+' departed loading point',message:pos.vehicleId+' has left '+z.load.name+' and is now '+km(lm)+' km away. Trip changed to In transit.'});
    }
    if(g.loadDepartedAt&&!g.offloadApproachAt&&om<=z.approachM){
      g.offloadApproachAt=now;
      events.push({title:t.number+' approaching offloading',message:pos.vehicleId+' is '+km(om)+' km from '+z.offload.name+'.'});
    }
    if(g.loadDepartedAt&&!g.offloadArrivedAt&&om<=z.arrivalM){
      g.offloadArrivedAt=now;g.offloadArrivalPosition={latitude:pos.latitude,longitude:pos.longitude};t.status='At offloading';t.arrivedAt=t.arrivedAt||now;
      events.push({title:t.number+' arrived at offloading',message:pos.vehicleId+' arrived at '+z.offload.name+' ('+km(om)+' km from pin).'});
    }
    if(g.offloadArrivedAt&&!g.offloadDepartedAt&&om>=z.departM){
      g.offloadDepartedAt=now;g.offloadDeparturePosition={latitude:pos.latitude,longitude:pos.longitude};
      if(z.roundTrip){
        g.returnStartedAt=now;t.status='Return journey';
        events.push({title:t.number+' return journey started',message:pos.vehicleId+' has left '+z.offload.name+' and is now '+km(om)+' km away.'});
      }else{
        t.stage=Math.max(4,num(t.stage)||1);t.status='Delivered';
        if(!state.tasks.some(x=>x.linkedId===t.id&&/POD/i.test(x.title)&&x.status==='Open')){
          state.tasks.unshift({id:'task_'+crypto.randomUUID(),title:'Upload POD for '+t.number,ownerRole:'Driver',linkedType:'trip',linkedId:t.id,due:now.slice(0,10),priority:'High',status:'Open'});
        }
        events.push({title:t.number+' left offloading point',message:pos.vehicleId+' has departed '+z.offload.name+'. Delivery marked complete; POD is still required.'});
      }
    }
    if(z.roundTrip&&g.offloadDepartedAt&&!g.returnApproachAt&&lm<=z.approachM){
      g.returnApproachAt=now;
      events.push({title:t.number+' approaching return point',message:pos.vehicleId+' is '+km(lm)+' km from '+z.load.name+' on the return journey.'});
    }
    if(z.roundTrip&&g.returnApproachAt&&!g.returnArrivedAt&&lm<=z.arrivalM){
      g.returnArrivedAt=now;g.returnArrivalPosition={latitude:pos.latitude,longitude:pos.longitude};t.stage=Math.max(4,num(t.stage)||1);t.status='Returned';
      if(!state.tasks.some(x=>x.linkedId===t.id&&/POD/i.test(x.title)&&x.status==='Open')&&!t.pod){
        state.tasks.unshift({id:'task_'+crypto.randomUUID(),title:'Upload POD for '+t.number,ownerRole:'Driver',linkedType:'trip',linkedId:t.id,due:now.slice(0,10),priority:'High',status:'Open'});
      }
      events.push({title:t.number+' returned',message:pos.vehicleId+' arrived back at '+z.load.name+'. Trip is ready for POD/office closure.'});
    }
    g.lastPositionAt=now;g.lastLoadDistanceKm=Number((lm/1000).toFixed(2));g.lastOffloadDistanceKm=Number((om/1000).toFixed(2));
    return{events,tripId:t.id,driverId:t.driverId};
  });
  for(const e of changed.result?.events||[])await tripGeoNotify({...active,driverId:changed.result.driverId},e.title,e.message,e.severity||'info');
}
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').toLowerCase(),u=pool?(await q('SELECT * FROM users WHERE email=$1 AND active=true',[email]))[0]:memory.users.find(x=>x.email===email&&x.active);if(!u||!await bcrypt.compare(String(req.body.password||''),u.password_hash))return res.status(401).json({error:'Invalid email or password'});res.json({token:tokenFor(u),user:{id:u.id,email:u.email,name:u.name,role:u.role,driverId:u.driver_id||u.driverId||null}})});
app.get('/api/session',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/users',auth,roles('admin','manager'),async(req,res)=>res.json(pool?await q('SELECT id,email,name,role,driver_id AS "driverId",active,created_at AS "createdAt" FROM users ORDER BY name'):memory.users.map(({password_hash,...u})=>u)));
app.post('/api/users',auth,roles('admin'),async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),name=String(req.body.name||'').trim(),role=String(req.body.role||''),password=String(req.body.password||''),driverId=req.body.driverId||null;if(!email||!name||password.length<10||!['admin','manager','dispatcher','driver','warehouse','workshop','finance'].includes(role))return res.status(400).json({error:'Valid name, email, role and a 10+ character password are required'});if(role==='driver'&&!driverId)return res.status(400).json({error:'Select the driver profile this login belongs to'});if(role==='driver'&&driverId){const linked=pool?(await q('SELECT id FROM users WHERE driver_id=$1',[driverId])):memory.users.filter(x=>(x.driver_id||x.driverId)===driverId);if(linked.length)return res.status(409).json({error:'This driver already has a login. Reactivate or reset the existing account instead.'});}const u={id:crypto.randomUUID(),email,name,role,driverId,active:true,createdAt:new Date().toISOString()},hash=await bcrypt.hash(password,12);try{if(pool)await q('INSERT INTO users(id,email,password_hash,name,role,driver_id) VALUES($1,$2,$3,$4,$5,$6)',[u.id,email,hash,name,role,u.driverId]);else memory.users.push({...u,password_hash:hash});res.status(201).json(u)}catch(e){res.status(409).json({error:'A user with that email already exists'})}});

app.patch('/api/users/:id',auth,roles('admin'),async(req,res)=>{const id=req.params.id,active=req.body.active===undefined?undefined:Boolean(req.body.active),driverId=req.body.driverId===undefined?undefined:(req.body.driverId||null);try{const existing=pool?(await q('SELECT id,email,name,role,driver_id AS "driverId",active FROM users WHERE id=$1',[id]))[0]:memory.users.find(x=>x.id===id);if(!existing)return res.status(404).json({error:'User not found'});if(existing.id===req.user.sub&&active===false)return res.status(400).json({error:'You cannot deactivate your own account'});const nextDriverId=driverId===undefined?(existing.driverId||existing.driver_id||null):driverId;if(existing.role==='driver'&&nextDriverId){const dup=pool?await q('SELECT id FROM users WHERE driver_id=$1 AND id<>$2',[nextDriverId,id]):memory.users.filter(x=>(x.driver_id||x.driverId)===nextDriverId&&x.id!==id);if(dup.length)return res.status(409).json({error:'That driver is already linked to another login'});}if(pool){const finalDriverId=driverId===undefined?(existing.driverId||null):driverId,finalActive=active===undefined?existing.active:active;const row=(await q('UPDATE users SET driver_id=$2,active=$3 WHERE id=$1 RETURNING id,email,name,role,driver_id AS "driverId",active,created_at AS "createdAt"',[id,finalDriverId,finalActive]))[0];return res.json(row)}if(driverId!==undefined){existing.driverId=driverId;existing.driver_id=driverId}if(active!==undefined)existing.active=active;const{password_hash,...safe}=existing;res.json(safe)}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/users/:id/reset-password',auth,roles('admin'),async(req,res)=>{const password=String(req.body.password||'');if(password.length<10)return res.status(400).json({error:'Password must be at least 10 characters'});const id=req.params.id,hash=await bcrypt.hash(password,12);if(pool){const rows=await q('UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING id',[id,hash]);if(!rows.length)return res.status(404).json({error:'User not found'})}else{const u=memory.users.find(x=>x.id===id);if(!u)return res.status(404).json({error:'User not found'});u.password_hash=hash}res.json({success:true})});

app.get('/api/state',auth,async(req,res)=>{const row=pool?(await q('SELECT payload,revision,updated_at FROM app_state WHERE id=1'))[0]:{payload:memory.state||{},revision:0};res.json(row)});
app.put('/api/state',auth,roles('admin','manager','dispatcher','workshop','finance'),async(req,res)=>{if(!req.body||typeof req.body!=='object')return res.status(400).json({error:'Invalid state'});if(pool){const row=(await q('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision,updated_at',[req.body]))[0];emit('state',{revision:row.revision,updatedAt:row.updated_at});res.json(row)}else{memory.state=req.body;emit('state',{revision:Date.now()});res.json({revision:Date.now()})}});

async function readOpsState(){if(pool){const row=(await q('SELECT payload FROM app_state WHERE id=1'))[0];return row?.payload||{}}return memory.state||{}}
function driverTrip(state,req){const did=req.user.driverId;if(!did){const e=Error('Driver account is not linked to a driver profile');e.status=400;throw e}const trip=(state.trips||[]).find(x=>x.id===req.params.tripId);if(!trip){const e=Error('Trip not found');e.status=404;throw e}if(trip.driverId!==did){const e=Error('This trip is not assigned to you');e.status=403;throw e}return{trip,did}}
async function mutateOpsState(mutator){if(pool){const c=await pool.connect();try{await c.query('BEGIN');const row=(await c.query('SELECT payload,revision FROM app_state WHERE id=1 FOR UPDATE')).rows[0]||{payload:{},revision:0};const state=row.payload||{};const result=await mutator(state);const updated=(await c.query('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision,updated_at',[state])).rows[0];await c.query('COMMIT');emit('state',{revision:updated.revision,updatedAt:updated.updated_at});return{result,revision:updated.revision}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}const state=memory.state||{};const result=await mutator(state);memory.state=state;const revision=Date.now();emit('state',{revision});return{result,revision}}
app.post('/api/driver/trips/:tripId/upload',auth,roles('driver'),upload.single('document'),async(req,res)=>{try{if(!req.file)return res.status(400).json({error:'Photo or document required'});const state=await readOpsState();driverTrip(state,req);const kind=String(req.body.kind||'document').slice(0,30),id=crypto.randomUUID();if(pool)await q('INSERT INTO driver_uploads(id,user_id,trip_id,kind,filename,mime_type,content) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,req.user.sub,req.params.tripId,kind,req.file.originalname||'photo.jpg',req.file.mimetype||'application/octet-stream',req.file.buffer]);else memory.uploads.push({id,userId:req.user.sub,tripId:req.params.tripId,kind,filename:req.file.originalname||'photo.jpg',mimeType:req.file.mimetype||'application/octet-stream',content:req.file.buffer,createdAt:new Date().toISOString()});res.status(201).json({id,kind,filename:req.file.originalname||'photo.jpg'})}catch(e){res.status(e.status||500).json({error:e.message})}});
app.get('/api/driver/uploads/:id',auth,async(req,res)=>{const u=pool?(await q('SELECT id,user_id AS "userId",trip_id AS "tripId",kind,filename,mime_type AS "mimeType",content FROM driver_uploads WHERE id=$1',[req.params.id]))[0]:memory.uploads.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Upload not found'});if(req.user.role==='driver'&&u.userId!==req.user.sub)return res.status(403).json({error:'Access denied'});res.set({'Content-Type':u.mimeType||'application/octet-stream','Content-Disposition':'inline; filename="'+String(u.filename||'document').replace(/"/g,'')+'"'});res.send(u.content)});
app.post('/api/driver/trips/:tripId/action',auth,roles('driver'),async(req,res)=>{const action=String(req.body.action||''),data=req.body.data&&typeof req.body.data==='object'?req.body.data:{},clientActionId=String(req.body.clientActionId||'').slice(0,100);const allowed=['accept','inspection','start','arrive','pod','finish','diesel','expense','problem'];if(!allowed.includes(action))return res.status(400).json({error:'Invalid driver action'});try{const changed=await mutateOpsState(async state=>{state.driverActions??=[];if(clientActionId){const prior=state.driverActions.find(x=>x.clientActionId===clientActionId);if(prior)return{duplicate:true,action,tripId:req.params.tripId}}const{trip:t,did}=driverTrip(state,req),now=new Date().toISOString(),date=now.slice(0,10),mk=p=>p+'_'+crypto.randomUUID();state.inspections??=[];state.diesel??=[];state.expenses??=[];state.tripIssues??=[];state.tasks??=[];state.trucks??=[];state.drivers??=[];if(action==='accept'){t.driverAcceptedAt=t.driverAcceptedAt||now;t.stage=Math.max(1,num(t.stage)||1);t.status=t.status||'Planned'}else if(action==='inspection'){const defects=String(data.defects||'').trim(),passed=!defects;state.inspections.unshift({id:mk('ins'),date,tripId:t.id,truckId:t.truckId,driverId:did,type:'Pre-trip',score:passed?100:80,status:passed?'Passed':'Failed',defects,items:{tyres:true,lights:true,brakes:true,fluids:true,documents:true,load:true},driverEasyMode:true});if(passed&&num(t.stage)<2){t.stage=2;t.status='Loading'}}else if(action==='start'){const passed=state.inspections.some(x=>x.tripId===t.id&&x.driverId===did&&x.type==='Pre-trip'&&x.status==='Passed');if(!passed){const e=Error('Complete the pre-trip vehicle check first');e.status=400;throw e}t.stage=3;t.status='In transit';t.startedAt=t.startedAt||now;const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='On trip';const dr=state.drivers.find(x=>x.id===did);if(dr)dr.status='On trip'}else if(action==='arrive'){t.stage=4;t.status='Delivered';t.arrivedAt=t.arrivedAt||now;if(!state.tasks.some(x=>x.linkedId===t.id&&/POD/i.test(x.title)&&x.status==='Open'))state.tasks.unshift({id:mk('task'),title:'Upload POD for '+t.number,ownerRole:'Driver',linkedType:'trip',linkedId:t.id,due:date,priority:'High',status:'Open'})}else if(action==='pod'){if(!data.uploadId){const e=Error('Take a POD photo first');e.status=400;throw e}t.pod=true;t.podUploadId=data.uploadId;t.podAt=now;state.tasks.filter(x=>x.linkedId===t.id&&/POD/i.test(x.title)).forEach(x=>x.status='Completed')}else if(action==='finish'){if(!t.pod){const e=Error('POD photo is required before finishing the trip');e.status=400;throw e}t.driverComplete=true;t.driverCompletedAt=now;const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='Available';const dr=state.drivers.find(x=>x.id===did);if(dr)dr.status='Available';if(!state.tasks.some(x=>x.linkedId===t.id&&/Review completed trip/i.test(x.title)&&x.status==='Open'))state.tasks.unshift({id:mk('task'),title:'Review completed trip '+t.number,ownerRole:'Dispatcher',linkedType:'trip',linkedId:t.id,due:date,priority:'Normal',status:'Open'})}else if(action==='diesel'){const litres=num(data.litres),total=num(data.total),price=num(data.price)||(litres>0?total/litres:0);if(litres<=0){const e=Error('Enter diesel litres');e.status=400;throw e}const rec={id:mk('fuel'),tripId:t.id,date,truckId:t.truckId,driverId:did,litres,price,odometer:num(data.odometer),supplier:String(data.supplier||''),slip:String(data.slip||''),receiptUploadId:data.uploadId||'',verified:false,detectedCategory:String(data.detectedCategory||'Diesel'),categoryConfidence:num(data.categoryConfidence),fuelTransactions:Array.isArray(data.fuelTransactions)?data.fuelTransactions.slice(0,10):[],fuelTransactionCount:num(data.fuelTransactionCount)||1,printedTotal:num(data.printedTotal)||null,receiptAdjustment:data.adjustment===null||data.adjustment===undefined?null:num(data.adjustment),driverEasyMode:true};state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel');t.dieselCost=state.diesel.filter(x=>x.tripId===t.id).reduce((a,x)=>a+num(x.litres)*num(x.price),0)}else if(action==='expense'){const amount=num(data.amount);if(amount<=0){const e=Error('Enter the expense amount');e.status=400;throw e}const category=String(data.category||'Other'),supplier=String(data.supplier||'');state.expenses.unshift({id:mk('expense'),date,tripId:t.id,truckId:t.truckId,driverId:did,category,supplier,amount,receiptNo:String(data.receiptNo||''),notes:String(data.notes||''),receiptUploadId:data.uploadId||'',status:data.uploadId?'Review':'Receipt missing',reimbursable:true,detectedCategory:String(data.detectedCategory||''),categoryConfidence:num(data.categoryConfidence),driverEasyMode:true});rememberSupplierCategory(state,supplier,category)}else if(action==='problem'){const type=String(data.type||'Other'),description=String(data.description||'').trim();state.tripIssues.unshift({id:mk('issue'),date,tripId:t.id,truckId:t.truckId,driverId:did,type,location:String(data.location||''),cost:num(data.cost),description:description||type,action:String(data.actionTaken||''),photoUploadId:data.uploadId||'',status:'Open',driverEasyMode:true})}if(clientActionId)state.driverActions.unshift({clientActionId,tripId:t.id,driverId:did,action,at:now});state.driverActions=state.driverActions.slice(0,1000);return{duplicate:false,action,tripId:t.id,number:t.number,status:t.status,stage:t.stage,pod:Boolean(t.pod),driverComplete:Boolean(t.driverComplete)}});if(action==='problem'&&!changed.result.duplicate)createNotification({type:'driver-problem',severity:'warning',title:'Driver reported a trip problem',message:(req.user.name||'Driver')+' reported '+String(data.type||'a problem')+' on trip '+req.params.tripId+'.',role:'dispatcher',linkedType:'trip',linkedId:req.params.tripId}).catch(()=>{});res.status(changed.result.duplicate?200:201).json({...changed.result,revision:changed.revision})}catch(e){res.status(e.status||500).json({error:e.message})}});

app.get('/api/events',auth,(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();res.write('event: ready\ndata: {}\n\n');clients.add(res);req.on('close',()=>clients.delete(res))});
app.post('/api/gps',auth,async(req,res)=>gpsIn(req,res,'driver'));
app.post('/api/integrations/telematics/webhook',async(req,res)=>{if(req.headers['x-telematics-token']!==process.env.TELEMATICS_WEBHOOK_TOKEN)return res.status(401).json({error:'Invalid webhook token'});req.user={sub:'telematics'};return gpsIn(req,res,'telematics')});
async function gpsIn(req,res,source){const p={vehicleId:String(req.body.vehicleId||req.body.vehicle_id||''),driverId:req.body.driverId||req.user.driverId||null,tripId:req.body.tripId||null,latitude:Number(req.body.latitude),longitude:Number(req.body.longitude),speed:num(req.body.speed),heading:num(req.body.heading),accuracy:req.body.accuracy==null?null:num(req.body.accuracy),source,recordedAt:req.body.recordedAt||new Date().toISOString()};if(!p.vehicleId||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))return res.status(400).json({error:'vehicleId, latitude and longitude are required'});if(pool)await q('INSERT INTO gps_positions(vehicle_id,driver_id,trip_id,latitude,longitude,speed,heading,accuracy,source,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.vehicleId,p.driverId,p.tripId,p.latitude,p.longitude,p.speed,p.heading,p.accuracy,p.source,p.recordedAt]);else memory.gps.push(p);await evaluateGeofences(p);await evaluateTripZones(p);emit('gps',p);res.status(201).json(p)}
app.get('/api/gps/latest',auth,async(req,res)=>{const rows=pool?await q('SELECT DISTINCT ON(vehicle_id) vehicle_id AS "vehicleId",driver_id AS "driverId",trip_id AS "tripId",latitude,longitude,speed,heading,accuracy,source,recorded_at AS "recordedAt" FROM gps_positions ORDER BY vehicle_id,recorded_at DESC'):Object.values(memory.gps.reduce((a,x)=>(a[x.vehicleId]=x,a),{}));res.json(rows)});
app.get('/api/gps/history/:vehicleId',auth,async(req,res)=>{const hours=Math.min(168,Math.max(1,num(req.query.hours)||24)),rows=pool?await q('SELECT vehicle_id AS "vehicleId",latitude,longitude,speed,heading,recorded_at AS "recordedAt" FROM gps_positions WHERE vehicle_id=$1 AND recorded_at>now()-($2||\' hours\')::interval ORDER BY recorded_at',[req.params.vehicleId,String(hours)]):memory.gps.filter(x=>x.vehicleId===req.params.vehicleId&&Date.now()-new Date(x.recordedAt)<hours*3600000);res.json(rows)});
app.get('/api/geofences',auth,async(req,res)=>res.json(pool?await q('SELECT id,name,latitude,longitude,radius_m AS "radiusM",event_types AS "eventTypes",active FROM geofences ORDER BY name'):memory.geofences));
app.post('/api/geofences',auth,roles('admin','manager','dispatcher'),async(req,res)=>{const f={id:crypto.randomUUID(),name:String(req.body.name||''),latitude:Number(req.body.latitude),longitude:Number(req.body.longitude),radiusM:Number(req.body.radiusM||500),eventTypes:req.body.eventTypes||['enter','exit'],active:true};if(!f.name||!Number.isFinite(f.latitude)||!Number.isFinite(f.longitude))return res.status(400).json({error:'name, latitude and longitude required'});if(pool)await q('INSERT INTO geofences(id,name,latitude,longitude,radius_m,event_types) VALUES($1,$2,$3,$4,$5,$6)',[f.id,f.name,f.latitude,f.longitude,f.radiusM,f.eventTypes]);else memory.geofences.push(f);emit('geofence',f);res.status(201).json(f)});
app.get('/api/notifications',auth,async(req,res)=>res.json(pool?await q(`SELECT id,type,severity,title,message,role,driver_id AS "driverId",linked_type AS "linkedType",linked_id AS "linkedId",read,created_at AS "createdAt" FROM notifications WHERE (role IS NULL OR role=$1) AND ($1<>'driver' OR driver_id IS NULL OR driver_id=$2) ORDER BY created_at DESC LIMIT 100`,[req.user.role,req.user.driverId||null]):memory.notifications.filter(x=>(!x.role||x.role===req.user.role)&&(req.user.role!=='driver'||!x.driver_id||x.driver_id===req.user.driverId)).slice(0,100)));
app.patch('/api/notifications/:id/read',auth,async(req,res)=>{if(pool)await q('UPDATE notifications SET read=true WHERE id=$1',[req.params.id]);else{const n=memory.notifications.find(x=>x.id===req.params.id);if(n)n.read=true}res.json({success:true})});
app.post('/api/push/subscribe',auth,async(req,res)=>{if(pool)await q('INSERT INTO push_subscriptions(user_id,subscription) VALUES($1,$2)',[req.user.sub,req.body]);else memory.subscriptions.push({userId:req.user.sub,role:req.user.role,driverId:req.user.driverId||null,subscription:req.body});res.status(201).json({success:true})});
app.get('/api/config',auth,(req,res)=>res.json({vapidPublicKey:process.env.VAPID_PUBLIC_KEY||null,mapStyle:process.env.MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/liberty',providers:{whatsapp:Boolean(process.env.META_WHATSAPP_TOKEN),email:Boolean(process.env.RESEND_API_KEY),push:Boolean(process.env.VAPID_PUBLIC_KEY),telematics:Boolean(process.env.TELEMATICS_WEBHOOK_TOKEN),maps:'OpenFreeMap'}}));
app.post('/api/export/:kind',auth,async(req,res)=>{const title=String(req.body.title||req.params.kind).slice(0,80),columns=Array.isArray(req.body.columns)?req.body.columns:[],rows=Array.isArray(req.body.rows)?req.body.rows:[];if(!columns.length)return res.status(400).json({error:'Export columns required'});const book=new ExcelJS.Workbook();book.creator='Angermund Transport';book.created=new Date();const sheet=book.addWorksheet(title.slice(0,31)||'Export',{views:[{state:'frozen',ySplit:4}]});sheet.properties.defaultRowHeight=20;sheet.mergeCells(1,1,1,columns.length);const heading=sheet.getCell(1,1);heading.value=`Angermund Transport CC — ${title}`;heading.font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0B2035'}};heading.alignment={vertical:'middle'};sheet.getRow(1).height=30;sheet.mergeCells(2,1,2,columns.length);sheet.getCell(2,1).value=`Exported ${new Date().toLocaleString('en-NA',{timeZone:'Africa/Windhoek'})}`;sheet.getCell(2,1).font={name:'Aptos',size:10,italic:true,color:{argb:'FF5E7184'}};sheet.getRow(4).values=columns.map(c=>c.label);sheet.getRow(4).eachCell(c=>{c.font={name:'Aptos',bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1769AA'}};c.alignment={vertical:'middle',horizontal:'center'}});for(const source of rows){const values=columns.map(c=>source[c.key]??'');const row=sheet.addRow(values);row.eachCell((cell,index)=>{cell.font={name:'Aptos',size:10};cell.alignment={vertical:'middle',wrapText:false};const col=columns[index-1];if(col.type==='currency')cell.numFmt='N$ #,##0.00';else if(col.type==='number')cell.numFmt='#,##0.00';else if(col.type==='date'&&cell.value)cell.numFmt='yyyy-mm-dd'})}columns.forEach((c,i)=>{let width=Math.max(12,c.label.length+2);for(const row of rows.slice(0,200))width=Math.max(width,String(row[c.key]??'').length+2);sheet.getColumn(i+1).width=Math.min(42,width)});sheet.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,rows.length+4),column:columns.length}};sheet.getRow(rows.length+5).getCell(1).value=`${rows.length} record(s)`;sheet.getRow(rows.length+5).getCell(1).font={italic:true,color:{argb:'FF5E7184'}};const buffer=await book.xlsx.writeBuffer();res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${req.params.kind}-${new Date().toISOString().slice(0,10)}.xlsx"`});res.send(Buffer.from(buffer))});
app.post('/api/documents/scan',auth,upload.single('document'),async(req,res)=>{if(!req.file)return res.status(400).json({error:'Document image required'});const id=crypto.randomUUID(),row={id,user_id:req.user.sub,filename:req.file.originalname,status:'processing'};if(pool)await q('INSERT INTO scan_jobs(id,user_id,filename,status) VALUES($1,$2,$3,$4)',[id,row.user_id,row.filename,row.status]);else memory.scanJobs.push({...row,rawText:null,extracted:null,confidence:null,error:null,createdAt:new Date().toISOString(),completedAt:null});res.status(202).json({id,status:'processing'});(async()=>{try{const result=await recognizeReceiptBest(req.file.buffer);const raw=result.text||'',state=await readOpsState().catch(()=>({})),extracted=extractReceiptFields(raw,state);if(pool)await q('UPDATE scan_jobs SET status=$2,raw_text=$3,extracted=$4,confidence=$5,completed_at=now() WHERE id=$1',[id,'review',raw,extracted,result.confidence]);else{const m=memory.scanJobs.find(x=>x.id===id);if(m)Object.assign(m,{status:'review',rawText:raw,extracted,confidence:result.confidence,completedAt:new Date().toISOString()})}emit('scan',{id,status:'review',extracted,confidence:result.confidence,ocrMode:result.label})}catch(e){if(pool)await q('UPDATE scan_jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[id,'failed',e.message]);else{const m=memory.scanJobs.find(x=>x.id===id);if(m)Object.assign(m,{status:'failed',error:e.message,completedAt:new Date().toISOString()})}emit('scan',{id,status:'failed',error:e.message})}})()});
app.get('/api/documents/scans/:id',auth,async(req,res)=>{const row=pool?(await q('SELECT id,filename,status,raw_text AS "rawText",extracted,confidence,error,created_at AS "createdAt",completed_at AS "completedAt" FROM scan_jobs WHERE id=$1',[req.params.id]))[0]:memory.scanJobs.find(x=>x.id===req.params.id);if(!row)return res.status(404).json({error:'Scan not found'});res.json(row)});
app.post('/api/notifications/test',auth,roles('admin','manager'),async(req,res)=>res.status(201).json(await createNotification({type:'test',severity:'info',title:'Angermund Transport test alert',message:'Notification providers are connected and working.'})));
app.use(express.static(root,{maxAge:'1h',setHeaders:(res,file)=>{if(file.endsWith('.html'))res.setHeader('Cache-Control','no-cache')}}));app.use((req,res)=>res.sendFile(path.join(root,'index.html')));
initDb().then(()=>{if(process.argv.includes('--init-only'))return pool?.end();app.listen(PORT,()=>console.log(`Angermund Transport V3 running on port ${PORT}`))}).catch(e=>{console.error('Startup failed',e);process.exit(1)});
