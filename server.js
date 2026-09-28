const express=require('express'),path=require('path'),fs=require('fs'),crypto=require('crypto'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs'),multer=require('multer'),webpush=require('web-push'),ExcelJS=require('exceljs');
const {Pool}=require('pg');const {createWorker}=require('tesseract.js');
const app=express(),root=path.join(__dirname,'public'),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024}});
const PORT=process.env.PORT||3000,JWT_SECRET=process.env.JWT_SECRET||'development-only-change-before-production',DATABASE_URL=process.env.DATABASE_URL;
const num=value=>Number(value||0);

function jpegDimensions(buf){
  if(!Buffer.isBuffer(buf)||buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)return null;
  let i=2;
  while(i+9<buf.length){
    if(buf[i]!==0xff){i++;continue}
    while(i<buf.length&&buf[i]===0xff)i++;
    const marker=buf[i++];if(marker===0xd8||marker===0xd9)continue;
    if(i+1>=buf.length)break;
    const len=buf.readUInt16BE(i);if(len<2||i+len>buf.length)break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
      return{height:buf.readUInt16BE(i+3),width:buf.readUInt16BE(i+5)}
    }
    i+=len
  }
  return null
}
function jpegToPdfBuffer(jpeg){
  const dim=jpegDimensions(jpeg);if(!dim)return null;
  const pageW=595.28,pageH=841.89,margin=18,scale=Math.min((pageW-margin*2)/dim.width,(pageH-margin*2)/dim.height),drawW=dim.width*scale,drawH=dim.height*scale,x=(pageW-drawW)/2,y=(pageH-drawH)/2;
  const content=Buffer.from(`q
${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm
/Im0 Do
Q
`,'ascii');
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];let total=parts[0].length;
  const add=(n,chunks)=>{offsets[n]=total;const head=Buffer.from(n+' 0 obj\n','ascii'),tail=Buffer.from('\nendobj\n','ascii');parts.push(head,...chunks,tail);total+=head.length+chunks.reduce((a,b)=>a+b.length,0)+tail.length};
  add(1,[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>','ascii')]);
  add(2,[Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>','ascii')]);
  add(3,[Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,'ascii')]);
  add(4,[Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${dim.width} /Height ${dim.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,'ascii'),jpeg,Buffer.from('\nendstream','ascii')]);
  add(5,[Buffer.from(`<< /Length ${content.length} >>\nstream\n`,'ascii'),content,Buffer.from('endstream','ascii')]);
  const xrefAt=total,xref=['xref','0 6','0000000000 65535 f '];
  for(let n=1;n<=5;n++)xref.push(String(offsets[n]).padStart(10,'0')+' 00000 n ');
  xref.push('trailer','<< /Size 6 /Root 1 0 R >>','startxref',String(xrefAt),'%%EOF','');
  parts.push(Buffer.from(xref.join('\n'),'ascii'));
  return Buffer.concat(parts)
}
function archiveStoredFile(file){
  if(!file)return null;
  const mime=String(file.mimetype||'').toLowerCase(),name=String(file.originalname||'document');
  if(mime==='image/jpeg'||mime==='image/jpg'){
    const pdf=jpegToPdfBuffer(file.buffer);
    if(pdf)return{buffer:pdf,mimeType:'application/pdf',filename:name.replace(/\.[^.]+$/,'')+'.pdf',originalSize:file.buffer.length,size:pdf.length,convertedToPdf:true}
  }
  return{buffer:file.buffer,mimeType:file.mimetype||'application/octet-stream',filename:name,originalSize:file.buffer.length,size:file.buffer.length,convertedToPdf:false}
}function receiptOcrBuffer(buffer,mimeType=''){
  if(!Buffer.isBuffer(buffer))return buffer;
  if(!/pdf/i.test(String(mimeType||'')))return buffer;
  const marker=Buffer.from('/DCTDecode','ascii'),mi=buffer.indexOf(marker);if(mi<0)return buffer;
  let start=buffer.indexOf(Buffer.from('stream\n','ascii'),mi);let skip=7;
  if(start<0){start=buffer.indexOf(Buffer.from('stream\r\n','ascii'),mi);skip=8}
  if(start<0)return buffer;start+=skip;
  const end=buffer.indexOf(Buffer.from('\nendstream','ascii'),start);
  if(end<0)return buffer;
  const jpeg=buffer.subarray(start,end);return jpeg.length>4&&jpeg[0]===0xff&&jpeg[1]===0xd8?jpeg:buffer
}

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
  const amountCandidates=[...text.matchAll(/(?:N\$|NAD|R)?\s*(-?\d[\d ,.]*[.,]\d{2})/gi)].map(x=>x[1]);
  const fuelTransactions=[],seen=new Set();
  const fuelRow=/(\d{2,5}(?:[.,]\d{1,3})?)\s*\(\s*[LlI1]\s*\)\s*(\d{1,3}(?:[.,]\d{1,4})?)\s+(\d[\d ,]*[.,]\d{2})/i;

  for(let i=0;i<lines.length;i++){
    const candidates=[lines[i],i+1<lines.length?lines[i]+' '+lines[i+1]:''];
    for(const candidate of candidates){
      const m=candidate.match(fuelRow);
      if(!m)continue;
      const litres=toN(m[1]),ocrPrice=toN(m[2]),amount=toN(m[3]);
      if(!(litres>0&&litres<5000&&ocrPrice>5&&ocrPrice<100&&amount>10))continue;

      const calculatedPrice=amount/litres;
      const priceDiff=Math.abs(ocrPrice-calculatedPrice);
      const price=priceDiff>0.03&&calculatedPrice>5&&calculatedPrice<100?calculatedPrice:ocrPrice;
      const key=[litres.toFixed(3),amount.toFixed(2)].join('|');
      if(seen.has(key))continue;
      seen.add(key);
      fuelTransactions.push({
        litres:Number(litres.toFixed(3)),
        pricePerLitre:Number(price.toFixed(4)),
        amount:Number(amount.toFixed(2)),
        ocrPricePerLitre:Number(ocrPrice.toFixed(4)),
        priceCorrected:Math.abs(price-ocrPrice)>=0.005
      });
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
  if(litres>0&&suggestedAmount>0){
    const combined=suggestedAmount/litres;
    if(combined>5&&combined<100)pricePerLitre=combined;
  }else if(!(pricePerLitre>0)&&lineLitres>0&&lineAmount>0)pricePerLitre=lineAmount/lineLitres;

  const adjustment=printedTotal!==null&&lineAmount>0?Number((printedTotal-lineAmount).toFixed(2)):null;
  const totalDifference=printedTotal!==null&&lineAmount>0?Math.abs(printedTotal-lineAmount):0;
  const totalTolerance=printedTotal!==null?Math.max(0.25,Math.abs(printedTotal)*0.005):0;
  const totalsReconcile=!(printedTotal!==null&&lineAmount>0)||totalDifference<=totalTolerance;
  const lineMathOk=fuelTransactions.every(x=>Math.abs(x.litres*x.pricePerLitre-x.amount)<=Math.max(0.25,x.amount*0.003));
  const needsReview=!totalsReconcile||!lineMathOk;

  const odometerMatch=text.match(/ODOMETER\s*[:#-]?\s*(\d{4,9})/i);
  const supplier=receiptSupplier(text);
  const facts={litres,pricePerLitre,suggestedAmount};
  let classification=classifyReceipt(text,supplier,state,facts);
  if(needsReview&&classification.category==='Diesel')classification={...classification,confidence:Math.min(classification.confidence,84),reason:'Diesel detected, but receipt totals need review'};

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
    totalsReconcile,
    totalDifference:Number(totalDifference.toFixed(2)),
    needsReview,
    category:classification.category,
    categoryConfidence:classification.confidence,
    categoryReason:classification.reason,
    categorySource:classification.source,
    requiresManualAmountConfirmation:needsReview||!(printedTotal>0||lineAmount>0)
  };
}

function receiptExtractionScore(x){
  if(!x)return -999;
  let score=0;
  if(x.category&&x.category!=='Other')score+=35;
  score+=Math.min(35,num(x.categoryConfidence)*.35);
  if(Array.isArray(x.fuelTransactions))score+=Math.min(45,x.fuelTransactions.length*22);
  if(num(x.litres)>0)score+=20;
  if(num(x.suggestedAmount)>0)score+=18;
  if(num(x.printedTotal)>0)score+=18;
  if(num(x.pricePerLitre)>5&&num(x.pricePerLitre)<100)score+=14;
  if(x.totalsReconcile===true)score+=28;
  if(x.needsReview===true)score-=10;
  if(x.supplier)score+=8;
  if(x.odometer)score+=5;
  return score;
}
function mergeReceiptExtractions(candidates){
  const valid=(candidates||[]).filter(Boolean).sort((a,b)=>receiptExtractionScore(b)-receiptExtractionScore(a));
  if(!valid.length)return{};
  const out=JSON.parse(JSON.stringify(valid[0]));
  for(const c of valid.slice(1)){
    for(const key of ['supplier','documentNumber','date','registration','odometer','printedTotal','suggestedAmount','litres','pricePerLitre']){
      if((out[key]===null||out[key]===undefined||out[key]===''||num(out[key])===0)&&(c[key]!==null&&c[key]!==undefined&&c[key]!==''))out[key]=c[key];
    }
    if((!out.category||out.category==='Other')&&c.category&&c.category!=='Other'){
      out.category=c.category;out.categoryConfidence=c.categoryConfidence;out.categoryReason=c.categoryReason;out.categorySource=c.categorySource;
    }
  }
  const fuelCandidates=valid.filter(c=>Array.isArray(c.fuelTransactions)&&c.fuelTransactions.length);
  if(fuelCandidates.length){
    fuelCandidates.sort((a,b)=>{
      const ar=(a.totalsReconcile===true?100:0)+(a.fuelTransactions?.length||0)*20+(num(a.printedTotal)>0?15:0);
      const br=(b.totalsReconcile===true?100:0)+(b.fuelTransactions?.length||0)*20+(num(b.printedTotal)>0?15:0);
      return br-ar;
    });
    const fuel=fuelCandidates[0];
    for(const key of ['fuelTransactions','fuelTransactionCount','fuelLineAmount','litres','pricePerLitre','printedTotal','suggestedAmount','adjustment','totalsReconcile','totalDifference','needsReview']){
      if(fuel[key]!==undefined)out[key]=JSON.parse(JSON.stringify(fuel[key]));
    }
    if(!out.category||out.category==='Other'){out.category='Diesel';out.categoryConfidence=Math.max(96,num(fuel.categoryConfidence));out.categoryReason='Fuel line-items detected across OCR passes';out.categorySource='merged-ocr'}
  }
  out.categoryConfidence=Math.max(num(out.categoryConfidence),...valid.filter(c=>c.category===out.category).map(c=>num(c.categoryConfidence)));
  out.ocrCandidates=valid.length;
  return out;
}
async function recognizeReceiptBest(buffer){
  const worker=await createWorker('eng');
  const passes=[
    {psm:'3',label:'auto-layout'},
    {psm:'4',label:'single-column'},
    {psm:'6',label:'receipt-block'},
    {psm:'11',label:'sparse-text'}
  ];
  const results=[];
  try{
    for(const pass of passes){
      await worker.setParameters({tessedit_pageseg_mode:pass.psm,preserve_interword_spaces:'1',user_defined_dpi:'300'});
      const r=await worker.recognize(buffer);
      const text=r.data.text||'';
      results.push({text,confidence:Number(r.data.confidence||0),score:scoreReceiptText(text),label:pass.label});
    }
  }finally{await worker.terminate()}
  results.sort((a,b)=>(b.score+b.confidence*.18)-(a.score+a.confidence*.18));
  return{best:results[0]||{text:'',confidence:0,score:0,label:'none'},results};
}

if(!DATABASE_URL)console.warn('DATABASE_URL missing: using development memory store. Set PostgreSQL for multi-device persistence.');
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(DATABASE_URL)?false:{rejectUnauthorized:false}}):null;
const memory={state:null,users:[],gps:[],geofences:[],notifications:[],subscriptions:[],uploads:[],tripDocuments:[],mobileDevices:[],scanJobs:[]};const clients=new Set();
app.use(express.json({limit:'10mb'}));app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','geolocation=(self), camera=(self)');next()});
const q=async(text,params=[])=>pool?(await pool.query(text,params)).rows:null;
async function initDb(){if(pool){await pool.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,name text NOT NULL,role text NOT NULL CHECK(role IN ('admin','manager','dispatcher','driver','warehouse','workshop','finance')),driver_id text,active boolean DEFAULT true,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app_state(id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),payload jsonb NOT NULL DEFAULT '{}'::jsonb,revision bigint NOT NULL DEFAULT 0,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS gps_positions(id bigserial PRIMARY KEY,vehicle_id text NOT NULL,driver_id text,trip_id text,latitude double precision NOT NULL,longitude double precision NOT NULL,speed double precision DEFAULT 0,heading double precision DEFAULT 0,accuracy double precision,source text DEFAULT 'driver',recorded_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS gps_vehicle_time ON gps_positions(vehicle_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS geofences(id uuid PRIMARY KEY,name text NOT NULL,latitude double precision NOT NULL,longitude double precision NOT NULL,radius_m double precision NOT NULL,event_types text[] DEFAULT ARRAY['enter','exit'],kind text DEFAULT 'custom',active boolean DEFAULT true,created_at timestamptz DEFAULT now());
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS kind text DEFAULT 'custom';
CREATE TABLE IF NOT EXISTS geofence_state(vehicle_id text NOT NULL,geofence_id uuid REFERENCES geofences(id) ON DELETE CASCADE,inside boolean NOT NULL,updated_at timestamptz DEFAULT now(),PRIMARY KEY(vehicle_id,geofence_id));
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,type text NOT NULL,severity text DEFAULT 'info',title text NOT NULL,message text NOT NULL,role text,driver_id text,linked_type text,linked_id text,read boolean DEFAULT false,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS push_subscriptions(id bigserial PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE CASCADE,subscription jsonb NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS scan_jobs(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),filename text,status text NOT NULL DEFAULT 'processing',raw_text text,extracted jsonb,confidence double precision,error text,created_at timestamptz DEFAULT now(),completed_at timestamptz);\nCREATE TABLE IF NOT EXISTS driver_uploads(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,trip_id text NOT NULL,kind text NOT NULL,filename text NOT NULL,mime_type text NOT NULL,content bytea NOT NULL,created_at timestamptz DEFAULT now());\nCREATE TABLE IF NOT EXISTS trip_documents(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,trip_id text NOT NULL,leg_id text,kind text NOT NULL,reference text,filename text,mime_type text,content bytea,created_at timestamptz DEFAULT now());\nCREATE INDEX IF NOT EXISTS trip_documents_trip ON trip_documents(trip_id,created_at DESC);\nCREATE TABLE IF NOT EXISTS mobile_devices(id uuid PRIMARY KEY,device_id text UNIQUE NOT NULL,user_id uuid REFERENCES users(id) ON DELETE CASCADE,driver_id text NOT NULL,token_hash text UNIQUE NOT NULL,name text,platform text,active boolean DEFAULT true,last_seen timestamptz,created_at timestamptz DEFAULT now());\nCREATE INDEX IF NOT EXISTS mobile_devices_driver ON mobile_devices(driver_id,active);\nALTER TABLE notifications ADD COLUMN IF NOT EXISTS driver_id text;\nCREATE INDEX IF NOT EXISTS driver_uploads_trip ON driver_uploads(trip_id,created_at DESC);`);
 const email=(process.env.INITIAL_ADMIN_EMAIL||'admin@angermund.local').toLowerCase(),pass=process.env.INITIAL_ADMIN_PASSWORD||'ChangeMe123!';const found=await q('SELECT id FROM users WHERE email=$1',[email]);if(!found.length)await q('INSERT INTO users(id,email,password_hash,name,role) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),email,await bcrypt.hash(pass,12),'System Administrator','admin']);await q("INSERT INTO app_state(id,payload) VALUES(1,'{}') ON CONFLICT(id) DO NOTHING");
 }else if(!memory.users.length)memory.users.push({id:crypto.randomUUID(),email:(process.env.INITIAL_ADMIN_EMAIL||'admin@angermund.local').toLowerCase(),password_hash:await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD||'ChangeMe123!',10),name:'System Administrator',role:'admin',active:true});
 if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:angermundtransport@iway.na',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
}
function tokenFor(u){return jwt.sign({sub:u.id,email:u.email,name:u.name,role:u.role,driverId:u.driver_id||u.driverId||null},JWT_SECRET,{expiresIn:'12h'})}
function auth(req,res,next){const raw=req.headers.authorization?.replace(/^Bearer\s+/i,'')||req.query.token;if(!raw)return res.status(401).json({error:'Authentication required'});try{req.user=jwt.verify(raw,JWT_SECRET);next()}catch{return res.status(401).json({error:'Invalid or expired session'})}}
const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'Insufficient permission'});
const deviceTokenHash=raw=>crypto.createHash('sha256').update(String(raw||'')).digest('hex');
async function deviceAuth(req,res,next){
  const raw=String(req.headers['x-device-token']||'');if(!raw)return res.status(401).json({error:'Device authentication required'});
  const hash=deviceTokenHash(raw);let d,u;
  if(pool){
    d=(await q('SELECT id,device_id AS "deviceId",user_id AS "userId",driver_id AS "driverId",name,platform,active FROM mobile_devices WHERE token_hash=$1 AND active=true',[hash]))[0];
    if(d)u=(await q('SELECT id,email,name,role,driver_id AS "driverId",active FROM users WHERE id=$1 AND active=true',[d.userId]))[0]
  }else{
    d=memory.mobileDevices.find(x=>x.tokenHash===hash&&x.active);u=d?memory.users.find(x=>x.id===d.userId&&x.active):null
  }
  if(!d||!u||u.role!=='driver')return res.status(401).json({error:'Invalid or inactive device'});
  req.device=d;req.user={sub:u.id,email:u.email,name:u.name,role:u.role,driverId:u.driverId||u.driver_id||d.driverId};
  if(pool)q('UPDATE mobile_devices SET last_seen=now() WHERE id=$1',[d.id]).catch(()=>{});else d.lastSeen=new Date().toISOString();
  next()
}
function emit(type,data){const msg=`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of clients)res.write(msg)}
const distance=(a,b)=>{const R=6371000,p=x=>x*Math.PI/180,dLat=p(b.latitude-a.latitude),dLon=p(b.longitude-a.longitude),x=Math.sin(dLat/2)**2+Math.cos(p(a.latitude))*Math.cos(p(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))};
async function createNotification(n){const row={id:crypto.randomUUID(),type:n.type||'system',severity:n.severity||'info',title:n.title,message:n.message,role:n.role||null,driver_id:n.driverId||null,linked_type:n.linkedType||null,linked_id:n.linkedId||null,read:false,created_at:new Date().toISOString()};if(pool)await q('INSERT INTO notifications(id,type,severity,title,message,role,driver_id,linked_type,linked_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,row.type,row.severity,row.title,row.message,row.role,row.driver_id,row.linked_type,row.linked_id]);else memory.notifications.unshift(row);emit('notification',row);await sendExternal(row);return row}
async function sendExternal(n){
  const tasks=[];
  if(n.role!=='driver'&&process.env.RESEND_API_KEY&&process.env.ALERT_EMAIL_TO)tasks.push(fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Angermund Alerts <alerts@resend.dev>',to:[process.env.ALERT_EMAIL_TO],subject:n.title,html:`<h2>${n.title}</h2><p>${n.message}</p>`})}));
  if(n.role!=='driver'&&process.env.META_WHATSAPP_TOKEN&&process.env.META_PHONE_NUMBER_ID&&process.env.WHATSAPP_ALERT_TO)tasks.push(fetch(`https://graph.facebook.com/v21.0/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:process.env.WHATSAPP_ALERT_TO,type:'text',text:{body:`${n.title}\n${n.message}`}})}));
  let subs=[];
  if(pool){
    if(n.driver_id)subs=await q('SELECT ps.id,ps.subscription FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.active=true AND u.driver_id=$1',[n.driver_id]);
    else if(n.role)subs=await q('SELECT ps.id,ps.subscription FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.active=true AND u.role=$1',[n.role]);
    else subs=await q('SELECT id,subscription FROM push_subscriptions');
  }else subs=memory.subscriptions.filter(x=>!n.driver_id||x.driverId===n.driver_id);
  if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY){
    for(const row of subs)tasks.push((async()=>{
      try{return await webpush.sendNotification(row.subscription||row,JSON.stringify({title:n.title,body:n.message,linkedType:n.linked_type,linkedId:n.linked_id,url:'/'}))}
      catch(e){
        const code=num(e.statusCode);
        if(code===404||code===410){
          if(pool&&row.id)await q('DELETE FROM push_subscriptions WHERE id=$1',[row.id]);
          else memory.subscriptions=memory.subscriptions.filter(x=>x!==row);
        }else console.error('Web Push failed',code||'',e.message);
        return null
      }
    })())
  }
  await Promise.allSettled(tasks);
}
async function evaluateGeofences(pos){
  if(!trustedVehicleGpsSource(pos.source))return;
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
function normalizedGeofenceKind(f){
  const kind=String(f?.kind||'').trim().toLowerCase(),name=String(f?.name||'').trim().toLowerCase();
  if(kind==='depot')return 'depot';
  if(/angermund\s*transport|company\s*depot|main\s*depot|home\s*yard/.test(name))return 'depot';
  if(kind==='loading'||kind==='offloading'||kind==='operating_area'||kind==='custom')return kind;
  return 'custom'
}
function geofenceInside(pos,f,extra=0){
  if(!pos||!f)return false;
  const radius=Math.max(5,num(f.radius_m||f.radiusM)||500)+Math.max(0,num(extra));
  return distance(pos,{latitude:num(f.latitude),longitude:num(f.longitude)})<=radius
}
function depotGeofenceForTrip(fences,zones){
  const depots=(fences||[]).filter(f=>f.active!==false&&normalizedGeofenceKind(f)==='depot');
  if(!depots.length)return null;
  return depots.sort((a,b)=>distance(zones.load,{latitude:num(a.latitude),longitude:num(a.longitude)})-distance(zones.load,{latitude:num(b.latitude),longitude:num(b.longitude)}))[0]
}
function operatingAreaForTrip(fences,zones,depot){
  const areas=(fences||[]).filter(f=>f.active!==false&&normalizedGeofenceKind(f)==='operating_area');
  if(!areas.length)return null;
  const anchor=depot?{latitude:num(depot.latitude),longitude:num(depot.longitude)}:zones.load;
  const containing=areas.filter(a=>geofenceInside(anchor,a));
  const pool=containing.length?containing:areas;
  return pool.sort((a,b)=>distance(anchor,{latitude:num(a.latitude),longitude:num(a.longitude)})-distance(anchor,{latitude:num(b.latitude),longitude:num(b.longitude)}))[0]
}
function trustedVehicleGpsSource(source){return ['telematics','truck-device','tracker','vehicle-tracker'].includes(String(source||'').toLowerCase())}
async function previousVehiclePosition(pos){
  if(pool){
    return (await q('SELECT latitude,longitude,recorded_at AS "recordedAt" FROM gps_positions WHERE vehicle_id=$1 AND recorded_at<$2 ORDER BY recorded_at DESC LIMIT 1',[pos.vehicleId,pos.recordedAt]))[0]||null
  }
  const at=new Date(pos.recordedAt).getTime();
  return memory.gps.filter(x=>x.vehicleId===pos.vehicleId&&new Date(x.recordedAt).getTime()<at).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt))[0]||null
}
function geofenceWordSet(v){
  return new Set(String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(w=>w.length>=4&&!['limited','company','loading','offloading','depot','zone','site','transport'].includes(w)))
}
function geofenceNameMatches(a,b){
  const aa=String(a||'').trim().toLowerCase(),bb=String(b||'').trim().toLowerCase();
  if(!aa||!bb)return false;
  if(aa===bb||aa.includes(bb)||bb.includes(aa))return true;
  const aw=geofenceWordSet(aa),bw=geofenceWordSet(bb);
  for(const w of aw)if(bw.has(w))return true;
  return false
}
async function operationalGeofences(activeOnly=false){
  if(pool)return q('SELECT id,name,latitude,longitude,radius_m AS "radiusM",event_types AS "eventTypes",kind,active FROM geofences '+(activeOnly?'WHERE active=true ':'')+'ORDER BY name');
  return memory.geofences.filter(x=>!activeOnly||x.active!==false)
}
async function ensureOperationalGeofence({name,latitude,longitude,kind='custom',radiusM=500,aliases=[]}){
  const lat=Number(latitude),lon=Number(longitude),hasPoint=Number.isFinite(lat)&&Number.isFinite(lon)&&!(lat===0&&lon===0),wanted=String(name||'').trim();
  const fences=await operationalGeofences(false),names=[wanted,...aliases].filter(Boolean);
  let existing=null;
  if(hasPoint){
    existing=fences.find(f=>f.active!==false&&distance({latitude:lat,longitude:lon},{latitude:num(f.latitude),longitude:num(f.longitude)})<=Math.max(100,Math.min(300,num(f.radiusM||f.radius_m)||500)));
  }
  if(!existing&&!hasPoint)existing=fences.find(f=>f.active!==false&&names.some(n=>geofenceNameMatches(f.name,n)));
  if(existing)return existing;
  if(!hasPoint)return null;
  const f={id:crypto.randomUUID(),name:wanted||'Trip site',latitude:lat,longitude:lon,radiusM:Math.max(25,num(radiusM)||500),eventTypes:['enter','exit'],kind:['depot','loading','offloading','custom'].includes(kind)?kind:'custom',active:true};
  if(pool)await q('INSERT INTO geofences(id,name,latitude,longitude,radius_m,event_types,kind) VALUES($1,$2,$3,$4,$5,$6,$7)',[f.id,f.name,f.latitude,f.longitude,f.radiusM,f.eventTypes,f.kind]);
  else memory.geofences.push(f);
  emit('geofence',f);
  return f
}
function linkedTripZones(route,leg,trip,fences){
  const base=routeTripZones(route),loadId=leg?.loadingGeofenceId||trip?.loadingGeofenceId,offId=leg?.offloadingGeofenceId||trip?.offloadingGeofenceId;
  const loadFence=(fences||[]).find(f=>String(f.id)===String(loadId)),offFence=(fences||[]).find(f=>String(f.id)===String(offId));
  const load=loadFence?{latitude:num(loadFence.latitude),longitude:num(loadFence.longitude),name:String(loadFence.name||base?.load?.name||'Loading point')}:base?.load;
  const offload=offFence?{latitude:num(offFence.latitude),longitude:num(offFence.longitude),name:String(offFence.name||base?.offload?.name||'Offloading point')}:base?.offload;
  if(!load||!offload)return null;
  const approachKm=Math.max(2,Math.min(5,num(route?.approachKm)||5)),arrivalKm=Math.max(.5,Math.min(approachKm-.25,num(route?.arrivalKm)||2));
  return{load,offload,approachM:approachKm*1000,arrivalM:arrivalKm*1000,departM:Math.min(approachKm*1000,Math.max(arrivalKm*1000+500,arrivalKm*1250)),roundTrip:Boolean(route?.roundTrip)||/[↔]|round\s*trip|return/i.test(String(route?.name||'')+' '+String(route?.notes||''))}
}
async function linkTripLegGeofences(tripId,legId){
  const snapshot=await readOpsState(),t=(snapshot.trips||[]).find(x=>x.id===tripId);
  if(!t)return null;
  const legs=ensureTripLegs(snapshot,t),leg=legId?legs.find(x=>x.id===legId):legs[0],route=(snapshot.routes||[]).find(x=>x.id===(leg?.routeId||t.routeId)),client=(snapshot.clients||[]).find(x=>x.id===(leg?.clientId||t.clientId));
  if(!leg||!route)return null;
  const all=await operationalGeofences(false);
  const routeLoadLat=Number(route.loadLat),routeLoadLon=Number(route.loadLon),routeOffLat=Number(route.offloadLat),routeOffLon=Number(route.offloadLon);
  const loadPointOk=Number.isFinite(routeLoadLat)&&Number.isFinite(routeLoadLon)&&!(routeLoadLat===0&&routeLoadLon===0),offPointOk=Number.isFinite(routeOffLat)&&Number.isFinite(routeOffLon)&&!(routeOffLat===0&&routeOffLon===0);
  const existingLoad=!loadPointOk?all.find(f=>f.active!==false&&[route.loadName,client?.name].filter(Boolean).some(n=>geofenceNameMatches(f.name,n))):null;
  const existingOff=!offPointOk?all.find(f=>f.active!==false&&[route.offloadName,route.name].filter(Boolean).some(n=>geofenceNameMatches(f.name,n))&&(!existingLoad||f.id!==existingLoad.id)):null;
  const load=existingLoad||await ensureOperationalGeofence({name:String(route.loadName||client?.name||'Loading point'),latitude:routeLoadLat,longitude:routeLoadLon,kind:'loading',radiusM:Math.max(250,num(route.loadingRadiusM)||500),aliases:[client?.name,route.name]});
  const offload=existingOff||await ensureOperationalGeofence({name:String(route.offloadName||'Offloading point'),latitude:routeOffLat,longitude:routeOffLon,kind:'offloading',radiusM:Math.max(250,num(route.offloadingRadiusM)||500),aliases:[route.offloadName]});
  const linked=await mutateOpsState(state=>{
    const trip=(state.trips||[]).find(x=>x.id===tripId);if(!trip)return null;
    const tripLegsNow=ensureTripLegs(state,trip),target=tripLegsNow.find(x=>x.id===leg.id);if(!target)return null;
    target.loadingGeofenceId=load?.id||'';target.loadingGeofenceName=load?.name||'';
    target.offloadingGeofenceId=offload?.id||'';target.offloadingGeofenceName=offload?.name||'';
    target.geofenceLinkStatus=load&&offload?'Linked':(load||offload?'Partial':'Setup needed');
    target.geofenceLinkedAt=new Date().toISOString();
    if(target===tripLegsNow[0]){
      trip.loadingGeofenceId=target.loadingGeofenceId;trip.loadingGeofenceName=target.loadingGeofenceName;
      trip.offloadingGeofenceId=target.offloadingGeofenceId;trip.offloadingGeofenceName=target.offloadingGeofenceName;
      trip.geofenceLinkStatus=target.geofenceLinkStatus;trip.geofenceLinkedAt=target.geofenceLinkedAt
    }
    state.audit??=[];
    state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:'System',action:'GPS geofences '+target.geofenceLinkStatus.toLowerCase()+' for '+trip.number+' · '+(target.label||'Leg '+target.sequence),linkedType:'trip',linkedId:trip.id});
    state.audit=state.audit.slice(0,100);
    return{tripId:trip.id,legId:target.id,status:target.geofenceLinkStatus,loading:load?{id:load.id,name:load.name}:null,offloading:offload?{id:offload.id,name:offload.name}:null}
  });
  return{...linked.result,revision:linked.revision}
}
async function tripGeoNotify(trip,title,message,severity='info'){
  await Promise.allSettled([
    createNotification({type:'trip-geofence',severity,title,message,role:'driver',driverId:trip.driverId,linkedType:'trip',linkedId:trip.id}),
    createNotification({type:'trip-geofence',severity,title,message,role:'dispatcher',linkedType:'trip',linkedId:trip.id})
  ]);
}
function serverTripPriority(t){
  const status=String(t?.status||'').toLowerCase();
  if(/loading|to loading|loaded|departure pending|in transit|at loading|at offloading|awaiting pod|return journey/.test(status))return 500;
  if(/planned|assigned|booked/.test(status))return 400;
  if(/delivered/.test(status)&&!t.driverComplete)return 200;
  return 100
}
async function evaluateTripZones(pos){
  if(!trustedVehicleGpsSource(pos.source))return;
  const snapshot=await readOpsState();
  const active=(snapshot.trips||[]).filter(t=>t.truckId===pos.vehicleId&&!t.driverComplete&&!['Closed','Invoiced'].includes(t.status)).sort((a,b)=>{const p=serverTripPriority(b)-serverTripPriority(a);if(p)return p;return new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0)})[0];
  if(!active)return;
  const activeLeg=activeTripLegServer(active),route=(snapshot.routes||[]).find(r=>r.id===(activeLeg?.routeId||active.routeId)),multi=Array.isArray(active.legs)&&active.legs.length>1;
  const fences=await operationalGeofences(true),zones=linkedTripZones(route,activeLeg,active,fences);
  if(!zones)return;
  const depot=depotGeofenceForTrip(fences,zones),operatingArea=operatingAreaForTrip(fences,zones,depot),prevPos=(depot||operatingArea)?await previousVehiclePosition(pos):null;
  const preliminaryGeo=activeLeg?.geo||active.geo||{},loadM=distance(pos,zones.load),offM=distance(pos,zones.offload);
  const started=Boolean(preliminaryGeo.tripStartedAt||active.startedAt||String(activeLeg?.status||'').toLowerCase()==='in transit'||(!multi&&(num(active.stage)>=3||['In transit','At offloading','Return journey','Delivered','Returned'].includes(active.status))));
  const depotM=depot?distance(pos,{latitude:num(depot.latitude),longitude:num(depot.longitude)}):Infinity;
  const prevDepotM=depot&&prevPos?distance(prevPos,{latitude:num(depot.latitude),longitude:num(depot.longitude)}):Infinity;
  const prevOffM=prevPos?distance(prevPos,zones.offload):Infinity;
  const depotInside=depot?geofenceInside(pos,depot):false,prevDepotInside=depot&&prevPos?geofenceInside(prevPos,depot):false;
  const areaInside=operatingArea?geofenceInside(pos,operatingArea):false,prevAreaInside=operatingArea&&prevPos?geofenceInside(prevPos,operatingArea):false;
  const movingTowardOffload=Boolean(prevPos)&&offM+75<prevOffM;
  const movingTowardDepot=Boolean(prevPos)&&depotM+75<prevDepotM;
  const directDeparture=Boolean(depot&&preliminaryGeo.loadDepartedAt&&!preliminaryGeo.loadedAtDepotAt&&!started&&!depotInside&&loadM>=zones.departM&&movingTowardOffload&&!movingTowardDepot);
  const depotReturn=Boolean(depot&&preliminaryGeo.loadDepartedAt&&!started&&depotInside&&!preliminaryGeo.loadedAtDepotAt);
  const depotExit=Boolean(depot&&preliminaryGeo.loadedAtDepotAt&&!started&&!depotInside&&(prevDepotInside||depotM>(Math.max(5,num(depot.radius_m||depot.radiusM)||500)+100)));
  const loadConfirmed=Boolean(preliminaryGeo.loadArrivedAt||preliminaryGeo.loadDepartedAt||preliminaryGeo.loadedAtDepotAt||/loaded|at loading|departure pending/i.test(String(active.status||'')));
  const areaExit=Boolean(operatingArea&&loadConfirmed&&!started&&prevAreaInside&&!areaInside);
  const collectionExit=Boolean(depot&&!preliminaryGeo.loadArrivedAt&&!started&&prevDepotInside&&!depotInside&&!preliminaryGeo.collectionDepartedAt);
  const possible=
    collectionExit||
    (!started&&!preliminaryGeo.loadApproachAt&&loadM<=zones.approachM)||
    (!started&&!preliminaryGeo.loadArrivedAt&&loadM<=zones.arrivalM)||
    (preliminaryGeo.loadArrivedAt&&!preliminaryGeo.loadDepartedAt&&loadM>=zones.departM)||
    depotReturn||depotExit||directDeparture||areaExit||
    (started&&!preliminaryGeo.offloadApproachAt&&offM<=zones.approachM)||
    (started&&!preliminaryGeo.offloadArrivedAt&&offM<=zones.arrivalM)||
    (preliminaryGeo.offloadArrivedAt&&!preliminaryGeo.offloadDepartedAt&&offM>=zones.departM)||
    (!multi&&zones.roundTrip&&preliminaryGeo.offloadDepartedAt&&!preliminaryGeo.returnApproachAt&&loadM<=zones.approachM)||
    (!multi&&zones.roundTrip&&preliminaryGeo.returnApproachAt&&!preliminaryGeo.returnArrivedAt&&loadM<=zones.arrivalM);
  if(!possible)return;

  const changed=await mutateOpsState(async state=>{
    const t=(state.trips||[]).find(x=>x.id===active.id),currentLeg=t?activeTripLegServer(t):null,r=(state.routes||[]).find(x=>x.id===(currentLeg?.routeId||active.routeId)),z=linkedTripZones(r,currentLeg,t,fences),multiLeg=Array.isArray(t?.legs)&&t.legs.length>1;
    if(!t||!z)return{events:[]};
    if(currentLeg)currentLeg.geo??={};else t.geo??={};
    state.tasks??=[];state.trucks??=[];state.drivers??=[];
    const g=currentLeg?currentLeg.geo:t.geo,now=new Date().toISOString(),lm=distance(pos,z.load),om=distance(pos,z.offload),events=[],km=m=>(m/1000).toFixed(1);
    const dep=depotGeofenceForTrip(fences,z),area=operatingAreaForTrip(fences,z,dep),depInside=dep?geofenceInside(pos,dep):false,prevDepInside=dep&&prevPos?geofenceInside(prevPos,dep):false;
    const areaInsideNow=area?geofenceInside(pos,area):false,prevAreaInsideNow=area&&prevPos?geofenceInside(prevPos,area):false;
    const depM=dep?distance(pos,{latitude:num(dep.latitude),longitude:num(dep.longitude)}):Infinity;
    const prevDepM=dep&&prevPos?distance(prevPos,{latitude:num(dep.latitude),longitude:num(dep.longitude)}):Infinity;
    const previousOffM=prevPos?distance(prevPos,z.offload):Infinity;
    const statusStarted=()=>Boolean(g.tripStartedAt||t.startedAt||String(currentLeg?.status||'').toLowerCase()==='in transit'||(!multiLeg&&(num(t.stage)>=3||['In transit','At offloading','Return journey','Delivered','Returned'].includes(t.status))));
    const startTrip=(reason,at=now)=>{
      if(statusStarted())return false;
      g.tripStartedAt=at;g.tripStartReason=reason;
      t.stage=Math.max(3,num(t.stage)||1);t.status='In transit';t.startedAt=t.startedAt||at;
      if(currentLeg){currentLeg.status='In transit';currentLeg.startedAt=currentLeg.startedAt||at}
      const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='On trip';
      const dr=state.drivers.find(x=>x.id===t.driverId);if(dr)dr.status='On trip';
      return true
    };
    if((num(t.stage)>=3||t.startedAt||['In transit','At offloading','Return journey','Delivered','Returned'].includes(t.status))&&!g.tripStartedAt)g.tripStartedAt=t.startedAt||now;

    if(dep&&!g.loadArrivedAt&&!statusStarted()&&!g.collectionDepartedAt&&prevDepInside&&!depInside){
      g.collectionDepartedAt=now;g.collectionDeparturePosition={latitude:pos.latitude,longitude:pos.longitude};
      t.stage=Math.max(2,num(t.stage)||1);t.status='To loading';if(currentLeg)currentLeg.status='To loading';
      events.push({title:t.number+' truck collected',message:pos.vehicleId+' left '+dep.name+' and is heading to the loading point. The transport trip has not started yet.'})
    }
    if(!statusStarted()&&!g.loadApproachAt&&lm<=z.approachM){
      g.loadApproachAt=now;
      events.push({title:t.number+' approaching loading point',message:pos.vehicleId+' is '+km(lm)+' km from '+z.load.name+'.'})
    }
    if(!statusStarted()&&!g.loadArrivedAt&&lm<=z.arrivalM){
      g.loadArrivedAt=now;g.loadArrivalPosition={latitude:pos.latitude,longitude:pos.longitude};g.loadWasAtDepot=Boolean(dep&&depInside);
      t.stage=Math.max(2,num(t.stage)||1);t.status='At loading';if(currentLeg)currentLeg.status='At loading';
      events.push({title:t.number+' arrived at loading',message:pos.vehicleId+' arrived at '+z.load.name+' ('+km(lm)+' km from pin).'})
    }
    if(g.loadArrivedAt&&!g.loadDepartedAt&&lm>=z.departM){
      g.loadDepartedAt=now;g.departurePendingAt=now;g.loadDeparturePosition={latitude:pos.latitude,longitude:pos.longitude};g.offloadDistanceAtLoadDepartureKm=Number((om/1000).toFixed(2));
      if(area){
        t.stage=Math.max(2,num(t.stage)||1);t.status='Loaded · departure pending';if(currentLeg)currentLeg.status='Loaded · departure pending';
        events.push({title:t.number+' loading complete',message:pos.vehicleId+' left '+z.load.name+' loaded. Trip remains staged until the truck exits '+area.name+'.'})
      }else if(!dep){
        if(startTrip('loading-exit',now))events.push({title:t.number+' trip started',message:pos.vehicleId+' left '+z.load.name+'. No company operating-area geofence is configured, so the trip changed to In transit.'})
      }else if(g.loadWasAtDepot&&prevDepInside&&!depInside){
        g.loadedAtDepotAt=g.loadedAtDepotAt||g.loadArrivedAt;
        if(startTrip('loaded-depot-exit',now))events.push({title:t.number+' departed '+dep.name,message:pos.vehicleId+' left the company depot loaded. No city operating-area geofence is configured, so this is the trip start.'})
      }else{
        t.stage=Math.max(2,num(t.stage)||1);t.status='Loaded · departure pending';if(currentLeg)currentLeg.status='Loaded · departure pending';
        events.push({title:t.number+' loading complete',message:pos.vehicleId+' left '+z.load.name+' loaded. The system is waiting to confirm route departure.'})
      }
    }

    if(dep&&g.loadDepartedAt&&!statusStarted()&&depInside&&!g.loadedAtDepotAt){
      g.loadedAtDepotAt=now;g.loadedDepotArrivalPosition={latitude:pos.latitude,longitude:pos.longitude};
      t.stage=Math.max(2,num(t.stage)||1);t.status='Loaded at depot';if(currentLeg)currentLeg.status='Loaded at depot';
      events.push({title:t.number+' loaded truck back at depot',message:pos.vehicleId+' returned to '+dep.name+' after loading. Trip remains staged and has NOT started.'})
    }
    if(dep&&g.loadedAtDepotAt&&!statusStarted()&&!depInside&&(prevDepInside||depM>(Math.max(5,num(dep.radius_m||dep.radiusM)||500)+100))){
      g.loadedDepotDepartedAt=now;g.loadedDepotDeparturePosition={latitude:pos.latitude,longitude:pos.longitude};
      if(area){t.stage=Math.max(2,num(t.stage)||1);t.status='Loaded · departure pending';if(currentLeg)currentLeg.status='Loaded · departure pending';events.push({title:t.number+' left depot loaded',message:pos.vehicleId+' left '+dep.name+' loaded. Trip remains staged until the truck exits '+area.name+'.'})}
      else if(startTrip('depot-exit-after-loading',now))events.push({title:t.number+' trip started',message:pos.vehicleId+' left '+dep.name+' loaded. This depot exit is the official trip start.'})
    }
    if(!area&&dep&&g.loadDepartedAt&&!g.loadedAtDepotAt&&!statusStarted()&&!depInside&&lm>=z.departM&&prevPos&&om+75<previousOffM&&!(depM+75<prevDepM)){
      const actualStart=g.loadDepartedAt||now;g.directDepartureConfirmedAt=now;
      if(startTrip('direct-from-loading',actualStart))events.push({title:t.number+' direct departure confirmed',message:pos.vehicleId+' continued toward '+z.offload.name+' instead of returning to '+dep.name+'. Trip start time is the loading-point departure time.'})
    }
    if(area&&!statusStarted()&&prevAreaInsideNow&&!areaInsideNow&&(g.loadArrivedAt||g.loadDepartedAt||g.loadedAtDepotAt||/loaded|at loading|departure pending/i.test(String(t.status||'')))){
      g.operatingAreaDepartedAt=now;g.operatingAreaDeparturePosition={latitude:pos.latitude,longitude:pos.longitude};g.operatingAreaGeofenceId=area.id;g.operatingAreaGeofenceName=area.name;
      if(startTrip('operating-area-exit',now))events.push({title:t.number+' trip started',message:pos.vehicleId+' exited '+area.name+'. Vehicle tracker confirmed the truck has left the local operating area; status changed to In transit.'})
    }

    if(statusStarted()&&!g.offloadApproachAt&&om<=z.approachM){
      g.offloadApproachAt=now;
      events.push({title:t.number+' approaching offloading',message:pos.vehicleId+' is '+km(om)+' km from '+z.offload.name+'.'})
    }
    if(statusStarted()&&!g.offloadArrivedAt&&om<=z.arrivalM){
      g.offloadArrivedAt=now;g.offloadArrivalPosition={latitude:pos.latitude,longitude:pos.longitude};t.status='At offloading';t.arrivedAt=t.arrivedAt||now;if(currentLeg){currentLeg.status='At offloading';currentLeg.arrivedAt=currentLeg.arrivedAt||now}
      events.push({title:t.number+' arrived at offloading',message:pos.vehicleId+' arrived at '+z.offload.name+' ('+km(om)+' km from pin).'})
    }
    if(g.offloadArrivedAt&&!g.offloadDepartedAt&&om>=z.departM){
      g.offloadDepartedAt=now;g.offloadDeparturePosition={latitude:pos.latitude,longitude:pos.longitude};
      if(!multiLeg&&z.roundTrip){
        g.returnStartedAt=now;t.status='Return journey';
        events.push({title:t.number+' return journey started',message:pos.vehicleId+' has left '+z.offload.name+' and is now '+km(om)+' km away.'})
      }else{
        if(multiLeg){t.status='Awaiting POD';if(currentLeg)currentLeg.status='At offloading'}else{t.stage=Math.max(4,num(t.stage)||1);t.status='Delivered'}
        if(!state.tasks.some(x=>x.linkedId===t.id&&/POD/i.test(x.title)&&x.status==='Open')){
          state.tasks.unshift({id:'task_'+crypto.randomUUID(),title:'Upload POD for '+t.number,ownerRole:'Driver',linkedType:'trip',linkedId:t.id,due:now.slice(0,10),priority:'High',status:'Open'})
        }
        events.push({title:t.number+' left offloading point',message:pos.vehicleId+' has departed '+z.offload.name+'. Delivery marked complete; POD is still required.'})
      }
    }
    if(z.roundTrip&&g.offloadDepartedAt&&!g.returnApproachAt&&lm<=z.approachM){
      g.returnApproachAt=now;
      events.push({title:t.number+' approaching return point',message:pos.vehicleId+' is '+km(lm)+' km from '+z.load.name+' on the return journey.'})
    }
    if(z.roundTrip&&g.returnApproachAt&&!g.returnArrivedAt&&lm<=z.arrivalM){
      g.returnArrivedAt=now;g.returnArrivalPosition={latitude:pos.latitude,longitude:pos.longitude};t.stage=Math.max(4,num(t.stage)||1);t.status='Returned';
      if(!state.tasks.some(x=>x.linkedId===t.id&&/POD/i.test(x.title)&&x.status==='Open')&&!t.pod){
        state.tasks.unshift({id:'task_'+crypto.randomUUID(),title:'Upload POD for '+t.number,ownerRole:'Driver',linkedType:'trip',linkedId:t.id,due:now.slice(0,10),priority:'High',status:'Open'})
      }
      events.push({title:t.number+' returned',message:pos.vehicleId+' arrived back at '+z.load.name+'. Trip is ready for POD/office closure.'})
    }
    g.lastPositionAt=now;g.lastLoadDistanceKm=Number((lm/1000).toFixed(2));g.lastOffloadDistanceKm=Number((om/1000).toFixed(2));
    return{events,tripId:t.id,driverId:t.driverId}
  });
  for(const e of changed.result?.events||[])await tripGeoNotify({...active,driverId:changed.result.driverId},e.title,e.message,e.severity||'info')
}
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body.email||'').toLowerCase(),u=pool?(await q('SELECT * FROM users WHERE email=$1 AND active=true',[email]))[0]:memory.users.find(x=>x.email===email&&x.active);if(!u||!await bcrypt.compare(String(req.body.password||''),u.password_hash))return res.status(401).json({error:'Invalid email or password'});res.json({token:tokenFor(u),user:{id:u.id,email:u.email,name:u.name,role:u.role,driverId:u.driver_id||u.driverId||null}})});
app.get('/api/session',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/users',auth,roles('admin','manager'),async(req,res)=>res.json(pool?await q('SELECT id,email,name,role,driver_id AS "driverId",active,created_at AS "createdAt" FROM users ORDER BY name'):memory.users.map(({password_hash,...u})=>u)));
app.post('/api/users',auth,roles('admin'),async(req,res)=>{const email=String(req.body.email||'').trim().toLowerCase(),name=String(req.body.name||'').trim(),role=String(req.body.role||''),password=String(req.body.password||''),driverId=req.body.driverId||null;if(!email||!name||password.length<10||!['admin','manager','dispatcher','driver','warehouse','workshop','finance'].includes(role))return res.status(400).json({error:'Valid name, email, role and a 10+ character password are required'});if(role==='driver'&&!driverId)return res.status(400).json({error:'Select the driver profile this login belongs to'});if(role==='driver'&&driverId){const linked=pool?(await q('SELECT id FROM users WHERE driver_id=$1',[driverId])):memory.users.filter(x=>(x.driver_id||x.driverId)===driverId);if(linked.length)return res.status(409).json({error:'This driver already has a login. Reactivate or reset the existing account instead.'});}const u={id:crypto.randomUUID(),email,name,role,driverId,active:true,createdAt:new Date().toISOString()},hash=await bcrypt.hash(password,12);try{if(pool)await q('INSERT INTO users(id,email,password_hash,name,role,driver_id) VALUES($1,$2,$3,$4,$5,$6)',[u.id,email,hash,name,role,u.driverId]);else memory.users.push({...u,password_hash:hash});res.status(201).json(u)}catch(e){res.status(409).json({error:'A user with that email already exists'})}});

app.patch('/api/users/:id',auth,roles('admin'),async(req,res)=>{const id=req.params.id,active=req.body.active===undefined?undefined:Boolean(req.body.active),driverId=req.body.driverId===undefined?undefined:(req.body.driverId||null);try{const existing=pool?(await q('SELECT id,email,name,role,driver_id AS "driverId",active FROM users WHERE id=$1',[id]))[0]:memory.users.find(x=>x.id===id);if(!existing)return res.status(404).json({error:'User not found'});if(existing.id===req.user.sub&&active===false)return res.status(400).json({error:'You cannot deactivate your own account'});const nextDriverId=driverId===undefined?(existing.driverId||existing.driver_id||null):driverId;if(existing.role==='driver'&&nextDriverId){const dup=pool?await q('SELECT id FROM users WHERE driver_id=$1 AND id<>$2',[nextDriverId,id]):memory.users.filter(x=>(x.driver_id||x.driverId)===nextDriverId&&x.id!==id);if(dup.length)return res.status(409).json({error:'That driver is already linked to another login'});}if(pool){const finalDriverId=driverId===undefined?(existing.driverId||null):driverId,finalActive=active===undefined?existing.active:active;const row=(await q('UPDATE users SET driver_id=$2,active=$3 WHERE id=$1 RETURNING id,email,name,role,driver_id AS "driverId",active,created_at AS "createdAt"',[id,finalDriverId,finalActive]))[0];return res.json(row)}if(driverId!==undefined){existing.driverId=driverId;existing.driver_id=driverId}if(active!==undefined)existing.active=active;const{password_hash,...safe}=existing;res.json(safe)}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/users/:id/reset-password',auth,roles('admin'),async(req,res)=>{const password=String(req.body.password||'');if(password.length<10)return res.status(400).json({error:'Password must be at least 10 characters'});const id=req.params.id,hash=await bcrypt.hash(password,12);if(pool){const rows=await q('UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING id',[id,hash]);if(!rows.length)return res.status(404).json({error:'User not found'})}else{const u=memory.users.find(x=>x.id===id);if(!u)return res.status(404).json({error:'User not found'});u.password_hash=hash}res.json({success:true})});

app.get('/api/state',auth,async(req,res)=>{const row=pool?(await q('SELECT payload,revision,updated_at FROM app_state WHERE id=1'))[0]:{payload:memory.state||{},revision:0};res.json(row)});
app.put('/api/state',auth,roles('admin','manager','dispatcher','workshop','finance'),async(req,res)=>{if(!req.body||typeof req.body!=='object')return res.status(400).json({error:'Invalid state'});if(pool){const row=(await q('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision,updated_at',[req.body]))[0];emit('state',{revision:row.revision,updatedAt:row.updated_at});res.json(row)}else{memory.state=req.body;emit('state',{revision:Date.now()});res.json({revision:Date.now()})}});


function legPricingMethod(v){
  const x=String(v||'Flat trip');
  return ['Flat trip','Per km','Per ton','Per pallet','Manual negotiated'].includes(x)?x:'Flat trip'
}
function calculateLegIncome(leg){
  const method=legPricingMethod(leg.pricingMethod),rate=num(leg.unitRate),manual=num(leg.agreedAmount||leg.income);
  if(method==='Per km')return rate*num(leg.distance);
  if(method==='Per ton')return rate*num(leg.tons);
  if(method==='Per pallet')return rate*num(leg.pallets);
  if(method==='Manual negotiated')return manual;
  return rate>0?rate:manual
}
function ensureTripLegs(state,t){
  if(Array.isArray(t.legs)&&t.legs.length)return t.legs;
  const r=(state.routes||[]).find(x=>x.id===t.routeId);
  const legacy={
    id:'leg_'+crypto.randomUUID(),sequence:1,label:'Outbound / Load 1',routeId:t.routeId||'',clientId:t.clientId||'',
    load:String(t.load||''),tons:num(t.tons),pallets:num(t.pallets),distance:num(t.distance)||num(r?.distance),
    namibiaKm:num(t.namibiaKm)||num(r?.namibiaKm),pricingMethod:'Manual negotiated',unitRate:0,agreedAmount:num(t.income),
    income:num(t.income),status:t.status||'Planned',pod:Boolean(t.pod),invoiceId:t.invoiceId||'',legacy:true
  };
  t.legs=[legacy];return t.legs
}
function activeTripLegServer(t){
  const legs=Array.isArray(t?.legs)?t.legs.slice().sort((a,b)=>num(a.sequence)-num(b.sequence)):[];
  return legs.find(x=>!['Delivered','Invoiced','Closed'].includes(String(x.status||'')))||legs[legs.length-1]||null
}
function syncTripFromLegs(state,t){
  const legs=ensureTripLegs(state,t).sort((a,b)=>num(a.sequence)-num(b.sequence));
  legs.forEach((leg,i)=>{
    const r=(state.routes||[]).find(x=>x.id===leg.routeId);
    leg.sequence=i+1;leg.label=String(leg.label||('Leg '+(i+1)));leg.distance=num(leg.distance)||num(r?.distance);
    if(!leg.namibiaKm)leg.namibiaKm=num(r?.namibiaKm);
    leg.pricingMethod=legPricingMethod(leg.pricingMethod);leg.income=Number(calculateLegIncome(leg).toFixed(2))
  });
  const first=legs[0]||{};
  t.routeId=first.routeId||t.routeId;t.clientId=first.clientId||t.clientId;t.load=first.load||t.load;t.tons=num(first.tons);t.pallets=num(first.pallets);
  t.distance=Number(legs.reduce((a,x)=>a+num(x.distance),0).toFixed(2));
  t.income=Number(legs.reduce((a,x)=>a+num(x.income),0).toFixed(2));
  t.journeyLegCount=legs.length;t.multiLeg=legs.length>1;
  return t
}
function serverTripLegSummary(state,t){
  const legs=ensureTripLegs(state,t);return{count:legs.length,income:legs.reduce((a,x)=>a+calculateLegIncome(x),0),distance:legs.reduce((a,x)=>a+num(x.distance),0)}
}
function driverFuelRecordCost(x){const total=num(x.printedTotal)||num(x.total);return total>0?total:num(x.litres)*num(x.price)}
function recalcTripCosts(state,t){
  if(Array.isArray(t.legs)&&t.legs.length)syncTripFromLegs(state,t);
  const fuel=(state.diesel||[]).filter(x=>x.tripId===t.id),expenses=(state.expenses||[]).filter(x=>x.tripId===t.id);
  const diesel=fuel.length?fuel.reduce((a,x)=>a+driverFuelRecordCost(x),0):num(t.dieselCost);
  const expense=expenses.reduce((a,x)=>a+num(x.amount),0);
  const hasTollExpense=expenses.some(x=>/^toll$/i.test(String(x.category||'')));
  const legacyToll=hasTollExpense?0:num(t.tolls),allowance=num(t.allowance),other=num(t.other);
  const total=diesel+expense+legacyToll+allowance+other;
  t.dieselCost=Number(diesel.toFixed(2));
  t.expenseCost=Number(expense.toFixed(2));
  t.actualTripCost=Number(total.toFixed(2));
  t.actualProfit=Number((num(t.income)-total).toFixed(2));
  t.costBreakdown={diesel:Number(diesel.toFixed(2)),routeExpenses:Number(expense.toFixed(2)),legacyToll:Number(legacyToll.toFixed(2)),allowance:Number(allowance.toFixed(2)),other:Number(other.toFixed(2))};
  return t
}

function periodBounds(period){
  if(!/^\d{4}-\d{2}$/.test(String(period||''))){const e=Error('Period must be YYYY-MM');e.status=400;throw e}
  const [y,m]=period.split('-').map(Number),start=new Date(Date.UTC(y,m-1,1)),end=new Date(Date.UTC(y,m,1));
  return{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)}
}
function serverFuelMetrics(state,t){
  const records=(state.diesel||[]).filter(x=>x.tripId===t.id),litres=records.reduce((a,x)=>a+num(x.litres),0),distance=serverTripLegSummary(state,t).distance,ready=distance>0&&litres>0;
  const spend=records.reduce((a,x)=>a+(num(x.printedTotal)||num(x.total)||num(x.litres)*num(x.price)),0);
  return{distance,litres,ready,kmPerL:ready?distance/litres:0,pricePerL:litres>0&&records.every(x=>(num(x.printedTotal)||num(x.total)||num(x.litres)*num(x.price))>0)?spend/litres:0}
}
function serverSouthAfricaTrip(state,t){
  const legs=ensureTripLegs(state,t);return legs.some(l=>{const r=(state.routes||[]).find(x=>x.id===l.routeId);return /south africa|durban|johannesburg|rosslyn|cape town|ottery|gauteng/i.test(String(r?.name||'')+' '+String(r?.notes||''))})
}
function serverTripRate(state,t,configured){
  if(num(configured)>0)return num(configured);
  if(serverSouthAfricaTrip(state,t))return .60;
  const efficiency=serverFuelMetrics(state,t).kmPerL;
  return efficiency>=2.4?.50:efficiency>=2.3?.40:.30
}
function serverIncentiveFor(state,t){
  const m=serverFuelMetrics(state,t),target=num(payrollProfile(state,t.driverId).minimumBonusKml)||2.0;
  if(!m.ready||m.pricePerL<=0||m.kmPerL<=target)return 0;
  return Math.max(0,m.distance/target-m.litres)*m.pricePerL*.10
}
function payrollProfile(state,driverId){
  state.payProfiles??=[];
  let p=state.payProfiles.find(x=>x.driverId===driverId);
  if(!p){
    const prior=(state.payroll||[]).filter(x=>x.employeeId===driverId).sort((a,b)=>String(b.period||'').localeCompare(String(a.period||'')))[0];
    p={driverId,baseSalary:num(prior?.base),tripRatePerKm:num(prior?.tripRatePerKm),minimumBonusKml:2.0,taxNumber:'',payeDefault:num(prior?.paye),sscDefault:num(prior?.ssc),overtimeRate:0,standardDays:num(prior?.days)||22,otherDeductionDefault:num(prior?.deductions),autoGenerate:true};
    state.payProfiles.push(p)
  }
  return p
}
function calculatePayrollRecord(state,driver,period,existing=null){
  const p=payrollProfile(state,driver.id),{start,end}=periodBounds(period);
  const inPeriod=d=>String(d||'')>=start&&String(d||'')<end;
  const trips=(state.trips||[]).filter(t=>t.driverId===driver.id&&inPeriod(t.date)&&num(t.stage)>=3);
  const tripKm=trips.reduce((a,t)=>a+serverTripLegSummary(state,t).distance,0),tripRatePerKm=num(existing?.tripRatePerKm??p.tripRatePerKm);
  const tripPay=trips.reduce((a,t)=>a+serverTripLegSummary(state,t).distance*serverTripRate(state,t,tripRatePerKm),0);
  const incentive=trips.reduce((a,t)=>a+serverIncentiveFor(state,t),0);
  const reimbursements=(state.expenses||[]).filter(x=>x.driverId===driver.id&&inPeriod(x.date)&&x.reimbursable!==false&&x.status==='Approved').reduce((a,x)=>a+num(x.amount),0);
  const advances=(state.advances||[]).filter(x=>x.driverId===driver.id&&inPeriod(x.date)&&x.status!=='Reconciled').reduce((a,x)=>a+num(x.amount),0);
  const overtimeHours=num(existing?.overtimeHours??existing?.overtime),overtimeRate=num(existing?.overtimeRate)||num(p.overtimeRate),overtimePay=overtimeHours*overtimeRate;
  const base=num(existing?.base)||num(p.baseSalary),days=num(existing?.days)||num(p.standardDays)||22;
  const paye=existing?.paye!==undefined?num(existing.paye):num(p.payeDefault),ssc=existing?.ssc!==undefined?num(existing.ssc):num(p.sscDefault),deductions=existing?.deductions!==undefined?num(existing.deductions):num(p.otherDeductionDefault);
  const gross=base+tripPay+incentive+overtimePay,net=gross+reimbursements-advances-paye-ssc-deductions;
  return{
    id:existing?.id||'pay_'+crypto.randomUUID(),period,employeeId:driver.id,days,overtimeHours,overtimeRate,overtimePay:Number(overtimePay.toFixed(2)),
    base:Number(base.toFixed(2)),tripKm:Number(tripKm.toFixed(2)),tripRatePerKm:Number(tripRatePerKm.toFixed(4)),tripPay:Number(tripPay.toFixed(2)),
    incentive:Number(incentive.toFixed(2)),fuelSavingBonus:Number(incentive.toFixed(2)),minimumBonusKml:num(p.minimumBonusKml)||2.0,
    reimbursements:Number(reimbursements.toFixed(2)),advances:Number(advances.toFixed(2)),
    paye:Number(paye.toFixed(2)),ssc:Number(ssc.toFixed(2)),deductions:Number(deductions.toFixed(2)),gross:Number(gross.toFixed(2)),net:Number(net.toFixed(2)),
    tripCount:trips.length,status:existing?.status||'Draft',generatedAt:new Date().toISOString(),autoGenerated:existing?.autoGenerated??true,
    taxNumber:p.taxNumber||'',setupRequired:!(num(p.baseSalary)>0)
  }
}
function generatePayrollPeriod(state,period,auto=false){
  state.payroll??=[];state.drivers??=[];
  const rows=[];
  for(const d of state.drivers){
    const p=payrollProfile(state,d.id);if(auto&&p.autoGenerate===false)continue;
    const existing=state.payroll.find(x=>x.period===period&&x.employeeId===d.id);
    if(existing&&['Approved','Paid'].includes(existing.status)){rows.push(existing);continue}
    const next=calculatePayrollRecord(state,d,period,existing||null);
    if(existing)Object.assign(existing,next);else state.payroll.unshift(next);
    rows.push(existing||next)
  }
  return rows
}
function monthPeriod(d=new Date()){return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')}
function previousMonthPeriod(d=new Date()){const x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1));return monthPeriod(x)}
async function readOpsState(){if(pool){const row=(await q('SELECT payload FROM app_state WHERE id=1'))[0];return row?.payload||{}}return memory.state||{}}
function driverTrip(state,req){const did=req.user.driverId;if(!did){const e=Error('Driver account is not linked to a driver profile');e.status=400;throw e}const trip=(state.trips||[]).find(x=>x.id===req.params.tripId);if(!trip){const e=Error('Trip not found');e.status=404;throw e}if(trip.driverId!==did){const e=Error('This trip is not assigned to you');e.status=403;throw e}return{trip,did}}
async function mutateOpsState(mutator){if(pool){const c=await pool.connect();try{await c.query('BEGIN');const row=(await c.query('SELECT payload,revision FROM app_state WHERE id=1 FOR UPDATE')).rows[0]||{payload:{},revision:0};const state=row.payload||{};const result=await mutator(state);const updated=(await c.query('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision,updated_at',[state])).rows[0];await c.query('COMMIT');emit('state',{revision:updated.revision,updatedAt:updated.updated_at});return{result,revision:updated.revision}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}const state=memory.state||{};const result=await mutator(state);memory.state=state;const revision=Date.now();emit('state',{revision});return{result,revision}}


app.post('/api/mdc/record',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{},tripId=String(body.tripId||''),namibiaKm=num(body.namibiaKm),reference=String(body.reference||'');
    if(!tripId||namibiaKm<=0)return res.status(400).json({error:'Trip and Namibian road distance are required'});
    const changed=await mutateOpsState(async state=>{
      state.expenses??=[];state.settings??={};
      const t=(state.trips||[]).find(x=>x.id===tripId);if(!t){const e=Error('Trip not found');e.status=404;throw e}
      const rate=num(body.ratePer100km)||num(state.settings.mdcRatePer100km)||73.30,amount=Number((namibiaKm/100*rate).toFixed(2)),now=new Date().toISOString(),date=String(body.date||now.slice(0,10));
      let rec=state.expenses.find(x=>x.tripId===t.id&&x.mdc===true);
      const values={date,tripId:t.id,truckId:t.truckId,driverId:t.driverId,category:'Mass distance charge (MDC)',supplier:'Road Fund Administration',amount,receiptNo:reference,notes:namibiaKm.toFixed(1)+' Namibian km × N$'+rate.toFixed(2)+' / 100 km',status:'Approved',reimbursable:false,mdc:true,mdcKm:namibiaKm,mdcRatePer100km:rate,systemGenerated:true,updatedAt:now};
      if(rec)Object.assign(rec,values);else{rec={id:'expense_'+crypto.randomUUID(),...values,createdAt:now};state.expenses.unshift(rec)}
      state.settings.mdcRatePer100km=rate;recalcTripCosts(state,t);
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:now,actor:req.user.name||req.user.email||req.user.role,action:'MDC '+(rec.createdAt?'recorded':'updated')+' for '+t.number+' · N$'+amount.toFixed(2),linkedType:'trip',linkedId:t.id});state.audit=state.audit.slice(0,100);
      return{record:rec,trip:{id:t.id,number:t.number,actualTripCost:t.actualTripCost,actualProfit:t.actualProfit}}
    });
    res.status(201).json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.post('/api/payroll/generate',auth,roles('admin','manager','finance'),async(req,res)=>{
  try{
    const period=String(req.body?.period||monthPeriod(new Date()));
    periodBounds(period);
    const changed=await mutateOpsState(async state=>{
      const rows=generatePayrollPeriod(state,period,false),now=new Date().toISOString();
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:now,actor:req.user.name||req.user.email||req.user.role,action:'Payroll drafts generated/refreshed for '+period,linkedType:'payroll',linkedId:period});state.audit=state.audit.slice(0,100);
      return rows
    });
    res.json({period,rows:changed.result})
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.patch('/api/payroll/profiles/:driverId',auth,roles('admin','manager','finance'),async(req,res)=>{
  try{
    const did=String(req.params.driverId),body=req.body&&typeof req.body==='object'?req.body:{};
    const changed=await mutateOpsState(async state=>{
      const d=(state.drivers||[]).find(x=>x.id===did);if(!d){const e=Error('Driver not found');e.status=404;throw e}
      const p=payrollProfile(state,did);
      for(const key of ['baseSalary','tripRatePerKm','minimumBonusKml','payeDefault','sscDefault','overtimeRate','standardDays','otherDeductionDefault'])if(body[key]!==undefined)p[key]=num(body[key]);
      if(body.taxNumber!==undefined)p.taxNumber=String(body.taxNumber||'');
      if(body.autoGenerate!==undefined)p.autoGenerate=Boolean(body.autoGenerate);
      p.updatedAt=new Date().toISOString();p.updatedBy=req.user.sub;
      return p
    });
    res.json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.patch('/api/payroll/:id',auth,roles('admin','manager','finance'),async(req,res)=>{
  try{
    const id=String(req.params.id),body=req.body&&typeof req.body==='object'?req.body:{};
    const changed=await mutateOpsState(async state=>{
      state.payroll??=[];const row=state.payroll.find(x=>x.id===id);if(!row){const e=Error('Payslip not found');e.status=404;throw e}
      const driver=(state.drivers||[]).find(x=>x.id===row.employeeId);if(!driver){const e=Error('Driver not found');e.status=404;throw e}
      for(const key of ['days','overtimeHours','overtimeRate','base','tripRatePerKm','paye','ssc','deductions'])if(body[key]!==undefined)row[key]=num(body[key]);
      const wantedStatus=body.status!==undefined?String(body.status):row.status;
      Object.assign(row,calculatePayrollRecord(state,driver,row.period,row));
      if(['Draft','Approved','Paid'].includes(wantedStatus))row.status=wantedStatus;
      if(row.status==='Approved'&&!row.approvedAt)row.approvedAt=new Date().toISOString();
      if(row.status==='Paid'&&!row.paidAt)row.paidAt=new Date().toISOString();
      row.updatedAt=new Date().toISOString();row.updatedBy=req.user.sub;
      return row
    });
    res.json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.post('/api/admin/trips',auth,roles('admin','manager','dispatcher'),async(req,res)=>{
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const required=['date','routeId','clientId','truckId','driverId'];
    if(required.some(k=>!body[k]))return res.status(400).json({error:'Date, route, client, truck and driver are required'});
    const changed=await mutateOpsState(async state=>{
      state.trips??=[];state.trucks??=[];state.drivers??=[];state.routes??=[];
      const route=state.routes.find(x=>x.id===body.routeId);
      if(!route){const e=Error('Selected route was not found');e.status=400;throw e}
      const truck=state.trucks.find(x=>x.id===body.truckId);
      const driver=state.drivers.find(x=>x.id===body.driverId);
      if(!truck){const e=Error('Selected truck was not found');e.status=400;throw e}
      if(!driver){const e=Error('Selected driver was not found');e.status=400;throw e}
      const highest=state.trips.reduce((m,t)=>{const n=Number(String(t.number||'').match(/AT-(\d+)/)?.[1]||0);return Math.max(m,n)},999);
      const status=['Planned','Loading','In transit','Delivered'].includes(body.status)?body.status:'Planned';
      const stage={Planned:1,Loading:2,'In transit':3,Delivered:4}[status]||1;
      const trip={
        id:'trip_'+crypto.randomUUID(),
        number:'AT-'+(highest+1),
        date:String(body.date),
        routeId:String(body.routeId),
        clientId:String(body.clientId),
        truckId:String(body.truckId),
        trailerId:body.trailerId?String(body.trailerId):'',
        driverId:String(body.driverId),
        load:String(body.load||''),
        tons:num(body.tons),
        pallets:num(body.pallets),
        startKm:num(body.startKm),
        income:num(body.income),
        distance:num(route.distance),
        legs:[{
          id:'leg_'+crypto.randomUUID(),sequence:1,label:'Outbound / Load 1',routeId:String(body.routeId),clientId:String(body.clientId),
          load:String(body.load||''),tons:num(body.tons),pallets:num(body.pallets),distance:num(route.distance),namibiaKm:num(route.namibiaKm),
          pricingMethod:legPricingMethod(body.pricingMethod||'Manual negotiated'),unitRate:num(body.unitRate),
          agreedAmount:num(body.income),income:num(body.income),status, pod:false,invoiceId:''
        }],
        journeyLegCount:1,multiLeg:false,
        dieselCost:0,tolls:0,allowance:0,other:0,
        status,stage,pod:false,approved:false,settlementStatus:'Pending',
        createdAt:new Date().toISOString(),createdBy:req.user.sub
      };
      syncTripFromLegs(state,trip);recalcTripCosts(state,trip);
      state.trips.unshift(trip);
      truck.status=stage>=3?'On trip':'Reserved';
      driver.status=stage>=3?'On trip':'Assigned';
      state.audit??=[];
      state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'trip record created',linkedType:'trip',linkedId:trip.id});
      state.audit=state.audit.slice(0,100);
      return trip;
    });
    const geo=await linkTripLegGeofences(changed.result.id,changed.result.legs?.[0]?.id);
    const latest=await readOpsState(),trip=(latest.trips||[]).find(x=>x.id===changed.result.id)||changed.result;
    res.status(201).json({trip,geofences:geo,revision:geo?.revision||changed.revision});
  }catch(e){res.status(e.status||500).json({error:e.message})}
});

app.post('/api/admin/trips/:tripId/legs',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const changed=await mutateOpsState(async state=>{
      const t=(state.trips||[]).find(x=>x.id===req.params.tripId);if(!t){const e=Error('Trip not found');e.status=404;throw e}
      const route=(state.routes||[]).find(x=>x.id===body.routeId);if(!route){const e=Error('Route not found');e.status=400;throw e}
      if(!(state.clients||[]).some(x=>x.id===body.clientId)){const e=Error('Client not found');e.status=400;throw e}
      const legs=ensureTripLegs(state,t),seq=legs.length+1;
      const leg={id:'leg_'+crypto.randomUUID(),sequence:seq,label:String(body.label||('Leg '+seq)),routeId:String(body.routeId),clientId:String(body.clientId),
        load:String(body.load||''),tons:num(body.tons),pallets:num(body.pallets),distance:num(body.distance)||num(route.distance),namibiaKm:num(body.namibiaKm)||num(route.namibiaKm),
        pricingMethod:legPricingMethod(body.pricingMethod),unitRate:num(body.unitRate),agreedAmount:num(body.agreedAmount||body.income),
        income:0,status:String(body.status||'Planned'),pod:false,invoiceId:'',createdAt:new Date().toISOString()};
      leg.income=Number(calculateLegIncome(leg).toFixed(2));legs.push(leg);syncTripFromLegs(state,t);recalcTripCosts(state,t);
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'Added '+leg.label+' to '+t.number+' · '+leg.load+' · N$'+leg.income.toFixed(2),linkedType:'trip',linkedId:t.id});state.audit=state.audit.slice(0,100);
      return{trip:t,leg}
    });
    const geo=await linkTripLegGeofences(changed.result.trip.id,changed.result.leg.id);
    const latest=await readOpsState(),trip=(latest.trips||[]).find(x=>x.id===changed.result.trip.id)||changed.result.trip,leg=ensureTripLegs(latest,trip).find(x=>x.id===changed.result.leg.id)||changed.result.leg;
    res.status(201).json({trip,leg,geofences:geo,revision:geo?.revision||changed.revision})
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.patch('/api/admin/trips/:tripId/legs/:legId',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const changed=await mutateOpsState(async state=>{
      const t=(state.trips||[]).find(x=>x.id===req.params.tripId);if(!t){const e=Error('Trip not found');e.status=404;throw e}
      const legs=ensureTripLegs(state,t),leg=String(req.params.legId).startsWith('legacy_')?legs[0]:legs.find(x=>x.id===req.params.legId);if(!leg){const e=Error('Journey leg not found');e.status=404;throw e}
      if(body.routeId!==undefined){const r=(state.routes||[]).find(x=>x.id===body.routeId);if(!r){const e=Error('Route not found');e.status=400;throw e}leg.routeId=String(body.routeId);if(body.distance===undefined)leg.distance=num(r.distance);if(body.namibiaKm===undefined)leg.namibiaKm=num(r.namibiaKm)}
      if(body.clientId!==undefined){if(!(state.clients||[]).some(x=>x.id===body.clientId)){const e=Error('Client not found');e.status=400;throw e}leg.clientId=String(body.clientId)}
      for(const key of ['label','load','status'])if(body[key]!==undefined)leg[key]=String(body[key]||'');
      for(const key of ['tons','pallets','distance','namibiaKm','unitRate','agreedAmount'])if(body[key]!==undefined)leg[key]=num(body[key]);
      if(body.pricingMethod!==undefined)leg.pricingMethod=legPricingMethod(body.pricingMethod);
      if(body.pod!==undefined)leg.pod=Boolean(body.pod);
      leg.income=Number(calculateLegIncome(leg).toFixed(2));leg.updatedAt=new Date().toISOString();syncTripFromLegs(state,t);recalcTripCosts(state,t);
      return{trip:t,leg}
    });
    const geo=await linkTripLegGeofences(changed.result.trip.id,changed.result.leg.id);
    const latest=await readOpsState(),trip=(latest.trips||[]).find(x=>x.id===changed.result.trip.id)||changed.result.trip,leg=ensureTripLegs(latest,trip).find(x=>x.id===changed.result.leg.id)||changed.result.leg;
    res.json({trip,leg,geofences:geo,revision:geo?.revision||changed.revision})
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.delete('/api/admin/trips/:tripId/legs/:legId',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const changed=await mutateOpsState(async state=>{
      const t=(state.trips||[]).find(x=>x.id===req.params.tripId);if(!t){const e=Error('Trip not found');e.status=404;throw e}
      const legs=ensureTripLegs(state,t),i=String(req.params.legId).startsWith('legacy_')?0:legs.findIndex(x=>x.id===req.params.legId);if(i<0){const e=Error('Journey leg not found');e.status=404;throw e}
      if(legs.length<=1){const e=Error('A journey must keep at least one leg');e.status=400;throw e}
      if(legs[i].invoiceId){const e=Error('This leg already has an invoice and cannot be removed');e.status=409;throw e}
      const [removed]=legs.splice(i,1);syncTripFromLegs(state,t);recalcTripCosts(state,t);return{trip:t,removed}
    });
    res.json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.post('/api/admin/trips/:tripId/legs/:legId/invoice',auth,roles('admin','manager','finance'),async(req,res)=>{
  try{
    const changed=await mutateOpsState(async state=>{
      state.invoices??=[];
      const t=(state.trips||[]).find(x=>x.id===req.params.tripId);if(!t){const e=Error('Trip not found');e.status=404;throw e}
      const invoiceLegs=ensureTripLegs(state,t),leg=String(req.params.legId).startsWith('legacy_')?invoiceLegs[0]:invoiceLegs.find(x=>x.id===req.params.legId);if(!leg){const e=Error('Journey leg not found');e.status=404;throw e}
      if(leg.invoiceId){const existing=state.invoices.find(x=>x.id===leg.invoiceId);if(existing)return{invoice:existing,trip:t,leg,existing:true}}
      const highest=state.invoices.reduce((m,x)=>Math.max(m,Number(String(x.number||'').match(/INV-(\d+)/)?.[1]||0)),999);
      const client=(state.clients||[]).find(x=>x.id===leg.clientId),terms=num(client?.terms)||30,date=new Date(),due=new Date(date.getTime()+terms*86400000).toISOString().slice(0,10);
      const inv={id:'inv_'+crypto.randomUUID(),number:'INV-'+(highest+1),date:date.toISOString().slice(0,10),clientId:leg.clientId,tripId:t.id,legId:leg.id,amount:num(leg.income),due,status:'Unpaid',journeyLeg:true};
      state.invoices.unshift(inv);leg.invoiceId=inv.id;leg.invoiceStatus='Unpaid';
      const legs=ensureTripLegs(state,t);if(legs.every(x=>x.invoiceId)){t.stage=Math.max(num(t.stage),5);t.status='Invoiced';t.invoiceIds=legs.map(x=>x.invoiceId);const tr=(state.trucks||[]).find(x=>x.id===t.truckId);if(tr)tr.status='Available';const dr=(state.drivers||[]).find(x=>x.id===t.driverId);if(dr)dr.status='Available'}
      return{invoice:inv,trip:t,leg,existing:false}
    });
    res.status(changed.result.existing?200:201).json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});

app.post('/api/driver/trips/:tripId/receipt',auth,roles('driver'),upload.array('documents',2),async(req,res)=>{
  const files=(req.files||[]).slice(0,2),action=String(req.body.action||''),clientActionId=String(req.body.clientActionId||'').slice(0,100);
  let data={};try{data=JSON.parse(req.body.data||'{}')}catch{return res.status(400).json({error:'Invalid receipt data'})}
  if(!['diesel','expense'].includes(action))return res.status(400).json({error:'Receipt action must be diesel or expense'});
  if(!files.length)return res.status(400).json({error:'Receipt photo required'});
  if(pool){
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const row=(await c.query('SELECT payload,revision FROM app_state WHERE id=1 FOR UPDATE')).rows[0]||{payload:{},revision:0};
      const state=row.payload||{}, {trip:t,did}=driverTrip(state,req),leg=activeTripLegServer(t),now=new Date().toISOString(),date=now.slice(0,10),mk=p=>p+'_'+crypto.randomUUID();
      state.driverActions??=[];state.diesel??=[];state.expenses??=[];
      if(clientActionId&&state.driverActions.some(x=>x.clientActionId===clientActionId)){await c.query('ROLLBACK');return res.json({duplicate:true,action,tripId:t.id})}
      const uploads=[];
      for(let i=0;i<files.length;i++){
        const file=files[i],archived=archiveStoredFile(file),id=crypto.randomUUID(),kind=i===0?action:action+'-supporting';
        await c.query('INSERT INTO driver_uploads(id,user_id,trip_id,kind,filename,mime_type,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,req.user.sub,t.id,kind,archived.filename,archived.mimeType,archived.buffer,now]);
        uploads.push({id,kind,filename:archived.filename,mimeType:archived.mimeType,size:archived.size,originalSize:archived.originalSize,convertedToPdf:archived.convertedToPdf,createdAt:now})
      }
      const ids=uploads.map(x=>x.id);
      if(action==='diesel'){
        const litres=num(data.litres),total=num(data.total),price=num(data.price)||(litres>0&&total>0?total/litres:0);
        if(litres<=0){const e=Error('Enter diesel litres');e.status=400;throw e}
        const rec={id:mk('fuel'),tripId:t.id,legId:leg?.id||'',date,truckId:t.truckId,driverId:did,litres,price,odometer:num(data.odometer),supplier:String(data.supplier||''),slip:String(data.slip||''),receiptUploadId:ids[0]||'',receiptUploadIds:ids,supportingReceiptUploadId:ids[1]||'',receiptCount:ids.length,verified:false,detectedCategory:String(data.detectedCategory||'Diesel'),categoryConfidence:num(data.categoryConfidence),fuelTransactions:Array.isArray(data.fuelTransactions)?data.fuelTransactions.slice(0,10):[],fuelTransactionCount:num(data.fuelTransactionCount)||1,printedTotal:num(data.printedTotal)||total||null,receiptAdjustment:data.adjustment===null||data.adjustment===undefined?null:num(data.adjustment),driverEasyMode:true};
        state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel');
      }else{
        const amount=num(data.amount);if(amount<=0){const e=Error('Enter the expense amount');e.status=400;throw e}
        const category=String(data.category||'Other'),supplier=String(data.supplier||'');
        state.expenses.unshift({id:mk('expense'),date,tripId:t.id,legId:leg?.id||'',truckId:t.truckId,driverId:did,category,supplier,amount,receiptNo:String(data.receiptNo||''),notes:String(data.notes||''),receiptUploadId:ids[0]||'',receiptUploadIds:ids,supportingReceiptUploadId:ids[1]||'',receiptCount:ids.length,status:'Review',reimbursable:true,detectedCategory:String(data.detectedCategory||''),categoryConfidence:num(data.categoryConfidence),driverEasyMode:true});
        rememberSupplierCategory(state,supplier,category);
      }
      recalcTripCosts(state,t);
      if(clientActionId)state.driverActions.unshift({clientActionId,tripId:t.id,driverId:did,action,at:now});
      state.driverActions=state.driverActions.slice(0,1000);
      const updated=(await c.query('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision,updated_at',[state])).rows[0];
      await c.query('COMMIT');
      emit('state',{revision:updated.revision,updatedAt:updated.updated_at});
      for(const up of uploads)emit('driver-upload',{...up,userId:req.user.sub,driverId:did,userName:req.user.name||'',tripId:t.id,posted:true,linkedRecordType:action});
      return res.status(201).json({success:true,action,tripId:t.id,number:t.number,uploads,trip:{dieselCost:t.dieselCost,expenseCost:t.expenseCost,actualTripCost:t.actualTripCost,actualProfit:t.actualProfit},revision:updated.revision})
    }catch(e){await c.query('ROLLBACK');return res.status(e.status||500).json({error:e.message})}finally{c.release()}
  }
  try{
    const state=await readOpsState(),{trip:t,did}=driverTrip(state,req),leg=activeTripLegServer(t),now=new Date().toISOString(),date=now.slice(0,10),mk=p=>p+'_'+crypto.randomUUID(),ids=[];
    state.driverActions??=[];state.diesel??=[];state.expenses??=[];
    if(clientActionId&&state.driverActions.some(x=>x.clientActionId===clientActionId))return res.json({duplicate:true,action,tripId:t.id});
    for(let i=0;i<files.length;i++){const file=files[i],archived=archiveStoredFile(file),id=crypto.randomUUID(),kind=i===0?action:action+'-supporting';memory.uploads.push({id,userId:req.user.sub,driverId:did,userName:req.user.name||'',tripId:t.id,kind,filename:archived.filename,mimeType:archived.mimeType,content:archived.buffer,createdAt:now});ids.push(id)}
    if(action==='diesel'){const litres=num(data.litres),total=num(data.total),price=num(data.price)||(litres>0&&total>0?total/litres:0);if(litres<=0)return res.status(400).json({error:'Enter diesel litres'});const rec={id:mk('fuel'),tripId:t.id,legId:leg?.id||'',date,truckId:t.truckId,driverId:did,litres,price,odometer:num(data.odometer),supplier:String(data.supplier||''),slip:String(data.slip||''),receiptUploadId:ids[0]||'',receiptUploadIds:ids,supportingReceiptUploadId:ids[1]||'',receiptCount:ids.length,verified:false,detectedCategory:String(data.detectedCategory||'Diesel'),categoryConfidence:num(data.categoryConfidence),fuelTransactions:Array.isArray(data.fuelTransactions)?data.fuelTransactions.slice(0,10):[],fuelTransactionCount:num(data.fuelTransactionCount)||1,printedTotal:num(data.printedTotal)||total||null,receiptAdjustment:data.adjustment===null||data.adjustment===undefined?null:num(data.adjustment),driverEasyMode:true};state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel')}else{const amount=num(data.amount);if(amount<=0)return res.status(400).json({error:'Enter the expense amount'});const category=String(data.category||'Other'),supplier=String(data.supplier||'');state.expenses.unshift({id:mk('expense'),date,tripId:t.id,legId:leg?.id||'',truckId:t.truckId,driverId:did,category,supplier,amount,receiptNo:String(data.receiptNo||''),notes:String(data.notes||''),receiptUploadId:ids[0]||'',receiptUploadIds:ids,supportingReceiptUploadId:ids[1]||'',receiptCount:ids.length,status:'Review',reimbursable:true,detectedCategory:String(data.detectedCategory||''),categoryConfidence:num(data.categoryConfidence),driverEasyMode:true});rememberSupplierCategory(state,supplier,category)}
    recalcTripCosts(state,t);if(clientActionId)state.driverActions.unshift({clientActionId,tripId:t.id,driverId:did,action,at:now});memory.state=state;emit('state',{revision:Date.now()});return res.status(201).json({success:true,action,tripId:t.id})
  }catch(e){return res.status(e.status||500).json({error:e.message})}
});

app.get('/api/trips/:tripId/documents',auth,roles('admin','manager','dispatcher','finance','driver'),async(req,res)=>{
  const state=await readOpsState(),t=(state.trips||[]).find(x=>x.id===req.params.tripId);
  if(!t)return res.status(404).json({error:'Trip not found'});
  if(req.user.role==='driver'&&t.driverId!==req.user.driverId)return res.status(403).json({error:'This trip is not assigned to you'});
  let rows;
  if(pool)rows=await q('SELECT id,user_id AS "userId",trip_id AS "tripId",leg_id AS "legId",kind,reference,filename,mime_type AS "mimeType",octet_length(content) AS size,created_at AS "createdAt" FROM trip_documents WHERE trip_id=$1 ORDER BY created_at DESC',[t.id]);
  else rows=memory.tripDocuments.filter(x=>x.tripId===t.id).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(x=>({id:x.id,userId:x.userId,tripId:x.tripId,legId:x.legId||'',kind:x.kind,reference:x.reference||'',filename:x.filename||'',mimeType:x.mimeType||'',size:x.content?.length||0,createdAt:x.createdAt}));
  res.json(rows)
});
app.post('/api/trips/:tripId/documents',auth,roles('admin','manager','dispatcher','finance'),upload.single('document'),async(req,res)=>{
  try{
    const state=await readOpsState(),t=(state.trips||[]).find(x=>x.id===req.params.tripId);
    if(!t)return res.status(404).json({error:'Trip not found'});
    const kind=String(req.body.kind||'other').slice(0,80),reference=String(req.body.reference||'').slice(0,200),legId=String(req.body.legId||'').slice(0,120);
    if(!req.file&&!reference)return res.status(400).json({error:'Upload a document or enter its reference'});
    const id=crypto.randomUUID(),createdAt=new Date().toISOString(),archived=archiveStoredFile(req.file),filename=archived?.filename||'',mimeType=archived?.mimeType||'',content=archived?.buffer||null;
    if(pool)await q('INSERT INTO trip_documents(id,user_id,trip_id,leg_id,kind,reference,filename,mime_type,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,req.user.sub,t.id,legId||null,kind,reference,filename||null,mimeType||null,content,createdAt]);
    else memory.tripDocuments.push({id,userId:req.user.sub,tripId:t.id,legId,kind,reference,filename,mimeType,content,createdAt});
    res.status(201).json({id,userId:req.user.sub,tripId:t.id,legId,kind,reference,filename,mimeType,size:archived?.size||0,originalSize:archived?.originalSize||0,convertedToPdf:Boolean(archived?.convertedToPdf),createdAt})
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/trip-documents/:id',auth,roles('admin','manager','dispatcher','finance','driver'),async(req,res)=>{
  let d;
  if(pool)d=(await q('SELECT id,user_id AS "userId",trip_id AS "tripId",leg_id AS "legId",kind,reference,filename,mime_type AS "mimeType",content FROM trip_documents WHERE id=$1',[req.params.id]))[0];
  else d=memory.tripDocuments.find(x=>x.id===req.params.id);
  if(!d)return res.status(404).json({error:'Document not found'});
  if(req.user.role==='driver'){const state=await readOpsState(),t=(state.trips||[]).find(x=>x.id===d.tripId);if(!t||t.driverId!==req.user.driverId)return res.status(403).json({error:'This document is not assigned to you'})}
  if(!d.content)return res.status(404).json({error:'Only a reference was saved for this item'});
  res.setHeader('Content-Type',d.mimeType||'application/octet-stream');res.setHeader('Content-Disposition','inline; filename="'+String(d.filename||'document').replace(/"/g,'')+'"');res.send(d.content)
});
app.delete('/api/trip-documents/:id',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  if(pool){const rows=await q('DELETE FROM trip_documents WHERE id=$1 RETURNING id',[req.params.id]);if(!rows.length)return res.status(404).json({error:'Document not found'})}
  else{const i=memory.tripDocuments.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:'Document not found'});memory.tripDocuments.splice(i,1)}
  res.json({success:true})
});
app.post('/api/driver/trips/:tripId/upload',auth,roles('driver'),upload.single('document'),async(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:'Photo or document required'});
    const state=await readOpsState();driverTrip(state,req);
    const kind=String(req.body.kind||'document').slice(0,30),id=crypto.randomUUID(),createdAt=new Date().toISOString(),archived=archiveStoredFile(req.file);
    if(pool)await q('INSERT INTO driver_uploads(id,user_id,trip_id,kind,filename,mime_type,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,req.user.sub,req.params.tripId,kind,archived.filename,archived.mimeType,archived.buffer,createdAt]);
    else memory.uploads.push({id,userId:req.user.sub,driverId:req.user.driverId||null,userName:req.user.name||'',tripId:req.params.tripId,kind,filename:archived.filename,mimeType:archived.mimeType,content:archived.buffer,createdAt});
    const meta={id,userId:req.user.sub,driverId:req.user.driverId||null,userName:req.user.name||'',tripId:req.params.tripId,kind,filename:archived.filename,mimeType:archived.mimeType,size:archived.size,originalSize:archived.originalSize,convertedToPdf:archived.convertedToPdf,createdAt};
    emit('driver-upload',meta);
    res.status(201).json(meta)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.get('/api/driver/uploads',auth,roles('admin','manager','dispatcher','finance','workshop'),async(req,res)=>{
  const limit=Math.max(1,Math.min(500,num(req.query.limit)||200)),state=await readOpsState();
  const refs=new Map();
  for(const x of state.diesel||[])for(const id of (x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean))refs.set(id,{posted:true,linkedRecordType:'diesel',linkedRecordId:x.id});
  for(const x of state.expenses||[])for(const id of (x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean))refs.set(id,{posted:true,linkedRecordType:'expense',linkedRecordId:x.id});
  for(const x of state.tripIssues||[])if(x.photoUploadId)refs.set(x.photoUploadId,{posted:true,linkedRecordType:'problem',linkedRecordId:x.id});
  for(const x of state.trips||[]){if(x.podUploadId)refs.set(x.podUploadId,{posted:true,linkedRecordType:'pod',linkedRecordId:x.id});for(const l of x.legs||[])if(l.podUploadId)refs.set(l.podUploadId,{posted:true,linkedRecordType:'pod',linkedRecordId:l.id})}
  let rows;
  if(pool)rows=await q('SELECT du.id,du.user_id AS "userId",u.driver_id AS "driverId",u.name AS "userName",du.trip_id AS "tripId",du.kind,du.filename,du.mime_type AS "mimeType",octet_length(du.content) AS size,du.created_at AS "createdAt" FROM driver_uploads du LEFT JOIN users u ON u.id=du.user_id ORDER BY du.created_at DESC LIMIT $1',[limit]);
  else rows=memory.uploads.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit).map(x=>({id:x.id,userId:x.userId,driverId:x.driverId||null,userName:x.userName||'',tripId:x.tripId,kind:x.kind,filename:x.filename,mimeType:x.mimeType,size:x.content?.length||0,createdAt:x.createdAt}));
  res.json(rows.map(x=>({...x,...(refs.get(x.id)||{posted:false,linkedRecordType:null,linkedRecordId:null})})))
});

app.post('/api/admin/driver-uploads/:id/scan',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const u=pool?(await q('SELECT du.id,du.user_id AS "userId",u.driver_id AS "driverId",u.name AS "userName",du.trip_id AS "tripId",du.kind,du.filename,du.mime_type AS "mimeType",du.content FROM driver_uploads du LEFT JOIN users u ON u.id=du.user_id WHERE du.id=$1',[req.params.id]))[0]:memory.uploads.find(x=>x.id===req.params.id);
    if(!u)return res.status(404).json({error:'Upload not found'});
    const source=receiptOcrBuffer(u.content,u.mimeType),result=await recognizeReceiptBest(source),state=await readOpsState(),extractions=result.results.map(r=>extractReceiptFields(r.text,state)),extracted=mergeReceiptExtractions(extractions);
    res.json({upload:{id:u.id,driverId:u.driverId||null,userName:u.userName||'',tripId:u.tripId,kind:u.kind,filename:u.filename,mimeType:u.mimeType},extracted,confidence:result.best.confidence})
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/admin/driver-uploads/:id/post',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const meta=pool?(await q('SELECT du.id,du.user_id AS "userId",u.driver_id AS "driverId",u.name AS "userName",du.trip_id AS "tripId",du.kind,du.filename FROM driver_uploads du LEFT JOIN users u ON u.id=du.user_id WHERE du.id=$1',[req.params.id]))[0]:memory.uploads.find(x=>x.id===req.params.id);
    if(!meta)return res.status(404).json({error:'Upload not found'});
    const action=String(req.body.action||''),data=req.body.data&&typeof req.body.data==='object'?req.body.data:{};
    if(!['diesel','expense'].includes(action))return res.status(400).json({error:'Choose diesel or expense'});
    const changed=await mutateOpsState(async state=>{
      state.diesel??=[];state.expenses??=[];
      const already=[...(state.diesel||[]),...(state.expenses||[])].some(x=>(x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean).includes(meta.id));
      if(already){const e=Error('This upload is already posted to a trip');e.status=409;throw e}
      const t=(state.trips||[]).find(x=>x.id===meta.tripId);if(!t){const e=Error('Trip linked to this upload was not found');e.status=404;throw e}
      const did=meta.driverId||t.driverId,leg=activeTripLegServer(t),now=new Date().toISOString(),date=now.slice(0,10),mk=p=>p+'_'+crypto.randomUUID();
      if(action==='diesel'){
        const litres=num(data.litres),total=num(data.total),price=num(data.price)||(litres>0&&total>0?total/litres:0);
        if(litres<=0){const e=Error('Enter diesel litres');e.status=400;throw e}
        const rec={id:mk('fuel'),tripId:t.id,legId:leg?.id||'',date,truckId:t.truckId,driverId:did,litres,price,odometer:num(data.odometer),supplier:String(data.supplier||''),slip:String(data.slip||''),receiptUploadId:meta.id,receiptUploadIds:[meta.id],receiptCount:1,verified:false,detectedCategory:String(data.detectedCategory||'Diesel'),categoryConfidence:num(data.categoryConfidence),fuelTransactions:Array.isArray(data.fuelTransactions)?data.fuelTransactions.slice(0,10):[],fuelTransactionCount:num(data.fuelTransactionCount)||1,printedTotal:num(data.printedTotal)||total||null,receiptAdjustment:data.adjustment===null||data.adjustment===undefined?null:num(data.adjustment),driverEasyMode:true,recoveredByAdmin:true};
        state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel')
      }else{
        const amount=num(data.amount);if(amount<=0){const e=Error('Enter the expense amount');e.status=400;throw e}
        const category=String(data.category||'Other'),supplier=String(data.supplier||'');
        state.expenses.unshift({id:mk('expense'),date,tripId:t.id,legId:leg?.id||'',truckId:t.truckId,driverId:did,category,supplier,amount,receiptNo:String(data.receiptNo||''),notes:String(data.notes||''),receiptUploadId:meta.id,receiptUploadIds:[meta.id],receiptCount:1,status:'Review',reimbursable:true,detectedCategory:String(data.detectedCategory||category),categoryConfidence:num(data.categoryConfidence),driverEasyMode:true,recoveredByAdmin:true});
        rememberSupplierCategory(state,supplier,category)
      }
      recalcTripCosts(state,t);
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:now,actor:req.user.name||req.user.email||req.user.role,action:'Recovered '+action+' values from driver upload for '+t.number,linkedType:'trip',linkedId:t.id});state.audit=state.audit.slice(0,100);
      return{tripId:t.id,number:t.number,action,dieselCost:t.dieselCost,expenseCost:t.expenseCost,actualTripCost:t.actualTripCost,actualProfit:t.actualProfit}
    });
    res.status(201).json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});

app.post('/api/admin/driver-uploads/:id/move',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  const targetTripId=String(req.body.targetTripId||'');
  if(!targetTripId)return res.status(400).json({error:'Target trip is required'});
  if(pool){
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const row=(await c.query('SELECT payload,revision FROM app_state WHERE id=1 FOR UPDATE')).rows[0];
      if(!row){const e=Error('Central state not found');e.status=404;throw e}
      const state=row.payload||{},target=(state.trips||[]).find(x=>x.id===targetTripId);
      if(!target){const e=Error('Target trip not found');e.status=404;throw e}
      let record=null,type='';
      record=(state.diesel||[]).find(x=>(x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean).includes(req.params.id));
      if(record)type='diesel';
      if(!record){record=(state.expenses||[]).find(x=>(x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean).includes(req.params.id));if(record)type='expense'}
      if(!record){const e=Error('This upload is not linked to a posted diesel or expense record');e.status=400;throw e}
      const source=(state.trips||[]).find(x=>x.id===record.tripId);
      if(record.tripId===targetTripId){const e=Error('This receipt is already linked to '+(target.number||'that trip'));e.status=409;throw e}
      const ids=(record.receiptUploadIds||[record.receiptUploadId]).filter(Boolean);
      record.tripId=target.id;record.truckId=target.truckId;record.driverId=target.driverId;record.movedAt=new Date().toISOString();record.movedBy=req.user.sub;
      if(source)recalcTripCosts(state,source);recalcTripCosts(state,target);
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'Moved '+type+' receipt from '+(source?.number||'previous trip')+' to '+target.number,linkedType:'trip',linkedId:target.id});state.audit=state.audit.slice(0,100);
      const updated=(await c.query('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision,updated_at',[state])).rows[0];
      if(ids.length)await c.query('UPDATE driver_uploads SET trip_id=$1 WHERE id=ANY($2::uuid[])',[target.id,ids]);
      await c.query('COMMIT');
      emit('state',{revision:updated.revision,updatedAt:updated.updated_at});
      return res.json({success:true,type,sourceTripId:source?.id||null,sourceNumber:source?.number||null,targetTripId:target.id,targetNumber:target.number,uploadIds:ids,sourceTotals:source?{dieselCost:source.dieselCost,expenseCost:source.expenseCost,actualTripCost:source.actualTripCost,actualProfit:source.actualProfit}:null,targetTotals:{dieselCost:target.dieselCost,expenseCost:target.expenseCost,actualTripCost:target.actualTripCost,actualProfit:target.actualProfit}})
    }catch(e){await c.query('ROLLBACK');return res.status(e.status||500).json({error:e.message})}finally{c.release()}
  }
  try{
    const state=await readOpsState(),target=(state.trips||[]).find(x=>x.id===targetTripId);
    if(!target)return res.status(404).json({error:'Target trip not found'});
    let record=(state.diesel||[]).find(x=>(x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean).includes(req.params.id)),type='diesel';
    if(!record){record=(state.expenses||[]).find(x=>(x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean).includes(req.params.id));type='expense'}
    if(!record)return res.status(400).json({error:'This upload is not linked to a posted diesel or expense record'});
    const source=(state.trips||[]).find(x=>x.id===record.tripId),ids=(record.receiptUploadIds||[record.receiptUploadId]).filter(Boolean);
    record.tripId=target.id;record.truckId=target.truckId;record.driverId=target.driverId;record.movedAt=new Date().toISOString();record.movedBy=req.user.sub;
    if(source)recalcTripCosts(state,source);recalcTripCosts(state,target);
    memory.uploads.forEach(x=>{if(ids.includes(x.id))x.tripId=target.id});
    memory.state=state;emit('state',{revision:Date.now()});
    res.json({success:true,type,sourceNumber:source?.number||null,targetNumber:target.number,uploadIds:ids})
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.get('/api/driver/uploads/:id',auth,async(req,res)=>{const u=pool?(await q('SELECT id,user_id AS "userId",trip_id AS "tripId",kind,filename,mime_type AS "mimeType",content FROM driver_uploads WHERE id=$1',[req.params.id]))[0]:memory.uploads.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Upload not found'});if(req.user.role==='driver'&&u.userId!==req.user.sub)return res.status(403).json({error:'Access denied'});res.set({'Content-Type':u.mimeType||'application/octet-stream','Content-Disposition':'inline; filename="'+String(u.filename||'document').replace(/"/g,'')+'"'});res.send(u.content)});
app.post('/api/driver/trips/:tripId/action',auth,roles('driver'),async(req,res)=>{const action=String(req.body.action||''),data=req.body.data&&typeof req.body.data==='object'?req.body.data:{},clientActionId=String(req.body.clientActionId||'').slice(0,100);const allowed=['accept','inspection','start','arrive','pod','finish','diesel','expense','problem'];if(!allowed.includes(action))return res.status(400).json({error:'Invalid driver action'});try{const changed=await mutateOpsState(async state=>{state.driverActions??=[];if(clientActionId){const prior=state.driverActions.find(x=>x.clientActionId===clientActionId);if(prior)return{duplicate:true,action,tripId:req.params.tripId}}const{trip:t,did}=driverTrip(state,req),now=new Date().toISOString(),date=now.slice(0,10),mk=p=>p+'_'+crypto.randomUUID(),legs=ensureTripLegs(state,t),leg=activeTripLegServer(t),multi=legs.length>1;state.inspections??=[];state.diesel??=[];state.expenses??=[];state.tripIssues??=[];state.tasks??=[];state.trucks??=[];state.drivers??=[];if(action==='accept'){t.driverAcceptedAt=t.driverAcceptedAt||now;t.stage=Math.max(1,num(t.stage)||1);t.status=t.status||'Planned'}else if(action==='inspection'){const defects=String(data.defects||'').trim(),passed=!defects;state.inspections.unshift({id:mk('ins'),date,tripId:t.id,truckId:t.truckId,driverId:did,type:'Pre-trip',score:passed?100:80,status:passed?'Passed':'Failed',defects,items:{tyres:true,lights:true,brakes:true,fluids:true,documents:true,load:true},driverEasyMode:true});if(passed&&num(t.stage)<2){t.stage=2;t.status='Loading'}if(passed&&leg)leg.status='Loading'}else if(action==='start'){const passed=state.inspections.some(x=>x.tripId===t.id&&x.driverId===did&&x.type==='Pre-trip'&&x.status==='Passed');if(!passed){const e=Error('Complete the pre-trip vehicle check first');e.status=400;throw e}t.stage=3;t.status='In transit';t.startedAt=t.startedAt||now;if(leg){leg.status='In transit';leg.startedAt=leg.startedAt||now;}const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='On trip';const dr=state.drivers.find(x=>x.id===did);if(dr)dr.status='On trip'}else if(action==='arrive'){if(leg){leg.status='At offloading';leg.arrivedAt=leg.arrivedAt||now}t.status='At offloading';t.arrivedAt=t.arrivedAt||now;if(!state.tasks.some(x=>x.linkedId===t.id&&x.legId===leg?.id&&/POD/i.test(x.title)&&x.status==='Open'))state.tasks.unshift({id:mk('task'),title:'Upload POD for '+t.number+(multi&&leg?' · '+leg.label:''),ownerRole:'Driver',linkedType:'trip',linkedId:t.id,legId:leg?.id||'',due:date,priority:'High',status:'Open'})}else if(action==='pod'){if(!data.uploadId){const e=Error('Take a POD photo first');e.status=400;throw e}if(leg){leg.pod=true;leg.podUploadId=data.uploadId;leg.podAt=now;leg.status='Delivered'}state.tasks.filter(x=>x.linkedId===t.id&&(!x.legId||x.legId===leg?.id)&&/POD/i.test(x.title)).forEach(x=>x.status='Completed');const next=legs.find(x=>!['Delivered','Invoiced','Closed'].includes(String(x.status||'')));if(next&&next.id!==leg?.id){next.status='Loading';t.stage=2;t.status='Loading';t.pod=false;t.podUploadId='';t.geo={};}else{t.pod=true;t.podUploadId=data.uploadId;t.podAt=now;t.stage=4;t.status='Delivered'}}else if(action==='finish'){if(legs.some(x=>!x.pod)){const e=Error('POD is required for every journey leg before finishing');e.status=400;throw e}if(!t.pod){const e=Error('POD photo is required before finishing the trip');e.status=400;throw e}t.driverComplete=true;t.driverCompletedAt=now;const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='Available';const dr=state.drivers.find(x=>x.id===did);if(dr)dr.status='Available';if(!state.tasks.some(x=>x.linkedId===t.id&&/Review completed trip/i.test(x.title)&&x.status==='Open'))state.tasks.unshift({id:mk('task'),title:'Review completed trip '+t.number,ownerRole:'Dispatcher',linkedType:'trip',linkedId:t.id,due:date,priority:'Normal',status:'Open'})}else if(action==='diesel'){const litres=num(data.litres),total=num(data.total),price=num(data.price)||(litres>0?total/litres:0);if(litres<=0){const e=Error('Enter diesel litres');e.status=400;throw e}const rec={id:mk('fuel'),tripId:t.id,legId:leg?.id||'',date,truckId:t.truckId,driverId:did,litres,price,total:total>0?total:Number((litres*price).toFixed(2)),odometer:num(data.odometer),supplier:String(data.supplier||''),slip:String(data.slip||''),receiptUploadId:data.uploadId||'',receiptUploadIds:Array.isArray(data.receiptUploadIds)?data.receiptUploadIds.slice(0,2):(data.uploadId?[data.uploadId]:[]),supportingReceiptUploadId:String(data.supportingUploadId||''),receiptCount:Array.isArray(data.receiptUploadIds)?Math.min(2,data.receiptUploadIds.length):(data.uploadId?1:0),verified:false,detectedCategory:String(data.detectedCategory||'Diesel'),categoryConfidence:num(data.categoryConfidence),fuelTransactions:Array.isArray(data.fuelTransactions)?data.fuelTransactions.slice(0,10):[],fuelTransactionCount:num(data.fuelTransactionCount)||1,printedTotal:num(data.printedTotal)||null,receiptAdjustment:data.adjustment===null||data.adjustment===undefined?null:num(data.adjustment),driverEasyMode:true};state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel');t.dieselCost=state.diesel.filter(x=>x.tripId===t.id).reduce((a,x)=>a+(num(x.printedTotal)||num(x.total)||num(x.litres)*num(x.price)),0);t.routeExpenseCost=state.expenses.filter(x=>x.tripId===t.id).reduce((a,x)=>a+num(x.amount),0)}else if(action==='expense'){const amount=num(data.amount);if(amount<=0){const e=Error('Enter the expense amount');e.status=400;throw e}const category=String(data.category||'Other'),supplier=String(data.supplier||'');state.expenses.unshift({id:mk('expense'),date,tripId:t.id,legId:leg?.id||'',truckId:t.truckId,driverId:did,category,supplier,amount,receiptNo:String(data.receiptNo||''),notes:String(data.notes||''),receiptUploadId:data.uploadId||'',receiptUploadIds:Array.isArray(data.receiptUploadIds)?data.receiptUploadIds.slice(0,2):(data.uploadId?[data.uploadId]:[]),supportingReceiptUploadId:String(data.supportingUploadId||''),receiptCount:Array.isArray(data.receiptUploadIds)?Math.min(2,data.receiptUploadIds.length):(data.uploadId?1:0),status:data.uploadId?'Review':'Receipt missing',reimbursable:true,detectedCategory:String(data.detectedCategory||''),categoryConfidence:num(data.categoryConfidence),driverEasyMode:true});rememberSupplierCategory(state,supplier,category);t.routeExpenseCost=state.expenses.filter(x=>x.tripId===t.id).reduce((a,x)=>a+num(x.amount),0);t.dieselCost=state.diesel.filter(x=>x.tripId===t.id).reduce((a,x)=>a+(num(x.printedTotal)||num(x.total)||num(x.litres)*num(x.price)),0)}else if(action==='problem'){const type=String(data.type||'Other'),description=String(data.description||'').trim();state.tripIssues.unshift({id:mk('issue'),date,tripId:t.id,truckId:t.truckId,driverId:did,type,location:String(data.location||''),cost:num(data.cost),description:description||type,action:String(data.actionTaken||''),photoUploadId:data.uploadId||'',status:'Open',driverEasyMode:true})}if(action==='diesel'||action==='expense')recalcTripCosts(state,t);if(clientActionId)state.driverActions.unshift({clientActionId,tripId:t.id,driverId:did,action,at:now});state.driverActions=state.driverActions.slice(0,1000);return{duplicate:false,action,tripId:t.id,number:t.number,status:t.status,stage:t.stage,pod:Boolean(t.pod),driverComplete:Boolean(t.driverComplete)}});if(action==='problem'&&!changed.result.duplicate)createNotification({type:'driver-problem',severity:'warning',title:'Driver reported a trip problem',message:(req.user.name||'Driver')+' reported '+String(data.type||'a problem')+' on trip '+req.params.tripId+'.',role:'dispatcher',linkedType:'trip',linkedId:req.params.tripId}).catch(()=>{});res.status(changed.result.duplicate?200:201).json({...changed.result,revision:changed.revision})}catch(e){res.status(e.status||500).json({error:e.message})}});

app.get('/api/events',auth,(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();res.write('event: ready\ndata: {}\n\n');clients.add(res);req.on('close',()=>clients.delete(res))});

function driverMobileTrip(state,driverId){
  const rows=(state.trips||[]).filter(t=>t.driverId===driverId&&!t.driverComplete&&!['Closed','Invoiced'].includes(t.status));
  const priority=t=>{const x=String(t.status||'').toLowerCase();if(/loading|to loading|loaded|departure pending|in transit|at offloading|awaiting pod|return journey/.test(x))return 500;if(/planned|assigned|booked|at loading/.test(x))return 400;if(/delivered/.test(x)&&!t.pod)return 250;if(/delivered/.test(x)&&!t.driverComplete)return 200;return 100};
  rows.sort((a,b)=>priority(b)-priority(a)||(new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0))||String(b.number||'').localeCompare(String(a.number||''),undefined,{numeric:true}));
  return rows[0]||null
}
app.post('/api/mobile/register',auth,roles('driver'),async(req,res)=>{
  try{
    const deviceId=String(req.body.deviceId||'').trim().slice(0,160);if(!deviceId)return res.status(400).json({error:'deviceId is required'});
    const token=crypto.randomBytes(32).toString('base64url'),hash=deviceTokenHash(token),name=String(req.body.name||'Android Driver').slice(0,120),platform=String(req.body.platform||'android').slice(0,40),id=crypto.randomUUID();
    if(pool){
      await q('INSERT INTO mobile_devices(id,device_id,user_id,driver_id,token_hash,name,platform,active,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,true,now()) ON CONFLICT(device_id) DO UPDATE SET user_id=excluded.user_id,driver_id=excluded.driver_id,token_hash=excluded.token_hash,name=excluded.name,platform=excluded.platform,active=true,last_seen=now()',[id,deviceId,req.user.sub,req.user.driverId,hash,name,platform])
    }else{
      let d=memory.mobileDevices.find(x=>x.deviceId===deviceId);
      if(d)Object.assign(d,{userId:req.user.sub,driverId:req.user.driverId,tokenHash:hash,name,platform,active:true,lastSeen:new Date().toISOString()});
      else memory.mobileDevices.push({id,deviceId,userId:req.user.sub,driverId:req.user.driverId,tokenHash:hash,name,platform,active:true,lastSeen:new Date().toISOString()})
    }
    res.status(201).json({deviceToken:token,driverId:req.user.driverId})
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/mobile/revoke',deviceAuth,async(req,res)=>{
  if(pool)await q('UPDATE mobile_devices SET active=false WHERE id=$1',[req.device.id]);else req.device.active=false;
  res.json({success:true})
});
app.get('/api/mobile/context',deviceAuth,async(req,res)=>{
  const state=await readOpsState(),t=driverMobileTrip(state,req.user.driverId),leg=t?activeTripLegServer(t):null;
  res.json({driverId:req.user.driverId,trip:t?{id:t.id,number:t.number,truckId:t.truckId,status:t.status}:null,leg:leg?{id:leg.id,sequence:leg.sequence,label:leg.label,routeId:leg.routeId,status:leg.status}:null})
});
app.post('/api/mobile/gps',deviceAuth,async(req,res)=>{
  try{
    const state=await readOpsState(),t=driverMobileTrip(state,req.user.driverId);
    if(!t)return res.status(204).end();
    req.body={...req.body,vehicleId:t.truckId,driverId:req.user.driverId,tripId:t.id};
    return gpsIn(req,res,'android-background')
  }catch(e){res.status(500).json({error:e.message})}
});
app.post('/api/gps',auth,async(req,res)=>gpsIn(req,res,'driver'));
app.post('/api/integrations/telematics/webhook',async(req,res)=>{if(req.headers['x-telematics-token']!==process.env.TELEMATICS_WEBHOOK_TOKEN)return res.status(401).json({error:'Invalid webhook token'});req.user={sub:'telematics'};return gpsIn(req,res,'telematics')});
app.post('/api/integrations/traccar/position',async(req,res)=>{
  const expected=process.env.TRACCAR_FORWARD_TOKEN||process.env.TELEMATICS_WEBHOOK_TOKEN;
  const supplied=String(req.headers['x-traccar-token']||req.headers['x-telematics-token']||'');
  if(!expected||supplied!==expected)return res.status(401).json({error:'Invalid Traccar forwarding token'});
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{},position=body.position&&typeof body.position==='object'?body.position:body,device=body.device&&typeof body.device==='object'?body.device:{};
    const uniqueId=String(device.uniqueId||body.uniqueId||body.deviceUniqueId||'').trim();
    if(!uniqueId)return res.status(400).json({error:'Traccar device uniqueId is required'});
    const state=await readOpsState(),truck=(state.trucks||[]).find(t=>[t.trackerId,t.trackerImei,t.imei].filter(Boolean).some(v=>String(v).trim()===uniqueId));
    if(!truck)return res.status(404).json({error:'No truck is linked to tracker '+uniqueId});
    const rawSpeed=Number(position.speed),speedUnit=String(body.speedUnit||'knots').toLowerCase(),speedKmh=Number.isFinite(rawSpeed)?(speedUnit==='kmh'||speedUnit==='km/h'?rawSpeed:rawSpeed*1.852):0;
    req.user={sub:'traccar',driverId:null};
    req.body={vehicleId:truck.id,latitude:position.latitude,longitude:position.longitude,speed:speedKmh,heading:position.course??position.heading??0,accuracy:position.accuracy??null,recordedAt:position.fixTime||position.deviceTime||position.serverTime||new Date().toISOString(),trackerId:uniqueId,ignition:position.attributes?.ignition,motion:position.attributes?.motion};
    return gpsIn(req,res,'telematics')
  }catch(e){res.status(500).json({error:e.message})}
});
async function gpsIn(req,res,source){const p={vehicleId:String(req.body.vehicleId||req.body.vehicle_id||''),driverId:req.body.driverId||req.user.driverId||null,tripId:req.body.tripId||null,latitude:Number(req.body.latitude),longitude:Number(req.body.longitude),speed:num(req.body.speed),heading:num(req.body.heading),accuracy:req.body.accuracy==null?null:num(req.body.accuracy),source,recordedAt:req.body.recordedAt||new Date().toISOString()};if(!p.vehicleId||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))return res.status(400).json({error:'vehicleId, latitude and longitude are required'});if(pool)await q('INSERT INTO gps_positions(vehicle_id,driver_id,trip_id,latitude,longitude,speed,heading,accuracy,source,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.vehicleId,p.driverId,p.tripId,p.latitude,p.longitude,p.speed,p.heading,p.accuracy,p.source,p.recordedAt]);else memory.gps.push(p);await evaluateGeofences(p);await evaluateTripZones(p);emit('gps',p);res.status(201).json(p)}
app.patch('/api/admin/diesel/:id',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const changed=await mutateOpsState(async state=>{
      state.diesel??=[];const rec=state.diesel.find(x=>x.id===req.params.id);if(!rec){const e=Error('Diesel record not found');e.status=404;throw e}
      const oldTrip=(state.trips||[]).find(x=>x.id===rec.tripId);
      for(const key of ['litres','price','odometer','printedTotal'])if(body[key]!==undefined)rec[key]=num(body[key]);
      for(const key of ['supplier','slip'])if(body[key]!==undefined)rec[key]=String(body[key]||'');
      if(body.verified!==undefined)rec.verified=Boolean(body.verified);
      if(body.status!==undefined)rec.status=String(body.status||'');
      if(num(rec.litres)<=0){const e=Error('Diesel litres must be greater than zero');e.status=400;throw e}
      if(num(rec.printedTotal)<=0&&num(rec.price)<=0){const e=Error('Enter a receipt total or price per litre');e.status=400;throw e}
      if(num(rec.printedTotal)>0&&num(rec.litres)>0)rec.price=Number((num(rec.printedTotal)/num(rec.litres)).toFixed(4));
      rec.reviewedAt=new Date().toISOString();rec.reviewedBy=req.user.sub;
      if(oldTrip)recalcTripCosts(state,oldTrip);
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:(rec.verified?'Approved':'Updated')+' diesel record '+rec.id+' for '+(oldTrip?.number||rec.tripId),linkedType:'trip',linkedId:rec.tripId});state.audit=state.audit.slice(0,100);
      return rec
    });
    res.json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.delete('/api/admin/diesel/:id',auth,roles('admin','manager','finance'),async(req,res)=>{
  try{
    const changed=await mutateOpsState(async state=>{
      state.diesel??=[];const i=state.diesel.findIndex(x=>x.id===req.params.id);if(i<0){const e=Error('Diesel record not found');e.status=404;throw e}
      const [rec]=state.diesel.splice(i,1),t=(state.trips||[]).find(x=>x.id===rec.tripId);if(t)recalcTripCosts(state,t);
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'Deleted diesel record '+rec.id+' from '+(t?.number||rec.tripId)+'; archived receipt file retained',linkedType:'trip',linkedId:rec.tripId});state.audit=state.audit.slice(0,100);
      return{deleted:true,id:rec.id,tripId:rec.tripId}
    });
    res.json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.get('/api/gps/latest',auth,async(req,res)=>{const rows=pool?await q("SELECT DISTINCT ON(vehicle_id) vehicle_id AS \"vehicleId\",driver_id AS \"driverId\",trip_id AS \"tripId\",latitude,longitude,speed,heading,accuracy,source,recorded_at AS \"recordedAt\" FROM gps_positions WHERE source IN ('telematics','truck-device','tracker','vehicle-tracker') ORDER BY vehicle_id,recorded_at DESC"):Object.values(memory.gps.filter(x=>trustedVehicleGpsSource(x.source)).reduce((a,x)=>(a[x.vehicleId]=x,a),{}));res.json(rows)});
app.get('/api/gps/history/:vehicleId',auth,async(req,res)=>{const hours=Math.min(168,Math.max(1,num(req.query.hours)||24)),rows=pool?await q('SELECT vehicle_id AS "vehicleId",latitude,longitude,speed,heading,recorded_at AS "recordedAt" FROM gps_positions WHERE vehicle_id=$1 AND recorded_at>now()-($2||\' hours\')::interval ORDER BY recorded_at',[req.params.vehicleId,String(hours)]):memory.gps.filter(x=>x.vehicleId===req.params.vehicleId&&Date.now()-new Date(x.recordedAt)<hours*3600000);res.json(rows)});
app.get('/api/geofences',auth,async(req,res)=>res.json(pool?await q('SELECT id,name,latitude,longitude,radius_m AS "radiusM",event_types AS "eventTypes",kind,active FROM geofences ORDER BY name'):memory.geofences));
app.post('/api/geofences',auth,roles('admin','manager','dispatcher'),async(req,res)=>{
  const requested=String(req.body.kind||'custom').toLowerCase(),kind=['depot','loading','offloading','operating_area','custom'].includes(requested)?requested:'custom';
  const f={id:crypto.randomUUID(),name:String(req.body.name||''),latitude:Number(req.body.latitude),longitude:Number(req.body.longitude),radiusM:Number(req.body.radiusM||500),eventTypes:req.body.eventTypes||['enter','exit'],kind,active:true};
  if(!f.name||!Number.isFinite(f.latitude)||!Number.isFinite(f.longitude))return res.status(400).json({error:'name, latitude and longitude required'});
  if(pool)await q('INSERT INTO geofences(id,name,latitude,longitude,radius_m,event_types,kind) VALUES($1,$2,$3,$4,$5,$6,$7)',[f.id,f.name,f.latitude,f.longitude,f.radiusM,f.eventTypes,f.kind]);else memory.geofences.push(f);
  emit('geofence',f);res.status(201).json(f)
});
app.patch('/api/geofences/:id',auth,roles('admin','manager','dispatcher'),async(req,res)=>{
  const id=String(req.params.id),name=String(req.body.name||'').trim(),latitude=Number(req.body.latitude),longitude=Number(req.body.longitude),radiusM=Number(req.body.radiusM),requested=String(req.body.kind||'custom').toLowerCase(),kind=['depot','loading','offloading','operating_area','custom'].includes(requested)?requested:'custom';
  if(!name||name.length>160||!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180||!Number.isFinite(radiusM)||radiusM<5||radiusM>50000)return res.status(400).json({error:'Enter a name, valid coordinates and a radius from 5 to 50,000 m'});
  if(pool){
    const c=await pool.connect();let updated;
    try{await c.query('BEGIN');const result=await c.query('UPDATE geofences SET name=$2,latitude=$3,longitude=$4,radius_m=$5,kind=$6 WHERE id=$1 RETURNING id,name,latitude,longitude,radius_m AS "radiusM",event_types AS "eventTypes",kind,active',[id,name,latitude,longitude,radiusM,kind]);updated=result.rows[0];if(!updated){await c.query('ROLLBACK');return res.status(404).json({error:'Geofence not found'})}await c.query('DELETE FROM geofence_state WHERE geofence_id=$1',[id]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');return res.status(500).json({error:e.message})}finally{c.release()}
    emit('geofence',updated);return res.json(updated)
  }
  const f=memory.geofences.find(x=>x.id===id);if(!f)return res.status(404).json({error:'Geofence not found'});
  Object.assign(f,{name,latitude,longitude,radiusM,kind,states:{}});emit('geofence',f);res.json(f)
});
app.delete('/api/geofences/:id',auth,roles('admin','manager','dispatcher'),async(req,res)=>{
  const id=String(req.params.id);
  if(pool){const rows=await q('DELETE FROM geofences WHERE id=$1 RETURNING id,name',[id]);if(!rows.length)return res.status(404).json({error:'Geofence not found'});emit('geofence-delete',{id,name:rows[0].name});return res.json({success:true,id})}
  const i=memory.geofences.findIndex(x=>x.id===id);if(i<0)return res.status(404).json({error:'Geofence not found'});const [removed]=memory.geofences.splice(i,1);emit('geofence-delete',{id,name:removed.name});res.json({success:true,id})
});
app.get('/api/notifications',auth,async(req,res)=>res.json(pool?await q(`SELECT id,type,severity,title,message,role,driver_id AS "driverId",linked_type AS "linkedType",linked_id AS "linkedId",read,created_at AS "createdAt" FROM notifications WHERE (role IS NULL OR role=$1) AND ($1<>'driver' OR driver_id IS NULL OR driver_id=$2) ORDER BY created_at DESC LIMIT 100`,[req.user.role,req.user.driverId||null]):memory.notifications.filter(x=>(!x.role||x.role===req.user.role)&&(req.user.role!=='driver'||!x.driver_id||x.driver_id===req.user.driverId)).slice(0,100)));
app.patch('/api/notifications/:id/read',auth,async(req,res)=>{if(pool)await q('UPDATE notifications SET read=true WHERE id=$1',[req.params.id]);else{const n=memory.notifications.find(x=>x.id===req.params.id);if(n)n.read=true}res.json({success:true})});
app.get('/api/push/status',auth,async(req,res)=>{
  let count=0;
  if(pool)count=num((await q('SELECT count(*)::int AS count FROM push_subscriptions WHERE user_id=$1',[req.user.sub]))[0]?.count);
  else count=memory.subscriptions.filter(x=>x.userId===req.user.sub).length;
  res.json({providerConfigured:Boolean(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY),subscriptionCount:count,subscribed:count>0})
});
app.post('/api/push/subscribe',auth,async(req,res)=>{
  const sub=req.body&&typeof req.body==='object'?req.body:null,endpoint=String(sub?.endpoint||'');
  if(!endpoint)return res.status(400).json({error:'Push subscription endpoint is required'});
  if(pool){
    await q("DELETE FROM push_subscriptions WHERE subscription->>'endpoint'=$1",[endpoint]);
    await q('INSERT INTO push_subscriptions(user_id,subscription) VALUES($1,$2)',[req.user.sub,sub]);
  }else{
    memory.subscriptions=memory.subscriptions.filter(x=>String(x.subscription?.endpoint||'')!==endpoint);
    memory.subscriptions.push({userId:req.user.sub,role:req.user.role,driverId:req.user.driverId||null,subscription:sub});
  }
  res.status(201).json({success:true})
});
app.post('/api/push/test-device',auth,async(req,res)=>{
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(503).json({error:'VAPID is not configured'});
  let subs=[];
  if(pool)subs=await q('SELECT id,subscription FROM push_subscriptions WHERE user_id=$1',[req.user.sub]);
  else subs=memory.subscriptions.filter(x=>x.userId===req.user.sub);
  if(!subs.length)return res.status(409).json({error:'This account has no registered push subscription. Enable push on this phone first.'});
  let sent=0,failed=0,stale=0;
  for(const row of subs){
    try{
      await webpush.sendNotification(row.subscription||row,JSON.stringify({title:'Angermund Transport push test',body:'Push notifications are working on this device.',linkedType:'test',linkedId:'push-test',url:'/'}));
      sent++
    }catch(e){
      failed++;const code=num(e.statusCode);
      if(code===404||code===410){stale++;if(pool&&row.id)await q('DELETE FROM push_subscriptions WHERE id=$1',[row.id]);else memory.subscriptions=memory.subscriptions.filter(x=>x!==row)}
      else console.error('Push test failed',code||'',e.message)
    }
  }
  if(!sent)return res.status(502).json({error:stale?'The saved push subscription was stale and has been removed. Enable push on this phone again.':'Push provider rejected the test notification.',sent,failed,stale});
  res.json({success:true,sent,failed,stale})
});
app.get('/api/config',auth,(req,res)=>res.json({vapidPublicKey:process.env.VAPID_PUBLIC_KEY||null,mapStyle:process.env.MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/liberty',providers:{whatsapp:Boolean(process.env.META_WHATSAPP_TOKEN),email:Boolean(process.env.RESEND_API_KEY),push:Boolean(process.env.VAPID_PUBLIC_KEY),telematics:Boolean(process.env.TELEMATICS_WEBHOOK_TOKEN||process.env.TRACCAR_FORWARD_TOKEN),maps:'OpenFreeMap'}}));
app.post('/api/export/:kind',auth,async(req,res)=>{const title=String(req.body.title||req.params.kind).slice(0,80),columns=Array.isArray(req.body.columns)?req.body.columns:[],rows=Array.isArray(req.body.rows)?req.body.rows:[];if(!columns.length)return res.status(400).json({error:'Export columns required'});const book=new ExcelJS.Workbook();book.creator='Angermund Transport';book.created=new Date();const cover=book.addWorksheet('Angermund Transport');cover.getColumn(1).width=44;cover.getColumn(2).width=25;cover.getRow(1).height=100;const brandImage=book.addImage({buffer:fs.readFileSync(path.join(root,'angermund-logo.png')),extension:'png'});cover.addImage(brandImage,{tl:{col:0,row:0},ext:{width:340,height:120}});cover.getCell('A6').value='ANGERMUND TRANSPORT CC';cover.getCell('A6').font={name:'Aptos Display',size:18,bold:true,color:{argb:'FF101E80'}};cover.getCell('A8').value=title;cover.getCell('A8').font={name:'Aptos',size:14,bold:true};cover.getCell('A9').value=`Exported ${new Date().toLocaleString('en-NA',{timeZone:'Africa/Windhoek'})}`;cover.getCell('A10').value=`${rows.length} record(s)`;const sheet=book.addWorksheet(title.slice(0,31)||'Export',{views:[{state:'frozen',ySplit:4}]});sheet.properties.defaultRowHeight=20;sheet.mergeCells(1,1,1,columns.length);const heading=sheet.getCell(1,1);heading.value=`Angermund Transport CC — ${title}`;heading.font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0B2035'}};heading.alignment={vertical:'middle'};sheet.getRow(1).height=30;sheet.mergeCells(2,1,2,columns.length);sheet.getCell(2,1).value=`Exported ${new Date().toLocaleString('en-NA',{timeZone:'Africa/Windhoek'})}`;sheet.getCell(2,1).font={name:'Aptos',size:10,italic:true,color:{argb:'FF5E7184'}};sheet.getRow(4).values=columns.map(c=>c.label);sheet.getRow(4).eachCell(c=>{c.font={name:'Aptos',bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1769AA'}};c.alignment={vertical:'middle',horizontal:'center'}});for(const source of rows){const values=columns.map(c=>source[c.key]??'');const row=sheet.addRow(values);row.eachCell((cell,index)=>{cell.font={name:'Aptos',size:10};cell.alignment={vertical:'middle',wrapText:false};const col=columns[index-1];if(col.type==='currency')cell.numFmt='N$ #,##0.00';else if(col.type==='number')cell.numFmt='#,##0.00';else if(col.type==='date'&&cell.value)cell.numFmt='yyyy-mm-dd'})}columns.forEach((c,i)=>{let width=Math.max(12,c.label.length+2);for(const row of rows.slice(0,200))width=Math.max(width,String(row[c.key]??'').length+2);sheet.getColumn(i+1).width=Math.min(42,width)});sheet.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,rows.length+4),column:columns.length}};sheet.getRow(rows.length+5).getCell(1).value=`${rows.length} record(s)`;sheet.getRow(rows.length+5).getCell(1).font={italic:true,color:{argb:'FF5E7184'}};const buffer=await book.xlsx.writeBuffer();res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${req.params.kind}-${new Date().toISOString().slice(0,10)}.xlsx"`});res.send(Buffer.from(buffer))});
app.post('/api/documents/scan',auth,upload.single('document'),async(req,res)=>{if(!req.file)return res.status(400).json({error:'Document image required'});const id=crypto.randomUUID(),row={id,user_id:req.user.sub,filename:req.file.originalname,status:'processing'};if(pool)await q('INSERT INTO scan_jobs(id,user_id,filename,status) VALUES($1,$2,$3,$4)',[id,row.user_id,row.filename,row.status]);else memory.scanJobs.push({...row,rawText:null,extracted:null,confidence:null,error:null,createdAt:new Date().toISOString(),completedAt:null});res.status(202).json({id,status:'processing'});(async()=>{try{const result=await recognizeReceiptBest(req.file.buffer),state=await readOpsState().catch(()=>({})),extractions=result.results.map(r=>extractReceiptFields(r.text,state)),extracted=mergeReceiptExtractions(extractions),raw=result.results.map(r=>'['+r.label+']\n'+r.text).join('\n\n--- OCR PASS ---\n\n'),confidence=result.best.confidence;if(pool)await q('UPDATE scan_jobs SET status=$2,raw_text=$3,extracted=$4,confidence=$5,completed_at=now() WHERE id=$1',[id,'review',raw,extracted,confidence]);else{const m=memory.scanJobs.find(x=>x.id===id);if(m)Object.assign(m,{status:'review',rawText:raw,extracted,confidence,completedAt:new Date().toISOString()})}emit('scan',{id,status:'review',extracted,confidence,ocrMode:'merged'})}catch(e){if(pool)await q('UPDATE scan_jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[id,'failed',e.message]);else{const m=memory.scanJobs.find(x=>x.id===id);if(m)Object.assign(m,{status:'failed',error:e.message,completedAt:new Date().toISOString()})}emit('scan',{id,status:'failed',error:e.message})}})()});
app.get('/api/documents/scans/:id',auth,async(req,res)=>{const row=pool?(await q('SELECT id,filename,status,raw_text AS "rawText",extracted,confidence,error,created_at AS "createdAt",completed_at AS "completedAt" FROM scan_jobs WHERE id=$1',[req.params.id]))[0]:memory.scanJobs.find(x=>x.id===req.params.id);if(!row)return res.status(404).json({error:'Scan not found'});res.json(row)});
app.post('/api/notifications/test',auth,roles('admin','manager'),async(req,res)=>res.status(201).json(await createNotification({type:'test',severity:'info',title:'Angermund Transport test alert',message:'Notification providers are connected and working.'})));

async function ensureMonthEndPayroll(){
  try{
    const na=new Date(Date.now()+2*60*60*1000),y=na.getUTCFullYear(),m=na.getUTCMonth(),day=na.getUTCDate(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
    let period=null;if(day===last)period=y+'-'+String(m+1).padStart(2,'0');else if(day<=3){const p=new Date(Date.UTC(y,m-1,1));period=p.getUTCFullYear()+'-'+String(p.getUTCMonth()+1).padStart(2,'0')}
    if(!period)return;
    const snapshot=await readOpsState(),drivers=snapshot.drivers||[],rows=snapshot.payroll||[];
    const missing=drivers.some(d=>payrollProfile(snapshot,d.id).autoGenerate!==false&&!rows.some(x=>x.period===period&&x.employeeId===d.id));
    if(!missing)return;
    await mutateOpsState(state=>generatePayrollPeriod(state,period,true))
  }catch(e){console.error('Month-end payroll check failed',e.message)}
}
app.get('/download/android',(req,res)=>res.redirect(302,'https://github.com/zjondreangermund/Angermund-Transport/releases/download/android-latest/Angermund-Transport.apk'));
app.get('/login',(req,res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');res.sendFile(path.join(root,'index.html'))});app.use(express.static(root,{maxAge:'1h',setHeaders:(res,file)=>{if(file.endsWith('.html')||file.endsWith('/app.js')||file.endsWith('/styles.css')||file.endsWith('/sw.js'))res.setHeader('Cache-Control','no-store, no-cache, must-revalidate')}}));app.use((req,res)=>res.sendFile(path.join(root,'index.html')));
initDb().then(()=>{if(process.argv.includes('--init-only'))return pool?.end();app.listen(PORT,()=>console.log(`Angermund Transport V3 running on port ${PORT}`));setTimeout(ensureMonthEndPayroll,15000);setInterval(ensureMonthEndPayroll,6*60*60*1000)}).catch(e=>{console.error('Startup failed',e);process.exit(1)});
