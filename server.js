const express=require('express'),path=require('path'),fs=require('fs'),crypto=require('crypto'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs'),multer=require('multer'),webpush=require('web-push'),ExcelJS=require('exceljs');
const {Pool}=require('pg');const {createWorker}=require('tesseract.js');
const app=express(),root=path.join(__dirname,'public'),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:12*1024*1024}});
const PORT=process.env.PORT||3000,JWT_SECRET=process.env.JWT_SECRET||'development-only-change-before-production',DATABASE_URL=process.env.DATABASE_URL;
const num=value=>Number(value||0);
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||'';
const RECEIPT_AI_PRIMARY_MODEL=process.env.RECEIPT_AI_PRIMARY_MODEL||'gpt-6-luna';
const RECEIPT_AI_ESCALATION_MODEL=process.env.RECEIPT_AI_ESCALATION_MODEL||'gpt-6-sol';
const RECEIPT_AI_SOL_THRESHOLD=Math.max(0,Math.min(100,num(process.env.RECEIPT_AI_SOL_THRESHOLD)||82));

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
function uploadCategoryFromKind(kind){
  const k=String(kind||'').toLowerCase();
  if(k.includes('diesel')||k.includes('fuel'))return'Diesel';
  if(k.includes('pod'))return'POD';
  if(k.includes('problem'))return'Problem';
  if(k.includes('expense')||k.includes('receipt')||k.includes('slip'))return'Expense';
  return'Document'
}
function jpegsToPdfBuffer(jpegs){
  const imgs=(jpegs||[]).filter(Buffer.isBuffer).map(buf=>({buf,dim:jpegDimensions(buf)})).filter(x=>x.dim);
  if(!imgs.length)return null;
  const pageW=595.28,pageH=841.89,margin=18,totalObjects=2+imgs.length*3;
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];let total=parts[0].length;
  const add=(n,chunks)=>{offsets[n]=total;const head=Buffer.from(n+' 0 obj\n','ascii'),tail=Buffer.from('\nendobj\n','ascii');parts.push(head,...chunks,tail);total+=head.length+chunks.reduce((a,b)=>a+b.length,0)+tail.length};
  const pageIds=imgs.map((_,i)=>3+i*3);
  add(1,[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>','ascii')]);
  add(2,[Buffer.from('<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+imgs.length+' >>','ascii')]);
  imgs.forEach((img,i)=>{
    const pageId=3+i*3,imageId=pageId+1,contentId=pageId+2;
    const scale=Math.min((pageW-margin*2)/img.dim.width,(pageH-margin*2)/img.dim.height),drawW=img.dim.width*scale,drawH=img.dim.height*scale,x=(pageW-drawW)/2,y=(pageH-drawH)/2;
    const content=Buffer.from('q\n'+drawW.toFixed(2)+' 0 0 '+drawH.toFixed(2)+' '+x.toFixed(2)+' '+y.toFixed(2)+' cm\n/Im'+i+' Do\nQ\n','ascii');
    add(pageId,[Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pageW+' '+pageH+'] /Resources << /XObject << /Im'+i+' '+imageId+' 0 R >> >> /Contents '+contentId+' 0 R >>','ascii')]);
    add(imageId,[Buffer.from('<< /Type /XObject /Subtype /Image /Width '+img.dim.width+' /Height '+img.dim.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+img.buf.length+' >>\nstream\n','ascii'),img.buf,Buffer.from('\nendstream','ascii')]);
    add(contentId,[Buffer.from('<< /Length '+content.length+' >>\nstream\n','ascii'),content,Buffer.from('endstream','ascii')])
  });
  const xrefAt=total,xref=['xref','0 '+(totalObjects+1),'0000000000 65535 f '];
  for(let n=1;n<=totalObjects;n++)xref.push(String(offsets[n]||0).padStart(10,'0')+' 00000 n ');
  xref.push('trailer','<< /Size '+(totalObjects+1)+' /Root 1 0 R >>','startxref',String(xrefAt),'%%EOF','');
  parts.push(Buffer.from(xref.join('\n'),'ascii'));
  return Buffer.concat(parts)
}
function archiveStoredFiles(files){
  const list=(files||[]).filter(Boolean);
  if(!list.length)return null;
  if(list.length===1)return archiveStoredFile(list[0]);
  const jpgs=list.filter(f=>/^image\/jpe?g$/i.test(String(f.mimetype||'')));
  if(jpgs.length===list.length){
    const pdf=jpegsToPdfBuffer(jpgs.map(f=>f.buffer));
    if(pdf){
      const base=String(jpgs[0].originalname||'receipt').replace(/\.[^.]+$/,'');
      return{buffer:pdf,mimeType:'application/pdf',filename:base+'-'+list.length+'pages.pdf',originalSize:list.reduce((a,f)=>a+(f.buffer?.length||0),0),size:pdf.length,convertedToPdf:true,pageCount:list.length}
    }
  }
  return archiveStoredFile(list[0])
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
  if(has(/mass\s*distance|\bmdc\b|road\s*fund\s*administration|\brfa\b.*(?:distance|charge)|distance\s*charge/))return{category:'Mass distance charge (MDC)',confidence:97,reason:'RFA / mass-distance charge wording detected',source:'ocr'};
  if(has(/customs\s*(?:clearance|entry|declaration)?|clearing\s*(?:agent|fee)|customs\s*broker|sad\s*500|import\s*dut(?:y|ies)|export\s*clearance/))return{category:'Customs / clearing',confidence:96,reason:'Customs or clearing wording detected',source:'ocr'};
  if(has(/abnormal\s*load\s*permit|road\s*permit|road\s*fund|\brfa\b|cross[ -]?border\s*permit|transit\s*permit/))return{category:'Road permit / RFA',confidence:94,reason:'Road permit/RFA wording detected',source:'ocr'};
  if(has(/border\s*post|border\s*permit|entry\s*permit|immigration\s*fee|cross[ -]?border\s*fee/))return{category:'Border permit',confidence:94,reason:'Border/entry permit wording detected',source:'ocr'};
  if(has(/weighbridge|weigh\s*bridge|weighing\s*fee|axle\s*mass|gross\s*vehicle\s*mass/))return{category:'Weighbridge',confidence:95,reason:'Weighbridge wording detected',source:'ocr'};
  if(has(/ferry|pontoon|river\s*crossing|crossing\s*fee/))return{category:'Ferry / crossing',confidence:93,reason:'Ferry/crossing wording detected',source:'ocr'};
  if(has(/wash\s*bay|truck\s*wash|vehicle\s*wash|car\s*wash/))return{category:'Wash bay',confidence:93,reason:'Vehicle wash wording detected',source:'ocr'};
  if(has(/tyre|tire|puncture|wheel\s*alignment|wheel\s*balanc|tube\s*repair/))return{category:'Tyre repair',confidence:95,reason:'Tyre/wheel repair wording detected',source:'ocr'};
  if(has(/breakdown\s*(?:part|spare)|roadside\s*part|emergency\s*part/))return{category:'Breakdown parts',confidence:94,reason:'Breakdown parts wording detected',source:'ocr'};
  if(has(/workshop|mechanic|battery|brake|spare\s*part|auto\s*parts|vehicle\s*repair|repair\s*labou?r/))return{category:'Emergency repair',confidence:91,reason:'Vehicle repair/parts wording detected',source:'ocr'};
  if(has(/hardware|lubricant|oil\s*filter|service\s*part|workshop\s*supply|spares\s*shop/))return{category:'Workshop / spares',confidence:88,reason:'Workshop/spares wording detected',source:'ocr'};
  if(has(/traffic\s*fine|police\s*fine|speeding\s*fine|notice\s*of\s*offence|admission\s*of\s*guilt/))return{category:'Police / traffic fine',confidence:95,reason:'Traffic/police fine wording detected',source:'ocr'};
  if(has(/offload|offloading|loading\s*fee|handling\s*fee|warehouse|forklift|cargo\s*handling|labou?r\s*fee/))return{category:'Loading / offloading',confidence:90,reason:'Loading/handling wording detected',source:'ocr'};
  if(has(/\bparking\b|parkade|parking\s*ticket|entry\s*time|exit\s*time/))return{category:'Parking',confidence:94,reason:'Parking wording detected',source:'ocr'};
  if(has(/hotel|lodge|guest\s*house|guesthouse|accommodation|room\s*(?:no|number|rate)|check[ -]?in|check[ -]?out|overnight/))return{category:'Accommodation',confidence:92,reason:'Hotel/lodge/room wording detected',source:'ocr'};
  if(has(/restaurant|take[ -]?away|\bfood\b|\bmeal\b|burger|chicken|pizza|coffee|cafe|\bkfc\b|hungry\s*lion|wimpy|steers|spur|nando'?s|debonairs|shoprite|checkers|pick\s*n\s*pay|woermann|\bspar\b|grocery|grocer/))return{category:'Meals',confidence:89,reason:'Food/restaurant wording detected',source:'ocr'};
  if(has(/stationery|general\s*supply|consumable|cleaning\s*supply|office\s*supply/))return{category:'General supplies',confidence:82,reason:'General supplies wording detected',source:'ocr'};
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

function receiptDateISO(value){
  const s=String(value||'').trim();if(!s)return'';
  const iso=s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if(iso){const y=Number(iso[1]),m=Number(iso[2]),d=Number(iso[3]);if(m>=1&&m<=12&&d>=1&&d<=31)return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
  const dmy=s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/);
  if(dmy){let d=Number(dmy[1]),m=Number(dmy[2]),y=Number(dmy[3]);if(y<100)y+=2000;if(m>=1&&m<=12&&d>=1&&d<=31)return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
  const named=s.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2}|\d{2})\b/i);
  if(named){const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12},d=Number(named[1]),m=months[named[2].slice(0,4).toLowerCase()]||months[named[2].slice(0,3).toLowerCase()],y=Number(named[3])+(Number(named[3])<100?2000:0);if(m&&d>=1&&d<=31)return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
  return''
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
    date:receiptDateISO((text.match(/\b(?:20\d{2}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4})\b/)||[])[0])||null,
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


const RECEIPT_AI_CATEGORIES=['Diesel','Toll','Meals','Accommodation','Parking','Border permit','Customs / clearing','Road permit / RFA','Mass distance charge (MDC)','Weighbridge','Loading / offloading','Ferry / crossing','Wash bay','Tyre repair','Emergency repair','Breakdown parts','Workshop / spares','Police / traffic fine','General supplies','Other'];
const RECEIPT_AI_SCHEMA={
  type:'object',
  properties:{
    supplier:{type:'string'},
    documentNumber:{type:'string'},
    date:{type:'string'},
    registration:{type:'string'},
    odometer:{type:'number'},
    suggestedAmount:{type:'number'},
    printedTotal:{type:'number'},
    litres:{type:'number'},
    pricePerLitre:{type:'number'},
    category:{type:'string',enum:RECEIPT_AI_CATEGORIES},
    categoryConfidence:{type:'integer'},
    extractionConfidence:{type:'integer'},
    fuelTransactions:{type:'array',items:{type:'object',properties:{litres:{type:'number'},pricePerLitre:{type:'number'},amount:{type:'number'}},required:['litres','pricePerLitre','amount'],additionalProperties:false}},
    needsReview:{type:'boolean'},
    explanation:{type:'string'}
  },
  required:['supplier','documentNumber','date','registration','odometer','suggestedAmount','printedTotal','litres','pricePerLitre','category','categoryConfidence','extractionConfidence','fuelTransactions','needsReview','explanation'],
  additionalProperties:false
};
function receiptImageMime(buffer,declared=''){
  if(!Buffer.isBuffer(buffer)||buffer.length<12)return null;
  if(buffer[0]===0xff&&buffer[1]===0xd8)return'image/jpeg';
  if(buffer[0]===0x89&&buffer.toString('ascii',1,4)==='PNG')return'image/png';
  if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return'image/webp';
  if(buffer.toString('ascii',0,3)==='GIF')return'image/gif';
  const m=String(declared||'').toLowerCase();
  return /^image\/(jpeg|jpg|png|webp|gif)$/.test(m)?(m==='image/jpg'?'image/jpeg':m):null
}
function normalizeAiReceipt(raw,model){
  const n=v=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:null},text=v=>String(v||'').trim();
  const category=RECEIPT_AI_CATEGORIES.includes(raw?.category)?raw.category:'Other';
  const fuelTransactions=(Array.isArray(raw?.fuelTransactions)?raw.fuelTransactions:[]).map(x=>({litres:n(x.litres)||0,pricePerLitre:n(x.pricePerLitre)||0,amount:n(x.amount)||0})).filter(x=>x.litres>0&&x.amount>0);
  return{
    supplier:text(raw?.supplier)||null,
    documentNumber:text(raw?.documentNumber)||null,
    date:receiptDateISO(raw?.date)||null,
    registration:text(raw?.registration)||null,
    odometer:n(raw?.odometer),
    suggestedAmount:n(raw?.suggestedAmount),
    printedTotal:n(raw?.printedTotal),
    litres:n(raw?.litres),
    pricePerLitre:n(raw?.pricePerLitre),
    category,
    categoryConfidence:Math.max(0,Math.min(100,Math.round(num(raw?.categoryConfidence)))),
    extractionConfidence:Math.max(0,Math.min(100,Math.round(num(raw?.extractionConfidence)))),
    fuelTransactions,
    fuelTransactionCount:fuelTransactions.length,
    needsReview:Boolean(raw?.needsReview),
    categoryReason:text(raw?.explanation)||'AI vision extraction',
    categorySource:'openai-'+model,
    aiModel:model
  }
}
function finalizeReceiptExtraction(input){
  const x=JSON.parse(JSON.stringify(input||{})),tx=Array.isArray(x.fuelTransactions)?x.fuelTransactions.filter(r=>num(r.litres)>0&&num(r.amount)>0):[];
  if(tx.length){
    const litres=tx.reduce((a,r)=>a+num(r.litres),0),amount=tx.reduce((a,r)=>a+num(r.amount),0);
    x.fuelTransactions=tx;x.fuelTransactionCount=tx.length;x.fuelLineAmount=Number(amount.toFixed(2));
    if(!num(x.litres))x.litres=Number(litres.toFixed(3));
    if(!num(x.suggestedAmount))x.suggestedAmount=Number(amount.toFixed(2));
    if(!num(x.pricePerLitre)&&litres>0)x.pricePerLitre=Number((amount/litres).toFixed(4));
  }
  const amount=num(x.printedTotal)||num(x.suggestedAmount),litres=num(x.litres),price=num(x.pricePerLitre);
  let mathOk=true,difference=0;
  if(amount>0&&litres>0&&price>0){
    difference=Math.abs(litres*price-amount);
    mathOk=difference<=Math.max(.50,amount*.01);
  }
  if(tx.length){
    const rowsOk=tx.every(r=>Math.abs(num(r.litres)*num(r.pricePerLitre)-num(r.amount))<=Math.max(.50,num(r.amount)*.01));
    mathOk=mathOk&&rowsOk;
  }
  x.totalDifference=Number(difference.toFixed(2));
  x.totalsReconcile=mathOk;
  if(x.category==='Diesel'&&(!amount||!litres))x.needsReview=true;
  if(!mathOk)x.needsReview=true;
  x.requiresManualAmountConfirmation=Boolean(x.needsReview)||!amount;
  return x
}
function receiptAiDisagrees(ai,ocr,ocrConfidence){
  if(!ai||!ocr||num(ocrConfidence)<70)return false;
  const differs=(a,b,abs,pct)=>num(a)>0&&num(b)>0&&Math.abs(num(a)-num(b))>Math.max(abs,Math.max(num(a),num(b))*pct);
  if(differs(ai.suggestedAmount||ai.printedTotal,ocr.suggestedAmount||ocr.printedTotal,2,.015))return true;
  if(differs(ai.litres,ocr.litres,.75,.01))return true;
  if(differs(ai.pricePerLitre,ocr.pricePerLitre,.15,.01))return true;
  return false
}
function receiptNeedsSol(combined,luna,ocr,ocrConfidence){
  if(!luna)return true;
  if(num(luna.extractionConfidence)<RECEIPT_AI_SOL_THRESHOLD)return true;
  if(!combined||combined.category==='Other'||num(combined.categoryConfidence)<75)return true;
  if(!num(combined.suggestedAmount)&&!num(combined.printedTotal))return true;
  if(combined.category==='Diesel'&&(!num(combined.litres)||!num(combined.pricePerLitre)))return true;
  if(combined.needsReview||combined.totalsReconcile===false)return true;
  return receiptAiDisagrees(luna,ocr,ocrConfidence)
}
async function openAiReceiptExtract(buffer,mimeType,ocrText,model,detail='high'){
  if(!OPENAI_API_KEY)return null;
  const mime=receiptImageMime(buffer,mimeType);if(!mime)return null;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try{
    const prompt=[
      'Read this transport expense receipt/slip image and return only the requested structured fields.',
      'This is for Angermund Transport in Namibia. Never invent a value that is not visible.',
      'Use 0 for unknown numeric values and an empty string for unknown text.',
      'Recognise diesel/fuel, toll, meals, accommodation, parking, border permits, customs/clearing, RFA/road permits, mass distance charges, weighbridge, loading/offloading, ferry/crossing, wash bay, tyre repair, emergency repair, breakdown parts, workshop/spares, police/traffic fines, general supplies and other transport expenses.',
      'For fuel: carefully read litres, price per litre, printed total and each visible fuel transaction. Check litres × price against amount.',
      'Read the actual transaction/receipt date printed on the slip. Return date exactly as YYYY-MM-DD. If the date is not visible or cannot be read confidently, return an empty string. Never substitute today or the current date.',
      'If the image is unclear, numbers conflict, or a required fuel value is missing, set needsReview=true and lower extractionConfidence.',
      'OCR text is provided only as a clue; trust the visible image over bad OCR.',
      'OCR TEXT:',
      String(ocrText||'').slice(0,9000)
    ].join('\n');
    const body={
      model,
      store:false,
      reasoning:{effort:model===RECEIPT_AI_PRIMARY_MODEL?'none':'low'},
      input:[{role:'user',content:[
        {type:'input_text',text:prompt},
        {type:'input_image',image_url:'data:'+mime+';base64,'+buffer.toString('base64'),detail}
      ]}],
      text:{format:{type:'json_schema',name:'receipt_extraction',strict:true,schema:RECEIPT_AI_SCHEMA}}
    };
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data?.error?.message||('OpenAI receipt scan failed ('+response.status+')'));
    const outputText=data.output_text||((data.output||[]).flatMap(o=>o.content||[]).find(c=>c.type==='output_text')?.text)||'';
    if(!outputText)throw Error('OpenAI receipt scan returned no structured result');
    return normalizeAiReceipt(JSON.parse(outputText),model)
  }finally{clearTimeout(timer)}
}
async function analyzeReceiptHybrid(buffer,mimeType,state={}){
  const source=receiptOcrBuffer(buffer,mimeType),supportedMime=receiptImageMime(source,mimeType);
  let extracted={},aiPrimary=null,aiEscalated=null,aiError='',raw='',ocr={best:{confidence:0,text:'',label:'none'},results:[]};

  // With an OpenAI key configured, use vision first. This avoids running four
  // Tesseract passes before every scan and prevents malformed/unsupported phone
  // images from crashing the Node worker process.
  if(OPENAI_API_KEY&&supportedMime){
    try{
      aiPrimary=await openAiReceiptExtract(source,supportedMime,'',RECEIPT_AI_PRIMARY_MODEL,'high');
      if(aiPrimary){
        extracted=finalizeReceiptExtraction(aiPrimary);
        const learned=classifyReceipt('',aiPrimary.supplier,state,{litres:aiPrimary.litres,pricePerLitre:aiPrimary.pricePerLitre,suggestedAmount:aiPrimary.suggestedAmount});
        if((extracted.category==='Other'||num(extracted.categoryConfidence)<70)&&learned.category!=='Other'){
          extracted.category=learned.category;extracted.categoryConfidence=Math.max(num(extracted.categoryConfidence),learned.confidence);extracted.categoryReason=learned.reason;extracted.categorySource=learned.source
        }
      }
      if(receiptNeedsSol(extracted,aiPrimary,null,0)){
        aiEscalated=await openAiReceiptExtract(source,supportedMime,'',RECEIPT_AI_ESCALATION_MODEL,'original');
        if(aiEscalated)extracted=finalizeReceiptExtraction(mergeReceiptExtractions([aiEscalated,aiPrimary].filter(Boolean)))
      }
    }catch(e){aiError=e.message||String(e)}
    if(aiPrimary||aiEscalated){
      const aiUsed=true,model=aiEscalated?.aiModel||aiPrimary?.aiModel||null;
      extracted.aiUsed=true;extracted.aiModel=model;extracted.aiEscalated=Boolean(aiEscalated);extracted.aiAvailable=true;if(aiError)extracted.aiError=aiError;
      const confidence=Math.max(num(aiEscalated?.extractionConfidence),num(aiPrimary?.extractionConfidence),num(extracted.categoryConfidence));
      return{extracted,confidence,raw:'AI vision scan',ocr,ai:{available:true,used:aiUsed,primaryModel:RECEIPT_AI_PRIMARY_MODEL,escalationModel:RECEIPT_AI_ESCALATION_MODEL,model,escalated:Boolean(aiEscalated),error:aiError||null}}
    }
    // Do not hand an image that OpenAI could not decode to Tesseract in the same
    // request. Tesseract's worker can terminate the whole service on bad phone
    // image bytes. Return a controlled failure instead.
    throw Error(aiError||'AI could not read this image. Retake the slip photo or choose a JPG/PNG image.')
  }

  if(OPENAI_API_KEY&&!supportedMime)throw Error('Unsupported slip image format. Please retake or upload a JPG, PNG or WebP image.');

  // OCR-only fallback for installations where OpenAI is not configured.
  try{
    ocr=await recognizeReceiptBest(source);
    const ocrExtractions=ocr.results.map(r=>extractReceiptFields(r.text,state));
    extracted=finalizeReceiptExtraction(mergeReceiptExtractions(ocrExtractions));
    raw=ocr.results.map(r=>'['+r.label+']\n'+r.text).join('\n\n--- OCR PASS ---\n\n');
  }catch(e){
    throw Error('Could not read this slip image. Please retake it clearly as a JPG or PNG.')
  }
  extracted.aiUsed=false;extracted.aiModel=null;extracted.aiEscalated=false;extracted.aiAvailable=false;
  return{extracted,confidence:num(ocr.best.confidence),raw,ocr,ai:{available:false,used:false,primaryModel:RECEIPT_AI_PRIMARY_MODEL,escalationModel:RECEIPT_AI_ESCALATION_MODEL,model:null,escalated:false,error:null}}
}

if(!DATABASE_URL)console.warn('DATABASE_URL missing: using development memory store. Set PostgreSQL for multi-device persistence.');
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(DATABASE_URL)?false:{rejectUnauthorized:false}}):null;
const memory={state:null,users:[],gps:[],geofences:[],notifications:[],subscriptions:[],uploads:[],companyReceipts:[],tripDocuments:[],mobileDevices:[],scanJobs:[]};const clients=new Set();
app.use(express.json({limit:'10mb'}));app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Permissions-Policy','geolocation=(self), camera=(self)');next()});
const q=async(text,params=[])=>pool?(await pool.query(text,params)).rows:null;
async function initDb(){if(pool){await pool.query(`CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,name text NOT NULL,role text NOT NULL CHECK(role IN ('admin','manager','dispatcher','driver','warehouse','workshop','finance','site_worker')),driver_id text,staff_id text,active boolean DEFAULT true,created_at timestamptz DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id text;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin','manager','dispatcher','driver','warehouse','workshop','finance','site_worker'));
CREATE TABLE IF NOT EXISTS app_state(id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),payload jsonb NOT NULL DEFAULT '{}'::jsonb,revision bigint NOT NULL DEFAULT 0,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS app_state_backups(id uuid PRIMARY KEY,version text UNIQUE NOT NULL,payload jsonb NOT NULL,note text,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS gps_positions(id bigserial PRIMARY KEY,vehicle_id text NOT NULL,driver_id text,trip_id text,latitude double precision NOT NULL,longitude double precision NOT NULL,speed double precision DEFAULT 0,heading double precision DEFAULT 0,accuracy double precision,source text DEFAULT 'driver',recorded_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS gps_vehicle_time ON gps_positions(vehicle_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS geofences(id uuid PRIMARY KEY,name text NOT NULL,latitude double precision NOT NULL,longitude double precision NOT NULL,radius_m double precision NOT NULL,event_types text[] DEFAULT ARRAY['enter','exit'],kind text DEFAULT 'custom',active boolean DEFAULT true,created_at timestamptz DEFAULT now());
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS kind text DEFAULT 'custom';
CREATE TABLE IF NOT EXISTS geofence_state(vehicle_id text NOT NULL,geofence_id uuid REFERENCES geofences(id) ON DELETE CASCADE,inside boolean NOT NULL,updated_at timestamptz DEFAULT now(),PRIMARY KEY(vehicle_id,geofence_id));
ALTER TABLE geofence_state ADD COLUMN IF NOT EXISTS candidate_inside boolean;
ALTER TABLE geofence_state ADD COLUMN IF NOT EXISTS candidate_count integer DEFAULT 0;
ALTER TABLE geofence_state ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;
ALTER TABLE geofence_state ADD COLUMN IF NOT EXISTS last_position_at timestamptz;
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,type text NOT NULL,severity text DEFAULT 'info',title text NOT NULL,message text NOT NULL,role text,user_id uuid,driver_id text,linked_type text,linked_id text,read boolean DEFAULT false,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS push_subscriptions(id bigserial PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE CASCADE,subscription jsonb NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS scan_jobs(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),filename text,status text NOT NULL DEFAULT 'processing',raw_text text,extracted jsonb,confidence double precision,error text,created_at timestamptz DEFAULT now(),completed_at timestamptz);\nCREATE TABLE IF NOT EXISTS driver_uploads(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,trip_id text NOT NULL,kind text NOT NULL,filename text NOT NULL,mime_type text NOT NULL,content bytea NOT NULL,created_at timestamptz DEFAULT now());\nCREATE TABLE IF NOT EXISTS company_receipts(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,linked_type text NOT NULL,linked_id text NOT NULL,kind text NOT NULL,filename text NOT NULL,mime_type text NOT NULL,content bytea NOT NULL,created_at timestamptz DEFAULT now());\nCREATE INDEX IF NOT EXISTS company_receipts_link ON company_receipts(linked_type,linked_id,created_at DESC);\nCREATE TABLE IF NOT EXISTS trip_documents(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE SET NULL,trip_id text NOT NULL,leg_id text,kind text NOT NULL,reference text,filename text,mime_type text,content bytea,created_at timestamptz DEFAULT now());\nCREATE INDEX IF NOT EXISTS trip_documents_trip ON trip_documents(trip_id,created_at DESC);\nCREATE TABLE IF NOT EXISTS mobile_devices(id uuid PRIMARY KEY,device_id text UNIQUE NOT NULL,user_id uuid REFERENCES users(id) ON DELETE CASCADE,driver_id text,token_hash text UNIQUE NOT NULL,name text,platform text,active boolean DEFAULT true,last_seen timestamptz,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS user_quick_pins(user_id uuid REFERENCES users(id) ON DELETE CASCADE,device_id text NOT NULL,pin_hash text NOT NULL,failed_attempts integer DEFAULT 0,locked_until timestamptz,updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,device_id));\nCREATE INDEX IF NOT EXISTS mobile_devices_driver ON mobile_devices(driver_id,active);\nALTER TABLE notifications ADD COLUMN IF NOT EXISTS driver_id text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE mobile_devices ALTER COLUMN driver_id DROP NOT NULL;\nCREATE INDEX IF NOT EXISTS driver_uploads_trip ON driver_uploads(trip_id,created_at DESC);`);
 const email=(process.env.INITIAL_ADMIN_EMAIL||'admin@angermund.local').toLowerCase(),pass=process.env.INITIAL_ADMIN_PASSWORD||'ChangeMe123!';const found=await q('SELECT id FROM users WHERE email=$1',[email]);if(!found.length)await q('INSERT INTO users(id,email,password_hash,name,role) VALUES($1,$2,$3,$4,$5)',[crypto.randomUUID(),email,await bcrypt.hash(pass,12),'System Administrator','admin']);await q("INSERT INTO app_state(id,payload) VALUES(1,'{}') ON CONFLICT(id) DO NOTHING");
 }else if(!memory.users.length)memory.users.push({id:crypto.randomUUID(),email:(process.env.INITIAL_ADMIN_EMAIL||'admin@angermund.local').toLowerCase(),password_hash:await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD||'ChangeMe123!',10),name:'System Administrator',role:'admin',active:true});
 if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:angermundtransport@iway.na',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
}
function tokenFor(u){return jwt.sign({sub:u.id,email:u.email,name:u.name,role:u.role,driverId:u.driver_id||u.driverId||null,staffId:u.staff_id||u.staffId||null},JWT_SECRET,{expiresIn:'12h'})}
function accountUsername(u){return String(u?.email||'').split('@')[0]||String(u?.name||'user').toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'')}
function usernameSlug(name){return String(name||'user').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'')||'user'}
function temporaryAccountPassword(){return 'AT-'+crypto.randomBytes(6).toString('base64url').replace(/[-_]/g,'A').slice(0,8)+'!'+String(Math.floor(10+Math.random()*90))}
async function findLoginUser(identifier){
  const login=String(identifier||'').trim().toLowerCase();if(!login)return null;
  if(pool){
    let rows=await q('SELECT * FROM users WHERE active=true AND lower(email)=lower($1) LIMIT 1',[login]);
    if(rows.length)return rows[0];
    if(!login.includes('@')){
      rows=await q("SELECT * FROM users WHERE active=true AND lower(split_part(email,'@',1))=lower($1) ORDER BY created_at ASC LIMIT 2",[login]);
      if(rows.length===1)return rows[0]
    }
    return null
  }
  const exact=memory.users.find(x=>x.active&&String(x.email||'').toLowerCase()===login);if(exact)return exact;
  if(!login.includes('@')){
    const matches=memory.users.filter(x=>x.active&&accountUsername(x).toLowerCase()===login);if(matches.length===1)return matches[0]
  }
  return null
}

function auth(req,res,next){const raw=req.headers.authorization?.replace(/^Bearer\s+/i,'')||req.query.token;if(!raw)return res.status(401).json({error:'Authentication required'});try{req.user=jwt.verify(raw,JWT_SECRET);next()}catch{return res.status(401).json({error:'Invalid or expired session'})}}
const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'Insufficient permission'});
const deviceTokenHash=raw=>crypto.createHash('sha256').update(String(raw||'')).digest('hex');
async function deviceAuth(req,res,next){
  const raw=String(req.headers['x-device-token']||'');if(!raw)return res.status(401).json({error:'Device authentication required'});
  const hash=deviceTokenHash(raw);let d,u;
  if(pool){
    d=(await q('SELECT id,device_id AS "deviceId",user_id AS "userId",driver_id AS "driverId",name,platform,active FROM mobile_devices WHERE token_hash=$1 AND active=true',[hash]))[0];
    if(d)u=(await q('SELECT id,email,name,role,driver_id AS "driverId",staff_id AS "staffId",active FROM users WHERE id=$1 AND active=true',[d.userId]))[0]
  }else{
    d=memory.mobileDevices.find(x=>x.tokenHash===hash&&x.active);u=d?memory.users.find(x=>x.id===d.userId&&x.active):null
  }
  if(!d||!u)return res.status(401).json({error:'Invalid or inactive device'});
  req.device=d;req.user={sub:u.id,email:u.email,name:u.name,role:u.role,driverId:u.driverId||u.driver_id||d.driverId||null,staffId:u.staffId||u.staff_id||null};
  if(pool)q('UPDATE mobile_devices SET last_seen=now() WHERE id=$1',[d.id]).catch(()=>{});else d.lastSeen=new Date().toISOString();
  next()
}
function emit(type,data){const msg=`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of clients)res.write(msg)}
const distance=(a,b)=>{const R=6371000,p=x=>x*Math.PI/180,dLat=p(b.latitude-a.latitude),dLon=p(b.longitude-a.longitude),x=Math.sin(dLat/2)**2+Math.cos(p(a.latitude))*Math.cos(p(b.latitude))*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))};
async function createNotification(n){
  const row={id:crypto.randomUUID(),type:n.type||'system',severity:n.severity||'info',title:n.title,message:n.message,role:n.role||null,user_id:n.userId||null,driver_id:n.driverId||null,linked_type:n.linkedType||null,linked_id:n.linkedId||null,read:false,created_at:new Date().toISOString()};
  if(row.type==='geofence'){
    if(pool){
      const existing=(await q("SELECT id,type,severity,title,message,role,user_id,driver_id,linked_type,linked_id,read,created_at FROM notifications WHERE type='geofence' AND title=$1 AND coalesce(message,'')=coalesce($2,'') AND coalesce(linked_id,'')=coalesce($3,'') AND created_at>now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1",[row.title,row.message,row.linked_id]))[0];
      if(existing)return existing
    }else{
      const cutoff=Date.now()-5*60*1000,existing=memory.notifications.find(x=>x.type==='geofence'&&x.title===row.title&&x.message===row.message&&String(x.linked_id||x.linkedId||'')===String(row.linked_id||'')&&new Date(x.created_at||x.createdAt).getTime()>cutoff);
      if(existing)return existing
    }
  }
  if(pool)await q('INSERT INTO notifications(id,type,severity,title,message,role,user_id,driver_id,linked_type,linked_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.id,row.type,row.severity,row.title,row.message,row.role,row.user_id,row.driver_id,row.linked_type,row.linked_id]);
  else memory.notifications.unshift(row);
  emit('notification',row);await sendExternal(row);return row
}
async function sendExternal(n){
  const tasks=[];
  if(!n.user_id&&n.role!=='driver'&&process.env.RESEND_API_KEY&&process.env.ALERT_EMAIL_TO)tasks.push(fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Angermund Alerts <alerts@resend.dev>',to:[process.env.ALERT_EMAIL_TO],subject:n.title,html:`<h2>${n.title}</h2><p>${n.message}</p>`})}));
  if(!n.user_id&&n.role!=='driver'&&process.env.META_WHATSAPP_TOKEN&&process.env.META_PHONE_NUMBER_ID&&process.env.WHATSAPP_ALERT_TO)tasks.push(fetch(`https://graph.facebook.com/v21.0/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_WHATSAPP_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:process.env.WHATSAPP_ALERT_TO,type:'text',text:{body:`${n.title}\n${n.message}`}})}));
  let subs=[];
  if(pool){
    const base="SELECT ps.id,ps.subscription,ps.user_id AS \"userId\",EXISTS(SELECT 1 FROM mobile_devices md WHERE md.user_id=ps.user_id AND md.active=true AND md.last_seen>now()-interval '10 minutes') AS \"nativeActive\" FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.active=true";
    if(n.user_id)subs=await q(base+' AND u.id=$1',[n.user_id]);
    else if(n.driver_id)subs=await q(base+' AND u.driver_id=$1',[n.driver_id]);
    else if(n.role)subs=await q(base+' AND u.role=$1',[n.role]);
    else subs=await q(base);
  }else{
    subs=memory.subscriptions.filter(x=>n.user_id?x.userId===n.user_id:n.driver_id?x.driverId===n.driver_id:n.role?x.role===n.role:true).map(x=>({...x,nativeActive:memory.mobileDevices.some(d=>d.userId===x.userId&&d.active&&(!d.lastSeen||Date.now()-new Date(d.lastSeen).getTime()<10*60*1000))}))
  }
  if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY){
    for(const row of subs){
      if(row.nativeActive)continue;
      tasks.push((async()=>{
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
  }
  await Promise.allSettled(tasks);
}
async function evaluateGeofences(pos){
  if(!trustedVehicleGpsSource(pos.source))return;
  const phoneTest=String(pos.source||'').toLowerCase()==='phone-test';
  const recordedAt=new Date(pos.recordedAt||Date.now()),accuracy=Math.max(0,num(pos.accuracy));
  if(!Number.isFinite(recordedAt.getTime()))return;
  // Phone GPS can occasionally report a very poor fix. Do not let that flip a geofence.
  if(phoneTest&&accuracy>200)return;
  // Ignore stale/out-of-order positions. This also prevents a browser and native app
  // from replaying an old fix and repeatedly toggling the same test geofence.
  if(pool){
    const latest=(await q('SELECT recorded_at AS "recordedAt" FROM gps_positions WHERE vehicle_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 1',[pos.vehicleId]))[0];
    if(latest&&new Date(latest.recordedAt).getTime()>recordedAt.getTime()+1000)return
  }else{
    const latest=memory.gps.filter(x=>x.vehicleId===pos.vehicleId).sort((a,b)=>new Date(b.recordedAt)-new Date(a.recordedAt))[0];
    if(latest&&new Date(latest.recordedAt).getTime()>recordedAt.getTime()+1000)return
  }
  const fences=pool?await q('SELECT * FROM geofences WHERE active=true'):memory.geofences.filter(x=>x.active!==false);
  for(const f of fences){
    const radius=Math.max(5,num(f.radius_m||f.radiusM)),d=distance(pos,{latitude:num(f.latitude),longitude:num(f.longitude)});
    const margin=Math.min(Math.max(phoneTest?50:25,accuracy*1.5),Math.max(50,radius*.35));
    const rawInside=d<=radius;
    const prev=pool?(await q('SELECT inside,candidate_inside AS "candidateInside",candidate_count AS "candidateCount",last_notified_at AS "lastNotifiedAt",last_position_at AS "lastPositionAt" FROM geofence_state WHERE vehicle_id=$1 AND geofence_id=$2',[pos.vehicleId,f.id]))[0]:f.states?.[pos.vehicleId];
    if(!prev){
      if(pool)await q('INSERT INTO geofence_state(vehicle_id,geofence_id,inside,candidate_inside,candidate_count,last_position_at) VALUES($1,$2,$3,NULL,0,$4) ON CONFLICT(vehicle_id,geofence_id) DO NOTHING',[pos.vehicleId,f.id,rawInside,recordedAt.toISOString()]);
      else{f.states??={};f.states[pos.vehicleId]={inside:rawInside,candidateInside:null,candidateCount:0,lastNotifiedAt:null,lastPositionAt:recordedAt.toISOString()}}
      continue
    }
    const wasInside=Boolean(prev.inside??prev);
    let desired=wasInside;
    if(wasInside){
      // Once inside, require a clearly outside fix before considering an exit.
      if(d>radius+margin)desired=false
    }else{
      // Once outside, require a clearly inside fix before considering an entry.
      if(d<Math.max(5,radius-margin))desired=true
    }
    let candidateInside=prev.candidateInside,candidateCount=num(prev.candidateCount);
    if(desired===wasInside){
      candidateInside=null;candidateCount=0
    }else if(candidateInside===desired){
      candidateCount+=1
    }else{
      candidateInside=desired;candidateCount=1
    }
    let finalInside=wasInside,notify=false;
    // Phone tests need two consecutive fixes on the new side of the fence.
    const needed=phoneTest?2:1;
    if(desired!==wasInside&&candidateCount>=needed){
      finalInside=desired;candidateInside=null;candidateCount=0;
      const lastNotified=prev.lastNotifiedAt?new Date(prev.lastNotifiedAt).getTime():0;
      // Short cooldown protects against GPS boundary chatter without masking normal travel.
      notify=!lastNotified||Date.now()-lastNotified>2*60*1000
    }
    if(notify){
      const label=phoneTest?String(pos.vehicleId||'Phone').replace(/^phone-test:/i,''):pos.vehicleId;
      await createNotification({type:'geofence',severity:finalInside?'info':'warning',title:(phoneTest?'GPS TEST · ':'')+(finalInside?'Entered ':'Exited ')+f.name,message:label+' '+(finalInside?'entered':'left')+' the '+f.name+' geofence.',linkedType:'vehicle',linkedId:pos.vehicleId})
    }
    if(pool){
      await q('INSERT INTO geofence_state(vehicle_id,geofence_id,inside,candidate_inside,candidate_count,last_notified_at,last_position_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(vehicle_id,geofence_id) DO UPDATE SET inside=$3,candidate_inside=$4,candidate_count=$5,last_notified_at=CASE WHEN $6::timestamptz IS NULL THEN geofence_state.last_notified_at ELSE $6::timestamptz END,last_position_at=$7,updated_at=now()',[pos.vehicleId,f.id,finalInside,candidateInside,candidateCount,notify?new Date().toISOString():null,recordedAt.toISOString()])
    }else{
      f.states??={};f.states[pos.vehicleId]={inside:finalInside,candidateInside,candidateCount,lastNotifiedAt:notify?new Date().toISOString():(prev.lastNotifiedAt||null),lastPositionAt:recordedAt.toISOString()}
    }
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
function trustedVehicleGpsSource(source){return ['telematics','truck-device','tracker','vehicle-tracker','phone-test'].includes(String(source||'').toLowerCase())}
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
          state.tasks.unshift({id:'task_'+crypto.randomUUID(),title:'Upload POD for '+t.number,ownerRole:'Driver',assignedDriverId:t.driverId||'',linkedType:'trip',linkedId:t.id,due:now.slice(0,10),priority:'High',status:'Open'})
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
        state.tasks.unshift({id:'task_'+crypto.randomUUID(),title:'Upload POD for '+t.number,ownerRole:'Driver',assignedDriverId:t.driverId||'',linkedType:'trip',linkedId:t.id,due:now.slice(0,10),priority:'High',status:'Open'})
      }
      events.push({title:t.number+' returned',message:pos.vehicleId+' arrived back at '+z.load.name+'. Trip is ready for POD/office closure.'})
    }
    g.lastPositionAt=now;g.lastLoadDistanceKm=Number((lm/1000).toFixed(2));g.lastOffloadDistanceKm=Number((om/1000).toFixed(2));
    return{events,tripId:t.id,driverId:t.driverId}
  });
  for(const e of changed.result?.events||[])await tripGeoNotify({...active,driverId:changed.result.driverId},e.title,e.message,e.severity||'info')
}
app.post('/api/auth/login',async(req,res)=>{const login=String(req.body.login||req.body.email||'').trim(),u=await findLoginUser(login);if(!u||!await bcrypt.compare(String(req.body.password||''),u.password_hash))return res.status(401).json({error:'Invalid username or password'});res.json({token:tokenFor(u),user:{id:u.id,email:u.email,username:accountUsername(u),name:u.name,role:u.role,driverId:u.driver_id||u.driverId||null}})});
app.get('/api/session',auth,(req,res)=>res.json({user:req.user}));
app.post('/api/auth/pin/setup',auth,async(req,res)=>{
  const deviceId=String(req.body.deviceId||'').trim().slice(0,160),pin=String(req.body.pin||'').trim();
  if(!deviceId||!/^\d{4}$/.test(pin))return res.status(400).json({error:'Choose a 4-digit PIN'});
  const hash=await bcrypt.hash(pin,10);
  if(pool)await q('INSERT INTO user_quick_pins(user_id,device_id,pin_hash,failed_attempts,locked_until,updated_at) VALUES($1,$2,$3,0,NULL,now()) ON CONFLICT(user_id,device_id) DO UPDATE SET pin_hash=$3,failed_attempts=0,locked_until=NULL,updated_at=now()',[req.user.sub,deviceId,hash]);
  else{
    memory.quickPins??=[];let row=memory.quickPins.find(x=>x.userId===req.user.sub&&x.deviceId===deviceId);
    if(row)Object.assign(row,{pinHash:hash,failedAttempts:0,lockedUntil:null,updatedAt:new Date().toISOString()});
    else memory.quickPins.push({userId:req.user.sub,deviceId,pinHash:hash,failedAttempts:0,lockedUntil:null,updatedAt:new Date().toISOString()})
  }
  res.json({success:true})
});
app.delete('/api/auth/pin',auth,async(req,res)=>{
  const deviceId=String(req.body.deviceId||'').trim().slice(0,160);if(!deviceId)return res.status(400).json({error:'deviceId is required'});
  if(pool)await q('DELETE FROM user_quick_pins WHERE user_id=$1 AND device_id=$2',[req.user.sub,deviceId]);
  else{memory.quickPins??=[];memory.quickPins=memory.quickPins.filter(x=>!(x.userId===req.user.sub&&x.deviceId===deviceId))}
  res.json({success:true})
});
app.post('/api/auth/pin/login',async(req,res)=>{
  const login=String(req.body.login||req.body.email||'').trim(),deviceId=String(req.body.deviceId||'').trim().slice(0,160),pin=String(req.body.pin||'').trim();
  if(!login||!deviceId||!/^\d{4}$/.test(pin))return res.status(401).json({error:'Invalid username or PIN'});
  const u=await findLoginUser(login);if(!u)return res.status(401).json({error:'Invalid username or PIN'});
  let row;
  if(pool)row=(await q('SELECT pin_hash AS "pinHash",failed_attempts AS "failedAttempts",locked_until AS "lockedUntil" FROM user_quick_pins WHERE user_id=$1 AND device_id=$2',[u.id,deviceId]))[0];
  else{memory.quickPins??=[];row=memory.quickPins.find(x=>x.userId===u.id&&x.deviceId===deviceId)}
  if(!row)return res.status(401).json({error:'Quick PIN is not set up on this device'});
  if(row.lockedUntil&&new Date(row.lockedUntil)>new Date())return res.status(429).json({error:'Too many wrong PIN attempts. Use your password or try again later.'});
  const ok=await bcrypt.compare(pin,row.pinHash);
  if(!ok){
    const attempts=num(row.failedAttempts)+1,locked=attempts>=5?new Date(Date.now()+10*60*1000).toISOString():null;
    if(pool)await q('UPDATE user_quick_pins SET failed_attempts=$3,locked_until=$4,updated_at=now() WHERE user_id=$1 AND device_id=$2',[u.id,deviceId,attempts,locked]);
    else Object.assign(row,{failedAttempts:attempts,lockedUntil:locked,updatedAt:new Date().toISOString()});
    return res.status(401).json({error:attempts>=5?'Quick PIN locked for 10 minutes. Use your password.':'Invalid username or PIN'})
  }
  if(pool)await q('UPDATE user_quick_pins SET failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=$1 AND device_id=$2',[u.id,deviceId]);
  else Object.assign(row,{failedAttempts:0,lockedUntil:null,updatedAt:new Date().toISOString()});
  res.json({token:tokenFor(u),user:{id:u.id,email:u.email,username:accountUsername(u),name:u.name,role:u.role,driverId:u.driver_id||u.driverId||null}})
});

app.get('/api/users',auth,roles('admin','manager'),async(req,res)=>{const rows=pool?await q('SELECT id,email,name,role,driver_id AS "driverId",staff_id AS "staffId",active,created_at AS "createdAt" FROM users ORDER BY name'):memory.users.map(({password_hash,...u})=>u);res.json(rows.map(u=>({...u,username:accountUsername(u)})))});

app.post('/api/users/bootstrap-credentials',auth,roles('admin'),async(req,res)=>{
  const resetExisting=req.body.resetExisting!==false,state=await readOpsState(),drivers=(state.drivers||[]).filter(d=>d&&d.id&&d.name);
  const credentials=[];
  const allUsers=pool?await q('SELECT * FROM users ORDER BY created_at ASC'):memory.users;
  const usedEmails=new Set(allUsers.map(u=>String(u.email||'').toLowerCase()));
  const uniqueDriverEmail=name=>{const base=usernameSlug(name)||'driver';let local=base,n=2,email=local+'@driver.local';while(usedEmails.has(email)){local=base+'.'+n++;email=local+'@driver.local'}usedEmails.add(email);return email};
  const affectedIds=[];
  for(const d of drivers){
    let u=allUsers.find(x=>(x.driver_id||x.driverId)===d.id);
    let created=false;
    if(!u){
      const email=uniqueDriverEmail(d.name),id=crypto.randomUUID(),password=temporaryAccountPassword(),hash=await bcrypt.hash(password,12);
      if(pool)await q('INSERT INTO users(id,email,password_hash,name,role,driver_id,active) VALUES($1,$2,$3,$4,$5,$6,true)',[id,email,hash,d.name,'driver',d.id]);
      else{u={id,email,password_hash:hash,name:d.name,role:'driver',driverId:d.id,active:true};memory.users.push(u)}
      u={id,email,name:d.name,role:'driver',driver_id:d.id,active:true};allUsers.push(u);created=true;credentials.push({name:d.name,role:'driver',username:accountUsername(u),login:u.email,password,created:true});affectedIds.push(u.id);continue
    }
    if(!u.active){
      if(pool)await q('UPDATE users SET active=true WHERE id=$1',[u.id]);else u.active=true
    }
    if(resetExisting){
      const password=temporaryAccountPassword(),hash=await bcrypt.hash(password,12);
      if(pool)await q('UPDATE users SET password_hash=$2 WHERE id=$1',[u.id,hash]);else u.password_hash=hash;
      credentials.push({name:u.name||d.name,role:'driver',username:accountUsername(u),login:u.email,password,created});
      affectedIds.push(u.id)
    }else credentials.push({name:u.name||d.name,role:'driver',username:accountUsername(u),login:u.email,password:null,created:false})
  }
  for(const u of allUsers.filter(x=>x.role==='admin'&&x.active)){
    if(resetExisting){
      const password=temporaryAccountPassword(),hash=await bcrypt.hash(password,12);
      if(pool)await q('UPDATE users SET password_hash=$2 WHERE id=$1',[u.id,hash]);else u.password_hash=hash;
      credentials.unshift({name:u.name,role:'admin',username:accountUsername(u),login:u.email,password,created:false});affectedIds.push(u.id)
    }else credentials.unshift({name:u.name,role:'admin',username:accountUsername(u),login:u.email,password:null,created:false})
  }
  if(resetExisting&&affectedIds.length){
    if(pool)await q('DELETE FROM user_quick_pins WHERE user_id=ANY($1::uuid[])',[affectedIds]);
    else{memory.quickPins??=[];memory.quickPins=memory.quickPins.filter(x=>!affectedIds.includes(x.userId))}
  }
  res.json({credentials,resetExisting,generatedAt:new Date().toISOString(),note:'Temporary passwords are returned once. Users can set a 4-digit quick PIN after password sign-in.'})
});
app.post('/api/users',auth,roles('admin'),async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(),name=String(req.body.name||'').trim(),role=String(req.body.role||''),password=String(req.body.password||''),driverId=req.body.driverId||null,staffId=req.body.staffId||null;
  const validRoles=['admin','manager','dispatcher','driver','warehouse','workshop','finance','site_worker'];
  if(!email||!name||password.length<10||!validRoles.includes(role))return res.status(400).json({error:'Valid name, email, role and a 10+ character password are required'});
  if(role==='driver'&&!driverId)return res.status(400).json({error:'Select the driver profile this login belongs to'});
  if(role!=='driver'&&staffId){
    const snapshot=await readOpsState(),employee=workforceEmployee(snapshot,staffId);
    if(!employee)return res.status(400).json({error:'Select a valid worker profile'});
    const linked=pool?await q('SELECT id FROM users WHERE staff_id=$1',[staffId]):memory.users.filter(x=>(x.staff_id||x.staffId)===staffId);
    if(linked.length)return res.status(409).json({error:'This worker already has an app login'});
  }
  if(role==='driver'&&driverId){
    const linked=pool?(await q('SELECT id FROM users WHERE driver_id=$1',[driverId])):memory.users.filter(x=>(x.driver_id||x.driverId)===driverId);
    if(linked.length)return res.status(409).json({error:'This driver already has a login. Reactivate or reset the existing account instead.'});
  }
  const u={id:crypto.randomUUID(),email,name,role,driverId:role==='driver'?driverId:null,staffId:role==='driver'?null:staffId,active:true,createdAt:new Date().toISOString()},hash=await bcrypt.hash(password,12);
  try{
    if(pool)await q('INSERT INTO users(id,email,password_hash,name,role,driver_id,staff_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[u.id,email,hash,name,role,u.driverId,u.staffId]);
    else memory.users.push({...u,password_hash:hash});
    res.status(201).json(u)
  }catch(e){res.status(409).json({error:'A user with that email already exists'})}
});

app.patch('/api/users/:id',auth,roles('admin'),async(req,res)=>{
  const id=req.params.id,validRoles=['admin','manager','dispatcher','driver','warehouse','workshop','finance','site_worker'];
  const active=req.body.active===undefined?undefined:Boolean(req.body.active),driverId=req.body.driverId===undefined?undefined:(req.body.driverId||null),staffId=req.body.staffId===undefined?undefined:(req.body.staffId||null);
  const name=req.body.name===undefined?undefined:String(req.body.name||'').trim(),email=req.body.email===undefined?undefined:String(req.body.email||'').trim().toLowerCase(),role=req.body.role===undefined?undefined:String(req.body.role||'');
  if(role!==undefined&&!validRoles.includes(role))return res.status(400).json({error:'Invalid role'});
  try{
    const existing=pool?(await q('SELECT id,email,name,role,driver_id AS "driverId",staff_id AS "staffId",active FROM users WHERE id=$1',[id]))[0]:memory.users.find(x=>x.id===id);
    if(!existing)return res.status(404).json({error:'User not found'});
    if(existing.id===req.user.sub&&active===false)return res.status(400).json({error:'You cannot deactivate your own account'});
    if(existing.id===req.user.sub&&role!==undefined&&role!=='admin')return res.status(400).json({error:'You cannot remove your own admin role'});
    const finalRole=role===undefined?existing.role:role,finalDriverId=driverId===undefined?(existing.driverId||existing.driver_id||null):driverId;
    if(finalRole==='driver'&&!finalDriverId)return res.status(400).json({error:'Driver role requires a linked driver profile'});
    const requestedStaffId=staffId===undefined?(existing.staffId||existing.staff_id||null):staffId;
    if(finalRole!=='driver'&&requestedStaffId){
      const snapshot=await readOpsState(),employee=workforceEmployee(snapshot,requestedStaffId);
      if(!employee)return res.status(400).json({error:'Select a valid worker profile'});
      const dupStaff=pool?await q('SELECT id FROM users WHERE staff_id=$1 AND id<>$2',[requestedStaffId,id]):memory.users.filter(x=>(x.staff_id||x.staffId)===requestedStaffId&&x.id!==id);
      if(dupStaff.length)return res.status(409).json({error:'That worker is already linked to another app login'});
    }
    if(finalRole==='driver'&&finalDriverId){
      const dup=pool?await q('SELECT id FROM users WHERE driver_id=$1 AND id<>$2',[finalDriverId,id]):memory.users.filter(x=>(x.driver_id||x.driverId)===finalDriverId&&x.id!==id);
      if(dup.length)return res.status(409).json({error:'That driver is already linked to another login'});
    }
    const final={name:name===undefined?existing.name:name,email:email===undefined?existing.email:email,role:finalRole,driverId:finalRole==='driver'?finalDriverId:null,staffId:finalRole==='driver'?null:requestedStaffId,active:active===undefined?existing.active:active};
    if(!final.name||!final.email)return res.status(400).json({error:'Name and email are required'});
    if(pool){
      const row=(await q('UPDATE users SET name=$2,email=$3,role=$4,driver_id=$5,staff_id=$6,active=$7 WHERE id=$1 RETURNING id,email,name,role,driver_id AS "driverId",staff_id AS "staffId",active,created_at AS "createdAt"',[id,final.name,final.email,final.role,final.driverId,final.staffId,final.active]))[0];
      return res.json(row)
    }
    Object.assign(existing,{name:final.name,email:final.email,role:final.role,driverId:final.driverId,driver_id:final.driverId,staffId:final.staffId,staff_id:final.staffId,active:final.active});
    const{password_hash,...safe}=existing;res.json(safe)
  }catch(e){res.status(409).json({error:e.code==='23505'?'A user with that email already exists':e.message})}
});
app.post('/api/users/:id/reset-password',auth,roles('admin'),async(req,res)=>{const password=String(req.body.password||'');if(password.length<10)return res.status(400).json({error:'Password must be at least 10 characters'});const id=req.params.id,hash=await bcrypt.hash(password,12);if(pool){const rows=await q('UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING id',[id,hash]);if(!rows.length)return res.status(404).json({error:'User not found'});await q('DELETE FROM user_quick_pins WHERE user_id=$1',[id])}else{const u=memory.users.find(x=>x.id===id);if(!u)return res.status(404).json({error:'User not found'});u.password_hash=hash;memory.quickPins??=[];memory.quickPins=memory.quickPins.filter(x=>x.userId!==id)}res.json({success:true})});
app.delete('/api/users/:id',auth,roles('admin'),async(req,res)=>{
  const id=String(req.params.id);if(id===req.user.sub)return res.status(400).json({error:'You cannot delete your own account'});
  if(pool){const rows=await q('DELETE FROM users WHERE id=$1 RETURNING id,name',[id]);if(!rows.length)return res.status(404).json({error:'User not found'});return res.json({success:true,id})}
  const i=memory.users.findIndex(x=>x.id===id);if(i<0)return res.status(404).json({error:'User not found'});memory.users.splice(i,1);memory.subscriptions=memory.subscriptions.filter(x=>x.userId!==id);memory.mobileDevices=memory.mobileDevices.filter(x=>x.userId!==id);res.json({success:true,id})
});

function taskNotificationTarget(task){
  if(task.assignedUserId)return{userId:task.assignedUserId};
  if(task.assignedDriverId)return{driverId:task.assignedDriverId,role:'driver'};
  if(task.ownerRole)return{role:String(task.ownerRole).toLowerCase().replace(/\s+/g,'_')};
  return{role:'admin'}
}
async function notifyTask(task,title,message,severity='info'){
  return createNotification({type:'task',severity,title,message,...taskNotificationTarget(task),linkedType:'task',linkedId:task.id})
}
function normalizeTask(body={},existing={}){
  const due=String(body.due??existing.due??'').slice(0,10),priority=['Low','Normal','High','Critical'].includes(body.priority)?body.priority:(existing.priority||'Normal'),status=['Open','In progress','Completed','Cancelled'].includes(body.status)?body.status:(existing.status||'Open');
  return{...existing,title:String(body.title??existing.title??'').trim().slice(0,180),description:String(body.description??existing.description??'').trim().slice(0,2000),assignedUserId:body.assignedUserId===undefined?(existing.assignedUserId||''):(body.assignedUserId||''),assignedDriverId:body.assignedDriverId===undefined?(existing.assignedDriverId||''):(body.assignedDriverId||''),ownerRole:body.ownerRole===undefined?(existing.ownerRole||''):(body.ownerRole||''),due,priority,status,linkedType:String(body.linkedType??existing.linkedType??'').slice(0,40),linkedId:String(body.linkedId??existing.linkedId??'').slice(0,160),updatedAt:new Date().toISOString()}
}

function truthy(v){return v===true||['1','true','yes','on'].includes(String(v||'').toLowerCase())}
function canCompleteTaskForUser(task,user){
  const privileged=['admin','manager','dispatcher'].includes(user.role);
  const assigned=task.assignedUserId===user.sub||(user.driverId&&task.assignedDriverId===user.driverId)||(!task.assignedUserId&&!task.assignedDriverId&&String(task.ownerRole||'').toLowerCase().replace(/\s+/g,'_')===user.role);
  return privileged||assigned
}
function financialContext(state,linkedType,linkedId,body={}){
  let tripId=String(body.tripId||''),truckId=String(body.truckId||''),driverId=String(body.driverId||''),maintenanceId='',tyreId='';
  if(linkedType==='trip'){
    const t=(state.trips||[]).find(x=>x.id===linkedId);if(t){tripId=t.id;truckId=t.truckId||truckId;driverId=t.driverId||driverId}
  }else if(linkedType==='truck')truckId=linkedId;
  else if(linkedType==='maintenance'){
    const m=(state.maintenance||[]).find(x=>x.id===linkedId);if(m){maintenanceId=m.id;truckId=m.truckId||truckId}
  }else if(linkedType==='tyre'){
    const y=(state.tyres||[]).find(x=>x.id===linkedId);if(y){tyreId=y.id;truckId=y.truckId||truckId}
  }else if(linkedType==='expense'){
    const e=(state.expenses||[]).find(x=>x.id===linkedId);if(e){tripId=e.tripId||tripId;truckId=e.truckId||truckId;driverId=e.driverId||driverId;maintenanceId=e.maintenanceId||'';tyreId=e.tyreId||''}
  }
  if(tripId){const t=(state.trips||[]).find(x=>x.id===tripId);if(t){truckId=t.truckId||truckId;driverId=t.driverId||driverId}}
  return{tripId,truckId,driverId,maintenanceId,tyreId}
}
async function storeCompanyReceiptFiles(files,user,linkedType,linkedId,kind='expense'){
  const list=(files||[]).filter(Boolean);if(!list.length)return null;
  const archived=archiveStoredFiles(list),id=crypto.randomUUID(),createdAt=new Date().toISOString(),row={id,userId:user.sub,linkedType:String(linkedType||'expense'),linkedId:String(linkedId||''),kind:String(kind||'expense'),filename:archived.filename,mimeType:archived.mimeType,content:archived.buffer,createdAt};
  if(pool)await q('INSERT INTO company_receipts(id,user_id,linked_type,linked_id,kind,filename,mime_type,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,user.sub,row.linkedType,row.linkedId,row.kind,row.filename,row.mimeType,row.content,createdAt]);
  else memory.companyReceipts.push(row);
  return{id,filename:row.filename,mimeType:row.mimeType,createdAt,pageCount:archived.pageCount||1}
}
async function storeCompanyReceipt(file,user,linkedType,linkedId,kind='expense'){
  return storeCompanyReceiptFiles(file?[file]:[],user,linkedType,linkedId,kind)
}
function applyLinkedCost(state,ctx,amount){
  if(ctx.maintenanceId){const m=(state.maintenance||[]).find(x=>x.id===ctx.maintenanceId);if(m&&num(m.cost)<=0)m.cost=amount}
  if(ctx.tyreId){const y=(state.tyres||[]).find(x=>x.id===ctx.tyreId);if(y&&num(y.cost)<=0)y.cost=amount}
}
function buildCompanyExpense(state,{sourceType,sourceId,title,body,receiptId,status='Review',linkedType='',linkedId=''}){
  state.expenses??=[];
  const amount=num(body.amount);if(amount<=0){const e=Error('Enter the amount paid');e.status=400;throw e}
  const ctx=financialContext(state,linkedType,linkedId,body),id='expense_'+crypto.randomUUID();
  const rec={id,date:String(body.date||new Date().toISOString().slice(0,10)).slice(0,10),tripId:ctx.tripId,truckId:ctx.truckId,driverId:ctx.driverId,maintenanceId:ctx.maintenanceId,tyreId:ctx.tyreId,category:String(body.category||'Other').slice(0,80),supplier:String(body.supplier||'').slice(0,160),amount,paymentMethod:String(body.paymentMethod||'Company card').slice(0,80),receiptNo:String(body.receiptNo||'').slice(0,120),notes:String(body.notes||title||'').slice(0,1000),receiptUploadId:receiptId||'',receiptUploadIds:receiptId?[receiptId]:[],receiptCount:receiptId?1:0,receiptSource:'company',companyPaid:true,reimbursable:false,status,sourceType,sourceId,taskId:sourceType==='task'?sourceId:'',approvalId:sourceType==='approval'?sourceId:''};
  state.expenses.unshift(rec);applyLinkedCost(state,ctx,amount);
  if(ctx.tripId){const t=(state.trips||[]).find(x=>x.id===ctx.tripId);if(t)recalcTripCosts(state,t)}
  return rec
}

app.post('/api/tasks',auth,roles('admin','manager','dispatcher'),async(req,res)=>{
  try{
    const changed=await mutateOpsState(state=>{state.tasks??=[];const t=normalizeTask(req.body||{}, {id:'task_'+crypto.randomUUID(),createdAt:new Date().toISOString(),createdBy:req.user.sub,status:'Open'});if(!t.title){const e=Error('Task title is required');e.status=400;throw e}state.tasks.unshift(t);return t});
    await notifyTask(changed.result,'New task: '+changed.result.title,(changed.result.description?changed.result.description+' · ':'')+(changed.result.due?'Due '+changed.result.due:'No due date'),changed.result.priority==='Critical'?'critical':changed.result.priority==='High'?'warning':'info');
    res.status(201).json({task:changed.result,revision:changed.revision})
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.patch('/api/tasks/:id',auth,roles('admin','manager','dispatcher'),async(req,res)=>{
  try{
    const changed=await mutateOpsState(state=>{state.tasks??=[];const i=state.tasks.findIndex(x=>x.id===req.params.id);if(i<0){const e=Error('Task not found');e.status=404;throw e}const before=state.tasks[i],next=normalizeTask(req.body||{},before);if(!next.title){const e=Error('Task title is required');e.status=400;throw e}state.tasks[i]=next;return{before,next}});
    const b=changed.result.before,n=changed.result.next,assignmentChanged=b.assignedUserId!==n.assignedUserId||b.assignedDriverId!==n.assignedDriverId||b.ownerRole!==n.ownerRole||b.due!==n.due||b.priority!==n.priority;
    if(assignmentChanged&&n.status!=='Completed')await notifyTask(n,'Task updated: '+n.title,(n.due?'Due '+n.due+' · ':'')+n.priority+' priority',n.priority==='Critical'?'critical':n.priority==='High'?'warning':'info');
    res.json({task:n,revision:changed.revision})
  }catch(e){res.status(e.status||500).json({error:e.message})}
});
app.post('/api/tasks/:id/complete',auth,upload.single('receipt'),async(req,res)=>{
  let receipt=null;
  try{
    const snapshot=await readOpsState(),task=(snapshot.tasks||[]).find(x=>x.id===req.params.id);
    if(!task)return res.status(404).json({error:'Task not found'});
    if(!canCompleteTaskForUser(task,req.user))return res.status(403).json({error:'This task is not assigned to you'});
    if(task.status==='Completed')return res.json({task,alreadyCompleted:true});
    const fundsUsed=truthy(req.body?.fundsUsed);
    if(fundsUsed){
      if(num(req.body.amount)<=0)return res.status(400).json({error:'Enter the amount paid'});
      if(!req.file)return res.status(400).json({error:'Receipt, slip or proof of payment is required when company funds were used'});
      receipt=await storeCompanyReceipt(req.file,req.user,'task',task.id,'task-expense');
    }
    const changed=await mutateOpsState(state=>{
      state.tasks??=[];state.expenses??=[];state.approvals??=[];
      const t=state.tasks.find(x=>x.id===req.params.id);if(!t){const er=Error('Task not found');er.status=404;throw er}
      if(!canCompleteTaskForUser(t,req.user)){const er=Error('This task is not assigned to you');er.status=403;throw er}
      if(t.status==='Completed')return t;
      let expense=null;
      if(fundsUsed){
        const directApproval=['admin','manager','finance'].includes(req.user.role),status=directApproval?'Approved':'Review';
        expense=buildCompanyExpense(state,{sourceType:'task',sourceId:t.id,title:t.title,body:req.body,receiptId:receipt?.id||'',status,linkedType:t.linkedType,linkedId:t.linkedId});
        t.fundsUsed=true;t.expenseId=expense.id;t.expenseAmount=expense.amount;t.receiptUploadId=expense.receiptUploadId;t.paymentMethod=expense.paymentMethod;
        if(!directApproval)state.approvals.unshift({id:'apr_'+crypto.randomUUID(),type:'Company expense',description:'Approve '+expense.category+' · '+t.title,amount:expense.amount,requester:req.user.name||req.user.email||req.user.role,status:'Pending',linkedType:'expense',linkedId:expense.id,taskId:t.id,fundsInvolved:true,createdAt:new Date().toISOString()})
      }else{t.fundsUsed=false;t.expenseId='';t.expenseAmount=0}
      t.status='Completed';t.completedAt=new Date().toISOString();t.completedBy=req.user.sub;t.updatedAt=t.completedAt;
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:t.completedAt,actor:req.user.name||req.user.email||req.user.role,action:'Completed task '+t.title+(expense?' · company spend '+expense.amount.toFixed(2):' · no company funds'),linkedType:'task',linkedId:t.id});state.audit=state.audit.slice(0,100);
      return t
    });
    createNotification({type:'task-complete',severity:'info',title:'Task completed',message:changed.result.title+' completed by '+req.user.name+(changed.result.fundsUsed?' · company funds recorded':' · no company funds'),role:'admin',linkedType:'task',linkedId:changed.result.id}).catch(()=>{});
    res.json({task:changed.result,receipt,revision:changed.revision})
  }catch(err){res.status(err.status||500).json({error:err.message})}
});
app.delete('/api/tasks/:id',auth,roles('admin','manager'),async(req,res)=>{
  try{const changed=await mutateOpsState(state=>{state.tasks??=[];const i=state.tasks.findIndex(x=>x.id===req.params.id);if(i<0){const e=Error('Task not found');e.status=404;throw e}return state.tasks.splice(i,1)[0]});res.json({success:true,id:req.params.id,revision:changed.revision})}catch(e){res.status(e.status||500).json({error:e.message})}
});

app.post('/api/approvals/:id/decision',auth,roles('admin','manager','finance'),upload.single('receipt'),async(req,res)=>{
  let receipt=null;
  try{
    const status=String(req.body.status||'');if(!['Approved','Rejected'].includes(status))return res.status(400).json({error:'Choose Approved or Rejected'});
    const snapshot=await readOpsState(),approval=(snapshot.approvals||[]).find(x=>x.id===req.params.id);
    if(!approval)return res.status(404).json({error:'Approval not found'});
    const existingExpense=approval.linkedType==='expense'?(snapshot.expenses||[]).find(x=>x.id===approval.linkedId):null;
    const fundsUsed=status==='Approved'&&(Boolean(existingExpense)||truthy(req.body.fundsUsed));
    if(fundsUsed&&!existingExpense&&num(req.body.amount||approval.amount)<=0)return res.status(400).json({error:'Enter the amount involved'});
    if(fundsUsed&&!existingExpense&&!req.file)return res.status(400).json({error:'Receipt, slip or proof of payment is required before approving company spend'});
    if(fundsUsed&&req.file)receipt=await storeCompanyReceipt(req.file,req.user,'approval',approval.id,'approved-expense');
    const changed=await mutateOpsState(state=>{
      state.approvals??=[];state.expenses??=[];const a=state.approvals.find(x=>x.id===req.params.id);if(!a){const er=Error('Approval not found');er.status=404;throw er}
      let expense=a.linkedType==='expense'?state.expenses.find(x=>x.id===a.linkedId):null;
      if(status==='Rejected'){
        a.status='Rejected';a.rejectedAt=new Date().toISOString();a.rejectedBy=req.user.sub;a.decisionNotes=String(req.body.notes||'').slice(0,1000);
        if(expense&&expense.status==='Review')expense.status='Rejected'
      }else{
        if(fundsUsed){
          const body={...req.body,amount:num(req.body.amount)||num(a.amount)};
          if(expense){
            expense.amount=num(body.amount)||expense.amount;expense.category=String(body.category||expense.category||'Other');expense.supplier=String(body.supplier||expense.supplier||'');expense.paymentMethod=String(body.paymentMethod||expense.paymentMethod||'Company card');expense.receiptNo=String(body.receiptNo||expense.receiptNo||'');expense.notes=String(body.notes||expense.notes||'');expense.status='Approved';expense.approvalId=a.id;expense.approvedAt=new Date().toISOString();expense.approvedBy=req.user.sub;
            if(receipt){expense.receiptUploadId=receipt.id;expense.receiptUploadIds=[receipt.id];expense.receiptCount=1;expense.receiptSource='company'}
            const ctx=financialContext(state,'expense',expense.id,expense);applyLinkedCost(state,ctx,expense.amount);if(ctx.tripId){const t=(state.trips||[]).find(x=>x.id===ctx.tripId);if(t)recalcTripCosts(state,t)}
          }else{
            expense=buildCompanyExpense(state,{sourceType:'approval',sourceId:a.id,title:a.description,body,receiptId:receipt?.id||'',status:'Approved',linkedType:a.linkedType,linkedId:a.linkedId});a.expenseId=expense.id
          }
          a.fundsInvolved=true;a.amount=expense.amount
        }else a.fundsInvolved=false;
        a.status='Approved';a.approvedAt=new Date().toISOString();a.approvedBy=req.user.sub;a.decisionNotes=String(req.body.notes||'').slice(0,1000)
      }
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:status+' approval '+a.description+(fundsUsed?' · company funds checked':''),linkedType:'approval',linkedId:a.id});state.audit=state.audit.slice(0,100);
      return{approval:a,expense}
    });
    res.json({...changed.result,receipt,revision:changed.revision})
  }catch(err){res.status(err.status||500).json({error:err.message})}
});

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
function workforceEmployees(state){
  if(Array.isArray(state.employees)&&state.employees.length)return state.employees;
  return (state.drivers||[]).map(d=>({id:d.id,name:d.name,jobTitle:d.role||'Driver',category:'Driver',status:d.status||'Active',baseSalary:0,payeDefault:0,sscDefault:0}))
}
function workforceEmployee(state,id){return workforceEmployees(state).find(x=>x.id===id)||null}
function workforceDriver(state,employee){return (state.drivers||[]).find(d=>d.id===employee?.id)||null}
function payrollProfile(state,employeeId){
  state.payProfiles??=[];
  let p=state.payProfiles.find(x=>(x.employeeId||x.driverId)===employeeId);
  if(!p){
    const prior=(state.payroll||[]).filter(x=>x.employeeId===employeeId).sort((a,b)=>String(b.period||'').localeCompare(String(a.period||'')))[0],emp=workforceEmployee(state,employeeId);
    p={driverId:employeeId,employeeId,baseSalary:num(emp?.baseSalary)||num(prior?.base),tripRatePerKm:num(prior?.tripRatePerKm),minimumBonusKml:2.0,taxNumber:'',payeThreshold:8000,payeDefault:num(emp?.payeDefault)||num(prior?.paye),sscDefault:num(emp?.sscDefault)||num(prior?.ssc),overtimeRate:0,standardDays:num(prior?.days)||22,otherDeductionDefault:num(prior?.deductions),autoGenerate:true};
    state.payProfiles.push(p)
  }
  if(p.payeThreshold===undefined)p.payeThreshold=8000;
  return p
}
function employeeLoanDeduction(state,employeeId,period,existing=null){
  const loans=(state.loans||[]).filter(l=>l.employeeId===employeeId&&l.status!=='Cancelled'&&l.status!=='Paid'&&num(l.balance)>0&&(!l.startPeriod||String(l.startPeriod)<=String(period)));
  const prior=Array.isArray(existing?.loanBreakdown)?existing.loanBreakdown:[];
  const breakdown=loans.map(l=>{const saved=prior.find(x=>x.loanId===l.id);const scheduled=saved&&existing?.status==='Paid'?num(saved.amount):Math.min(num(l.balance),num(l.monthlyDeduction));return{loanId:l.id,reference:l.reference||'',amount:Number(Math.max(0,scheduled).toFixed(2)),balanceBefore:Number(num(l.balance).toFixed(2))}}).filter(x=>x.amount>0);
  return{amount:Number(breakdown.reduce((a,x)=>a+num(x.amount),0).toFixed(2)),breakdown}
}
function applyPayrollLoanRepayments(state,row,userId=''){
  if(row.loanRepaymentsPosted)return row;state.loans??=[];const actual=[];
  for(const item of row.loanBreakdown||[]){const loan=state.loans.find(x=>x.id===item.loanId);if(!loan||num(loan.balance)<=0)continue;const amount=Number(Math.min(num(item.amount),num(loan.balance)).toFixed(2));if(amount<=0)continue;const before=num(loan.balance),after=Number(Math.max(0,before-amount).toFixed(2));loan.balance=after;loan.status=after<=0?'Paid':(loan.status==='Paused'?'Paused':'Active');loan.updatedAt=new Date().toISOString();loan.repayments??=[];loan.repayments.push({id:'loanpay_'+crypto.randomUUID(),payrollId:row.id,period:row.period,amount,balanceBefore:Number(before.toFixed(2)),balanceAfter:after,paidAt:new Date().toISOString(),recordedBy:userId});actual.push({loanId:loan.id,reference:loan.reference||'',amount,balanceBefore:Number(before.toFixed(2)),balanceAfter:after})}
  row.loanBreakdown=actual;row.loanDeduction=Number(actual.reduce((a,x)=>a+num(x.amount),0).toFixed(2));row.loanRepaymentsPosted=true;row.net=Number((num(row.gross)+num(row.reimbursements)-num(row.advances)-num(row.paye)-num(row.ssc)-num(row.deductions)-num(row.loanDeduction)).toFixed(2));return row
}
function calculatePayrollRecord(state,employee,period,existing=null){
  const p=payrollProfile(state,employee.id),driver=workforceDriver(state,employee),{start,end}=periodBounds(period);
  const inPeriod=d=>String(d||'')>=start&&String(d||'')<end;
  const trips=driver?(state.trips||[]).filter(t=>t.driverId===driver.id&&inPeriod(t.date)&&num(t.stage)>=3):[];
  const tripKm=trips.reduce((a,t)=>a+serverTripLegSummary(state,t).distance,0),tripRatePerKm=num(existing?.tripRatePerKm??p.tripRatePerKm);
  const tripPay=trips.reduce((a,t)=>a+serverTripLegSummary(state,t).distance*serverTripRate(state,t,tripRatePerKm),0);
  const incentive=trips.reduce((a,t)=>a+serverIncentiveFor(state,t),0);
  const reimbursements=driver?(state.expenses||[]).filter(x=>x.driverId===driver.id&&inPeriod(x.date)&&x.reimbursable!==false&&x.status==='Approved').reduce((a,x)=>a+num(x.amount),0):0;
  const advances=driver?(state.advances||[]).filter(x=>x.driverId===driver.id&&inPeriod(x.date)&&x.status!=='Reconciled').reduce((a,x)=>a+num(x.amount),0):0;
  const overtimeHours=num(existing?.overtimeHours??existing?.overtime),overtimeRate=num(existing?.overtimeRate)||num(p.overtimeRate),overtimePay=overtimeHours*overtimeRate;
  const base=num(existing?.base)||num(p.baseSalary)||num(employee.baseSalary),days=num(existing?.days)||num(p.standardDays)||22;
  const gross=base+tripPay+incentive+overtimePay,payeThreshold=num(p.payeThreshold)||8000;
  const configuredPaye=existing?.paye!==undefined?num(existing.paye):num(p.payeDefault),paye=gross>payeThreshold?configuredPaye:0;
  const ssc=existing?.ssc!==undefined?num(existing.ssc):num(p.sscDefault),deductions=existing?.deductions!==undefined?num(existing.deductions):num(p.otherDeductionDefault);
  const loanInfo=employeeLoanDeduction(state,employee.id,period,existing),loanDeduction=existing?.status==='Paid'?num(existing.loanDeduction):loanInfo.amount,loanBreakdown=existing?.status==='Paid'&&Array.isArray(existing.loanBreakdown)?existing.loanBreakdown:loanInfo.breakdown;
  const net=gross+reimbursements-advances-paye-ssc-deductions-loanDeduction;
  return{id:existing?.id||'pay_'+crypto.randomUUID(),period,employeeId:employee.id,days,overtimeHours,overtimeRate,overtimePay:Number(overtimePay.toFixed(2)),base:Number(base.toFixed(2)),tripKm:Number(tripKm.toFixed(2)),tripRatePerKm:Number(tripRatePerKm.toFixed(4)),tripPay:Number(tripPay.toFixed(2)),incentive:Number(incentive.toFixed(2)),fuelSavingBonus:Number(incentive.toFixed(2)),minimumBonusKml:num(p.minimumBonusKml)||2.0,reimbursements:Number(reimbursements.toFixed(2)),advances:Number(advances.toFixed(2)),paye:Number(paye.toFixed(2)),payeThreshold:Number(payeThreshold.toFixed(2)),ssc:Number(ssc.toFixed(2)),deductions:Number(deductions.toFixed(2)),loanDeduction:Number(loanDeduction.toFixed(2)),loanBreakdown,gross:Number(gross.toFixed(2)),net:Number(net.toFixed(2)),tripCount:trips.length,status:existing?.status||'Draft',loanRepaymentsPosted:Boolean(existing?.loanRepaymentsPosted),generatedAt:new Date().toISOString(),autoGenerated:existing?.autoGenerated??true,taxNumber:p.taxNumber||'',setupRequired:!(num(p.baseSalary)>0),jobTitle:employee.jobTitle||employee.title||''}
}
function generatePayrollPeriod(state,period,auto=false){
  state.payroll??=[];
  const rows=[],employees=workforceEmployees(state).filter(x=>x.active!==false&&x.status!=='Inactive');
  for(const employee of employees){
    const p=payrollProfile(state,employee.id);if(auto&&p.autoGenerate===false)continue;
    const existing=state.payroll.find(x=>x.period===period&&x.employeeId===employee.id);
    if(existing&&['Approved','Paid'].includes(existing.status)){rows.push(existing);continue}
    const next=calculatePayrollRecord(state,employee,period,existing||null);
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



function excelImportKey(v){return String(v??'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function excelImportSlug(v){return excelImportKey(v).replace(/\s+/g,'_').slice(0,90)||crypto.randomUUID()}
function excelImportNumber(v){if(typeof v==='number'&&Number.isFinite(v))return v;const s=String(v??'').replace(/[^0-9.,-]/g,'').replace(/,/g,'');const n=Number(s);return Number.isFinite(n)?n:0}
function excelImportDate(v){
  if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);
  const s=String(v??'').trim();if(!s)return'';
  const iso=receiptDateISO(s);if(iso)return iso;
  const mdy=s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);
  if(mdy){let m=Number(mdy[1]),d=Number(mdy[2]),y=Number(mdy[3]);if(y<100)y+=2000;if(m>=1&&m<=12&&d>=1&&d<=31)return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
  return''
}
function excelCell(v){
  if(v===null||v===undefined)return'';
  if(v instanceof Date)return excelImportDate(v);
  if(typeof v==='object'){
    if(v.result!==undefined&&v.result!==null)return excelCell(v.result);
    if(v.text!==undefined)return String(v.text);
    if(Array.isArray(v.richText))return v.richText.map(x=>x.text||'').join('');
    if(v.hyperlink)return String(v.text||v.hyperlink||'');
    if(v.formula)return v.result!==undefined?excelCell(v.result):'';
  }
  return typeof v==='string'?v.trim():v
}
function parseCsvRows(text,delimiter=','){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<String(text||'').length;i++){const ch=text[i],next=text[i+1];
    if(ch==='"'){if(quoted&&next==='"'){cell+='"';i++}else quoted=!quoted}
    else if(ch===delimiter&&!quoted){row.push(cell.trim());cell=''}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell.trim());if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[];cell=''}
    else cell+=ch
  }
  row.push(cell.trim());if(row.some(x=>String(x).trim()!==''))rows.push(row);return rows
}
function decodeLegacyCell(s){return String(s||'').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim()}
function parseLegacyXlsText(buffer){
  const text=buffer.toString('utf8').replace(/^\uFEFF/,'');
  if(/<table[\s>]/i.test(text)){const rows=[];for(const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>decodeLegacyCell(x[1]));if(cells.length)rows.push(cells)}if(rows.length)return[{name:'Sheet1',rows}]}
  if(/<Worksheet\b|<Row\b/i.test(text)){const sheets=[];const parts=[...text.matchAll(/<Worksheet\b[^>]*(?:ss:Name|Name)="([^"]*)"[^>]*>([\s\S]*?)<\/Worksheet>/gi)];const src=parts.length?parts:[[null,'Sheet1',text]];for(const p of src){const body=p[2]||p[1]||'',rows=[];for(const rr of body.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi)){const cells=[...rr[1].matchAll(/<Cell\b[^>]*>[\s\S]*?<Data\b[^>]*>([\s\S]*?)<\/Data>[\s\S]*?<\/Cell>/gi)].map(x=>decodeLegacyCell(x[1]));if(cells.length)rows.push(cells)}if(rows.length)sheets.push({name:p[1]||'Sheet1',rows})}if(sheets.length)return sheets}
  if(text.includes('\t'))return[{name:'Sheet1',rows:parseCsvRows(text,'\t')}];
  if(text.includes(','))return[{name:'Sheet1',rows:parseCsvRows(text,',')}];
  return[]
}
async function readExcelImportFile(file){
  if(!file||!file.buffer)throw Object.assign(Error('Choose an Excel workbook first'),{status:400});
  const name=String(file.originalname||'workbook.xlsx'),ext=path.extname(name).toLowerCase(),zip=file.buffer.slice(0,2).toString('binary')==='PK';
  if(ext==='.csv')return{name,sheets:[{name:'CSV',rows:parseCsvRows(file.buffer.toString('utf8'),',')}]};
  if(ext==='.tsv')return{name,sheets:[{name:'TSV',rows:parseCsvRows(file.buffer.toString('utf8'),'\t')}]};
  if(ext==='.xls'&&!zip){const legacy=parseLegacyXlsText(file.buffer);if(legacy.length)return{name,sheets:legacy,legacy:true};const e=Error('This is an old binary .xls workbook. Save/export it once as .xlsx and the Import Centre will remember the format for future files.');e.status=415;e.code='LEGACY_XLS_BINARY';throw e}
  if(!['.xlsx','.xlsm','.xls','.xltx'].includes(ext)&&!zip){const e=Error('Use an .xlsx, .xls, .xlsm or .csv workbook');e.status=415;throw e}
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(file.buffer);
  const sheets=wb.worksheets.map(ws=>{const rows=[];ws.eachRow({includeEmpty:false},row=>{const vals=[];for(let i=1;i<=Math.max(row.cellCount,row.actualCellCount);i++)vals.push(excelCell(row.getCell(i).value));if(vals.some(x=>String(x??'').trim()!==''))rows.push(vals)});return{name:ws.name,rows}}).filter(x=>x.rows.length);
  if(!sheets.length)throw Object.assign(Error('No readable rows were found in this workbook'),{status:400});
  return{name,sheets}
}
const EXCEL_HEADER_WORDS=new Set(['tms id','primary id','order ref','pro','shipper','status','product','product short description','pick plan date start','origin name','destination name','trailer','equipment','rate','currency','registration','insured value','monthly premium','premium','cover','chassis','driver','distance','income','date']);
function excelHeaderIndex(rows){
  let best=0,bestScore=-1;for(let i=0;i<Math.min(rows.length,35);i++){const keys=(rows[i]||[]).map(excelImportKey),non=keys.filter(Boolean).length,known=keys.reduce((a,k)=>a+(EXCEL_HEADER_WORDS.has(k)?4:[...EXCEL_HEADER_WORDS].some(w=>k.includes(w)||w.includes(k))?1:0),0),score=known+Math.min(non,12)*.05;if(non>=2&&score>bestScore){bestScore=score;best=i}}return best
}
function excelSheetTable(sheet){
  const h=excelHeaderIndex(sheet.rows),raw=(sheet.rows[h]||[]).map((x,i)=>String(x||'').trim()||('Column '+(i+1))),seen=new Map(),headers=raw.map(x=>{const k=x||'Column';const n=(seen.get(k)||0)+1;seen.set(k,n);return n===1?k:k+' '+n});
  const objects=(sheet.rows.slice(h+1)||[]).filter(r=>r.some(x=>String(x??'').trim()!=='')).map(r=>{const o={};headers.forEach((x,i)=>o[x]=excelCell(r[i]));return o});
  return{sheet:sheet.name,headerIndex:h,headers,objects,rawRows:sheet.rows}
}
function excelRowGetter(row){const map={};for(const [k,v] of Object.entries(row||{}))map[excelImportKey(k)]=v;return(...aliases)=>{for(const a of aliases){const key=excelImportKey(a);if(map[key]!==undefined&&String(map[key]??'').trim()!=='')return map[key]}return''}}
function carrierRowFromExcel(row){
  const g=excelRowGetter(row),weights=String(g('Product Weight','Product Net Weight')||'').split(',').map(excelImportNumber).filter(x=>x>0),weightKg=weights.reduce((a,x)=>a+x,0);
  return{tmsId:String(g('TMS ID','Primary ID')||'').trim(),orderRef:String(g('Order Ref','Order Reference')||'').trim(),pro:String(g('Pro','PRO #','Fleet')||'').trim(),shipper:String(g('Shipper')||'').trim(),status:String(g('Status')||'').trim(),product:String(g('Product Short Description','Product','Load')||'').trim(),weightKg,weightUom:String(g('Product Weight UoM','Weight UoM')||'').trim(),pickDate:excelImportDate(g('Pick Plan Date Start','Pick Date','Date')),dropDate:excelImportDate(g('Drop Plan Date Start','Drop Date')),origin:String(g('Origin Name','Origin')||'').trim(),originCity:String(g('Origin City')||'').trim(),destination:String(g('Destination Name','Destination')||'').trim(),destinationCity:String(g('Destination City')||'').trim(),trailers:String(g('Trailer','Trailers')||'').trim(),equipment:String(g('Equipment')||'').trim(),rate:excelImportNumber(g('Rate','Amount')),currency:String(g('Currency')||'NAD').trim(),tenderDate:excelImportDate(g('Tender Date')),acceptDate:excelImportDate(g('Accept Date')),closedDate:excelImportDate(g('Closed Date'))}
}
function insuranceRowsFromExcel(table){
  const direct=table.objects.map(row=>{const g=excelRowGetter(row);return{registration:String(g('Registration','Vehicle Registration','Reg No','Registration No')||'').trim(),description:String(g('Description','Vehicle Description','Make / Model','Asset')||'').trim(),cover:String(g('Cover','Cover Type')||'').trim(),chassis:String(g('Chassis','Chassis Number','VIN')||'').trim(),insuredValue:excelImportNumber(g('Insured Value','Sum Insured','Value')),monthlyPremium:excelImportNumber(g('Monthly Premium','Premium'))}}).filter(x=>x.registration);
  if(direct.length)return direct;
  const out=[];for(const r of table.rawRows||[]){const vals=(r||[]).map(excelCell),i=vals.findIndex(v=>/\bN\s*\d{3,6}\s*W\b/i.test(String(v||'')));if(i<0)continue;const registration=(String(vals[i]).match(/\bN\s*\d{3,6}\s*W\b/i)||[])[0]||String(vals[i]),description=vals.slice(Math.max(0,i-2),i).join(' '),nums=vals.slice(i+1).map(excelImportNumber).filter(x=>x>0),insuredValue=nums.find(x=>x>=10000)||0,monthlyPremium=nums.filter(x=>x>0&&x<insuredValue).slice(-1)[0]||0;out.push({registration,description,cover:vals.find(v=>/comp|comprehensive|third party/i.test(String(v||'')))||'',chassis:vals.find(v=>/[A-HJ-NPR-Z0-9]{12,20}/i.test(String(v||'')))||'',insuredValue,monthlyPremium})}return out
}
function excelImportPreviewData(parsed){
  let best=null;for(const sheet of parsed.sheets){const table=excelSheetTable(sheet),keys=table.headers.map(excelImportKey),has=k=>keys.some(x=>x===k||x.includes(k)),carrier=(has('tms id')?6:0)+(has('order ref')?3:0)+(has('origin name')?2:0)+(has('destination name')?2:0)+(has('rate')?1:0),insurance=(has('registration')?5:0)+(has('insured value')?3:0)+(has('premium')?2:0)+(has('chassis')?1:0);const kind=carrier>=7?'nbl-carrier':insurance>=7?'insurance':'generic',score=Math.max(carrier,insurance);if(!best||score>best.score)best={...table,kind,score}}
  if(!best)throw Object.assign(Error('No readable worksheet found'),{status:400});
  let sample=[],summary={rows:best.objects.length};
  if(best.kind==='nbl-carrier'){const rows=best.objects.map(carrierRowFromExcel).filter(x=>x.tmsId);sample=rows.slice(0,12);summary={rows:rows.length,pendingRates:rows.filter(x=>x.rate<=1).length,unassigned:rows.filter(x=>!x.pro).length}}
  else if(best.kind==='insurance'){const rows=insuranceRowsFromExcel(best);sample=rows.slice(0,12);summary={rows:rows.length,totalInsured:rows.reduce((a,x)=>a+excelImportNumber(x.insuredValue),0),monthlyPremium:rows.reduce((a,x)=>a+excelImportNumber(x.monthlyPremium),0)}}
  else sample=best.objects.slice(0,8);
  return{filename:parsed.name,kind:best.kind,sheet:best.sheet,headers:best.headers,rowCount:best.objects.length,summary,sample,warnings:best.kind==='generic'?['Workbook layout is not recognised yet. Review the columns before importing; no data has been changed.']:[]}
}
function cloneImportArrays(state){const keys=['trips','routes','clients','trucks','trailers','permits'];const out={};for(const k of keys)out[k]=JSON.parse(JSON.stringify(state[k]||[]));return out}
function findImportTruck(state,pro){const n=carrierFleetNumber(pro);return n?(state.trucks||[]).find(x=>Number((String(x.fleetName||'').match(/\d+/)||['0'])[0])===n):null}
function trailerTypeFromImport(equipment=''){const s=String(equipment).toLowerCase();return s.includes('taut')?'Tautliner':s.includes('flat')?'Flat deck':'Trailer'}
function applyCarrierWorkbookRows(state,rows,source,importId){
  state.trips??=[];state.routes??=[];state.clients??=[];state.trailers??=[];let nbl=state.clients.find(x=>x.id==='cli_nbl'||/namibian breweries|^nbl$/i.test(String(x.name||'')));if(!nbl){nbl={id:'cli_nbl',name:'Namibian Breweries Limited',terms:30,contact:'',email:'',status:'Active'};state.clients.push(nbl)}
  let created=0,updated=0,skipped=0,pendingRates=0,unassigned=0,newRoutes=0,newTrailers=0;
  for(const src of rows){
    if(!src.tmsId){skipped++;continue}
    const truck=findImportTruck(state,src.pro);if(!truck)unassigned++;
    const trailerRegs=String(src.trailers||'').split(/[\/;,]+/).map(x=>x.trim()).filter(Boolean),trailerIds=[];
    for(const reg of trailerRegs){let tr=state.trailers.find(x=>fleetKey(x.registration)===fleetKey(reg));if(!tr){tr={id:'trl_excel_'+excelImportSlug(reg),registration:reg,type:trailerTypeFromImport(src.equipment),status:'Available',sourceWorkbook:source,importBatchId:importId};state.trailers.push(tr);newTrailers++}trailerIds.push(tr.id)}
    const routeName=(src.origin||'Unknown origin')+' -> '+(src.destination||'Unknown destination'),actualRate=src.rate>1?src.rate:0,ratePending=src.rate<=1;if(ratePending)pendingRates++;
    let route=state.routes.find(x=>excelImportKey(x.name)===excelImportKey(routeName));if(!route){route={id:'rte_excel_'+excelImportSlug(routeName),name:routeName,distance:0,namibiaKm:0,rate:actualRate,crossBorder:false,roundTrip:false,loadName:src.origin,offloadName:src.destination,notes:'Imported carrier load; '+[src.originCity,src.destinationCity].filter(Boolean).join(' → '),sourceWorkbook:source,importBatchId:importId};state.routes.push(route);newRoutes++}else if(actualRate>0&&num(route.rate)<=0)route.rate=actualRate;
    const load=(src.product?src.product.slice(0,220):'NBL load')+(src.orderRef?' · Order '+src.orderRef:''),tons=src.weightUom.toLowerCase()==='kg'?Number((src.weightKg/1000).toFixed(3)):0;
    let trip=state.trips.find(x=>String(x.externalTmsId||x.sourceTmsId||'')===src.tmsId||x.id==='trip_tms_'+src.tmsId);
    if(!trip){
      const leg={id:'leg_tms_'+src.tmsId,sequence:1,label:'NBL load',routeId:route.id,clientId:nbl.id,load,tons,pallets:0,distance:num(route.distance),namibiaKm:num(route.namibiaKm),pricingMethod:'Manual negotiated',unitRate:0,agreedAmount:actualRate,income:actualRate,status:'Planned',pod:false,invoiceId:''};
      trip={id:'trip_tms_'+src.tmsId,number:'NBL-'+src.tmsId,date:src.pickDate||src.tenderDate||new Date().toISOString().slice(0,10),plannedDropDate:src.dropDate,routeId:route.id,truckId:truck?.id||'',trailerId:trailerIds[0]||'',trailerIds,driverId:'',clientId:nbl.id,load,tons,pallets:0,startKm:0,endKm:0,distance:num(route.distance),income:actualRate,dieselCost:0,tolls:0,allowance:0,other:0,status:'Planned',stage:1,pod:false,invoiceId:'',approved:true,legs:[leg],externalTmsId:src.tmsId,sourceOrderRef:src.orderRef,carrierPro:src.pro,carrierStatus:src.status||'',sourceRate:src.rate,ratePending,equipment:src.equipment,sourceTrailerRegistrations:trailerRegs,sourceWorkbook:source,importBatchId:importId,importedAt:new Date().toISOString()};state.trips.push(trip);created++
    }else{
      trip.date=src.pickDate||trip.date;trip.plannedDropDate=src.dropDate||trip.plannedDropDate;trip.sourceOrderRef=src.orderRef||trip.sourceOrderRef;trip.carrierPro=src.pro||trip.carrierPro;trip.carrierStatus=src.status||trip.carrierStatus;trip.sourceRate=src.rate;trip.ratePending=ratePending;trip.equipment=src.equipment||trip.equipment;trip.sourceTrailerRegistrations=trailerRegs.length?trailerRegs:trip.sourceTrailerRegistrations;trip.sourceWorkbook=source;trip.lastImportBatchId=importId;if(truck)trip.truckId=truck.id;if(trailerIds.length){trip.trailerId=trailerIds[0];trip.trailerIds=trailerIds}trip.routeId=route.id;trip.load=load||trip.load;if(tons>0)trip.tons=tons;
      const leg=ensureTripLegs(state,trip)[0];if(leg){leg.routeId=route.id;leg.clientId=nbl.id;leg.load=load||leg.load;if(tons>0)leg.tons=tons;if(!leg.invoiceId){leg.agreedAmount=actualRate;leg.income=actualRate;trip.income=actualRate}}updated++
    }
    recalcTripCosts(state,trip)
  }
  return{created,updated,skipped,pendingRates,unassigned,newRoutes,newTrailers,total:rows.length}
}
function applyInsuranceWorkbookRows(state,rows,source,importId,rawRows=[]){
  state.trucks??=[];state.trailers??=[];state.permits??=[];let created=0,updated=0,skipped=0,totalInsured=0,totalPremium=0;
  for(const src of rows){const reg=String(src.registration||'').trim();if(!reg){skipped++;continue}totalInsured+=excelImportNumber(src.insuredValue);totalPremium+=excelImportNumber(src.monthlyPremium);let asset=state.trucks.find(x=>fleetKey(x.registration)===fleetKey(reg)),kind='truck';if(!asset){asset=state.trailers.find(x=>fleetKey(x.registration)===fleetKey(reg));kind='trailer'}if(!asset){kind='trailer';asset={id:'trl_ins_'+excelImportSlug(reg),registration:reg,type:trailerTypeFromDescription(src.description||''),status:'Available',importBatchId:importId};state.trailers.push(asset);created++}else updated++;Object.assign(asset,{make:src.description||asset.make||'',chassisNumber:src.chassis||asset.chassisNumber||'',insuranceCover:src.cover||asset.insuranceCover||'',insuredValue:excelImportNumber(src.insuredValue)||num(asset.insuredValue),insuranceMonthlyPremium:excelImportNumber(src.monthlyPremium)||num(asset.insuranceMonthlyPremium),insuranceSource:source,lastImportBatchId:importId})}
  const flat=(rawRows||[]).flat().map(x=>String(x??'').trim()).filter(Boolean),policy=(flat.join(' ').match(/\b\d{9,14}\b/)||[])[0]||'',provider=flat.find(x=>/santam|outsurance|hollard|old mutual|insurance/i.test(x))||'Insurance provider',findLimit=label=>{for(const row of rawRows||[]){if(row.some(v=>excelImportKey(v).includes(label))){const n=row.map(excelImportNumber).find(x=>x>=10000);if(n)return n}}return 0},goods=findLimit('goods in transit'),liability=findLimit('public liability');
  let permit=state.permits.find(x=>x.ownerType==='company'&&(/insurance/i.test(String(x.type||''))||(policy&&String(x.reference||'')===policy)));const vals={type:'Commercial insurance',ownerType:'company',ownerId:'company',reference:policy||permit?.reference||'',issued:permit?.issued||'',expiry:permit?.expiry||'',provider,monthlyPremium:Number(totalPremium.toFixed(2)),goodsInTransitLimit:goods||num(permit?.goodsInTransitLimit),publicLiabilityLimit:liability||num(permit?.publicLiabilityLimit),notes:'Imported from '+source,sourceWorkbook:source,lastImportBatchId:importId};if(permit){Object.assign(permit,vals);updated++}else{permit={id:'permit_ins_'+crypto.randomUUID(),...vals,importBatchId:importId};state.permits.unshift(permit);created++}
  return{created,updated,skipped,total:rows.length,totalInsured:Number(totalInsured.toFixed(2)),monthlyPremium:Number(totalPremium.toFixed(2))}
}
app.post('/api/imports/excel/preview',auth,roles('admin','manager','dispatcher','finance'),upload.single('workbook'),async(req,res)=>{try{const parsed=await readExcelImportFile(req.file),preview=excelImportPreviewData(parsed);res.json(preview)}catch(e){res.status(e.status||500).json({error:e.message,code:e.code||''})}});
app.post('/api/imports/excel/apply',auth,roles('admin','manager','dispatcher','finance'),upload.single('workbook'),async(req,res)=>{
  try{
    const parsed=await readExcelImportFile(req.file),preview=excelImportPreviewData(parsed);if(preview.kind==='generic')return res.status(400).json({error:'This workbook layout is not mapped yet. No records were changed.'});
    const importId='import_'+crypto.randomUUID(),source=parsed.name+' / '+preview.sheet,receipt=await storeCompanyReceipt(req.file,req.user,'excel-import',importId,'excel-import');
    const table=excelSheetTable(parsed.sheets.find(x=>x.name===preview.sheet)||parsed.sheets[0]),changed=await mutateOpsState(state=>{
      state.importHistory??=[];for(const h of state.importHistory)h.canUndo=false;state.lastImportBackup={importId,createdAt:new Date().toISOString(),snapshot:cloneImportArrays(state)};
      let result;if(preview.kind==='nbl-carrier')result=applyCarrierWorkbookRows(state,table.objects.map(carrierRowFromExcel).filter(x=>x.tmsId),source,importId);else result=applyInsuranceWorkbookRows(state,insuranceRowsFromExcel(table),source,importId,table.rawRows);
      const history={id:importId,date:new Date().toISOString(),filename:parsed.name,sheet:preview.sheet,type:preview.kind,created:num(result.created),updated:num(result.updated),skipped:num(result.skipped),errors:0,status:'Imported',sourceReceiptId:receipt?.id||'',canUndo:true,summary:result,importedBy:req.user.name||req.user.email||req.user.role};state.importHistory.unshift(history);state.importHistory=state.importHistory.slice(0,60);state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'Excel import '+parsed.name+' · '+preview.kind+' · '+result.created+' created · '+result.updated+' updated',linkedType:'excel-import',linkedId:importId});state.audit=state.audit.slice(0,100);return history
    });res.status(201).json(changed.result)
  }catch(e){res.status(e.status||500).json({error:e.message,code:e.code||''})}
});
app.post('/api/imports/excel/:id/undo',auth,roles('admin','manager','finance'),async(req,res)=>{try{const changed=await mutateOpsState(state=>{const backup=state.lastImportBackup;if(!backup||backup.importId!==req.params.id){const e=Error('Only the most recent safe Excel import can be undone');e.status=409;throw e}for(const [k,v] of Object.entries(backup.snapshot||{}))state[k]=v;const h=(state.importHistory||[]).find(x=>x.id===req.params.id);if(h){h.status='Undone';h.canUndo=false;h.undoneAt=new Date().toISOString();h.undoneBy=req.user.name||req.user.email||req.user.role}state.lastImportBackup=null;return h||{id:req.params.id,status:'Undone'}});res.json(changed.result)}catch(e){res.status(e.status||500).json({error:e.message})}});


const CANONICAL_FLEET=[
  {id:'trk_ang2',fleetName:'Ang 2',registration:'N 228751 W'},
  {id:'trk_ang3',fleetName:'Ang 3',registration:'N 228757 W'},
  {id:'trk_ang4',fleetName:'Ang 4',registration:'N 60518 W'},
  {id:'trk_ang5',fleetName:'Ang 5',registration:'N 48332 W'},
  {id:'trk_ang10',fleetName:'Ang 10',registration:'N 57660 W'},
  {id:'trk_ang11',fleetName:'Ang 11',registration:'N 78215 W'},
  {id:'trk_ang12',fleetName:'Ang 12',registration:'N 46928 W'}
];
const CANONICAL_FLEET_VERSION='2026-09-28-ang-fleet-v1';
function fleetKey(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'')}
function referencedTruckIds(state){
  const ids=new Set(),add=v=>{if(v)ids.add(String(v))};
  for(const key of ['trips','diesel','expenses','tripIssues','maintenance','tyres','inspections','incidents'])for(const x of state[key]||[])add(x.truckId);
  for(const p of state.permits||[])if(p.ownerType==='truck')add(p.ownerId);
  for(const t of state.tasks||[])if(t.linkedType==='truck')add(t.linkedId);
  return ids
}
async function ensureCanonicalFleet(){
  const changed=await mutateOpsState(state=>{
    if(state.canonicalFleetVersion===CANONICAL_FLEET_VERSION&&Array.isArray(state.trucks)&&state.trucks.length===CANONICAL_FLEET.length)return{skipped:true,count:state.trucks.length};
    state.trucks??=[];state.archivedTrucks??=[];
    const prior=[...state.trucks],refs=referencedTruckIds(state),used=new Set();
    const active=CANONICAL_FLEET.map(spec=>{
      const match=prior.find(x=>!used.has(x.id)&&(fleetKey(x.registration)===fleetKey(spec.registration)||fleetKey(x.fleetName)===fleetKey(spec.fleetName)));
      if(match){
        used.add(match.id);
        return {...match,fleetName:spec.fleetName,registration:spec.registration,type:match.type||'Truck',status:/out of service|workshop|on trip|on duty|available/i.test(String(match.status||''))?match.status:'Available',gps:match.trackerId?'Tracker linked':(match.gps||'Not linked')};
      }
      return {...spec,make:'',type:'Truck',status:'Available',odometer:0,serviceDue:0,licenseExpiry:'',roadworthyExpiry:'',trackerId:'',trackerModel:'',gps:'Not linked'}
    });
    const archiveById=new Map((state.archivedTrucks||[]).map(x=>[String(x.id),x]));
    for(const old of prior){
      if(used.has(old.id)||active.some(x=>x.id===old.id))continue;
      if(refs.has(String(old.id)))archiveById.set(String(old.id),{...old,status:'Archived',archivedAt:new Date().toISOString()});
    }
    state.trucks=active;
    state.archivedTrucks=[...archiveById.values()].filter(x=>!active.some(a=>a.id===x.id));
    state.canonicalFleetVersion=CANONICAL_FLEET_VERSION;
    state.audit??=[];
    state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:'System',action:'Fleet synchronized to 7 Angermund trucks · Ang 2, 3, 4, 5, 10, 11, 12',linkedType:'fleet',linkedId:CANONICAL_FLEET_VERSION});
    state.audit=state.audit.slice(0,100);
    return{skipped:false,count:active.length,archived:state.archivedTrucks.length}
  });
  return changed.result
}


const INSURANCE_WORKBOOK_IMPORT={
version:'2026-09-30-santam-summary-004-v1',source:'Angermund summary_ (004).xls / Sheet5 / 02-07-2026',
policy:{provider:'Santam',reference:'63119390204',issued:'2026-07-02',monthlyPremium:61253.82,goodsInTransitLimit:1000000,publicLiabilityLimit:1000000,insuredDriverCount:9},
trucks:[
{registration:'N 48332 W',description:'2008 Scania G420 LA 6x4 MHZ Truck Tractor',cover:'Comp',chassis:'9BSG6X40003633573',insuredValue:274000,monthlyPremium:2059.46},
{registration:'N 60518 W',description:'2007 Scania R124 GA 6x4NZ T/T C/C',cover:'Comp',chassis:'9BSR6X40003609991',insuredValue:243000,monthlyPremium:1826.48},
{registration:'N 57660 W',description:'2007 Scania G420 LA6x4 MHZ T/T C/C',cover:'Comp',chassis:'9BSG6X40003629517',insuredValue:243000,monthlyPremium:1826.48},
{registration:'N 78215 W',description:'2016 Scania R410 LA 6x4 MSZ',cover:'Comp',chassis:'9BSR6X40003884348',insuredValue:630000,monthlyPremium:5426.60},
{registration:'N 46928 W',description:'2016 Scania R410 LA 6x4 MSZ',cover:'Comp',chassis:'9BSR6X40003884084',insuredValue:630000,monthlyPremium:5426.60},
{registration:'N 228757 W',description:'2019 Scania G460A 6x4NZ T/T C/C',cover:'Comp',chassis:'9BSG6X40003952388',insuredValue:950000,monthlyPremium:8078.84},
{registration:'N 228751 W',description:'2019 Scania G460A 6x4NZ T/T C/C',cover:'Comp',chassis:'9BSG6X40003952393',insuredValue:950000,monthlyPremium:8078.84}],
trailers:[
{registration:'N 99297 W',description:'2012 Afrit Flatdeck Interlink Trailer',cover:'Comp',chassis:'ADV16851AB12F3427',insuredValue:60000,monthlyPremium:455.14},
{registration:'N 113256 W',description:'2011 Afrit Flatdeck Interlink Trailer',cover:'Comp',chassis:'ADV16781AB13F2862',insuredValue:60000,monthlyPremium:455.14},
{registration:'N 49108 W',description:'2008 Afrit Interlink Trailer',cover:'Comp',chassis:'ADV7757038ABS0027',insuredValue:60000,monthlyPremium:455.09},
{registration:'N 49078 W',description:'2008 Afrit Interlink Trailer',cover:'Comp',chassis:'ADV7757048ABS0028',insuredValue:60000,monthlyPremium:455.09},
{registration:'N 187021 W',description:'2015 Hendred Fruehauf 2 Axle 6/12m Flat Deck',cover:'Comp',chassis:'AAH120580PHFJ2061',insuredValue:80000,monthlyPremium:585.85},
{registration:'N 187023 W',description:'2015 Hendred Fruehauf 2 Axle 6/12m Flat Deck',cover:'Comp',chassis:'AAH120581PHRF2122',insuredValue:80000,monthlyPremium:585.85},
{registration:'N 76413 W',description:'2010 Afrit Flatdeck Interlink Trailer',cover:'Comp',chassis:'ADV16412AA07F2015',insuredValue:70000,monthlyPremium:483.35},
{registration:'N 71184 W',description:'2010 Afrit Flatdeck Interlink Trailer',cover:'Comp',chassis:'ADV16412AA08F2016',insuredValue:70000,monthlyPremium:483.35},
{registration:'N 191232 W',description:'2016 Afrit Tandem Axle Tautliner Trailer',cover:'Comp',chassis:'ADV18328AG03C0208',insuredValue:125000,monthlyPremium:897.63},
{registration:'N 191231 W',description:'2016 Afrit Tandem Axle Tautliner Trailer',cover:'Comp',chassis:'ADV18328AG04C0209',insuredValue:125000,monthlyPremium:897.63},
{registration:'N 138588 W',description:'2011 Top Trailer 6/12m Tandem Tautliner',cover:'Comp',chassis:'ADSM236WMB1CS0676',insuredValue:100000,monthlyPremium:724.38},
{registration:'N 138587 W',description:'2011 Top Trailer 6/12m Tandem Tautliner',cover:'Comp',chassis:'ADSM236WMB1CS0675',insuredValue:100000,monthlyPremium:684.13},
{registration:'N 173559 W',description:'2017 Hendred Freuhauf Tautliner Link',cover:'Comp',chassis:'AHBDSB2FTHB010366',insuredValue:172500,monthlyPremium:1205.22},
{registration:'N 177260 W',description:'2017 Hendred Freuhauf Tautliner Link',cover:'Comp',chassis:'AHBDSB2RTHB010367',insuredValue:172500,monthlyPremium:1205.22}]};
function trailerTypeFromDescription(v){return /tautliner/i.test(String(v||''))?'Tautliner':/flat|interlink/i.test(String(v||''))?'Flat deck / interlink':'Trailer'}
async function applyInsuranceWorkbookImport(){const data=INSURANCE_WORKBOOK_IMPORT;const changed=await mutateOpsState(state=>{if(state.insuranceWorkbookImportVersion===data.version)return{skipped:true};state.trucks=state.trucks||[];state.trailers=state.trailers||[];state.permits=state.permits||[];let truckUpdates=0,trailerAdds=0;for(const src of data.trucks){const t=state.trucks.find(x=>fleetKey(x.registration)===fleetKey(src.registration));if(!t)continue;Object.assign(t,{make:src.description,chassisNumber:src.chassis,insuranceCover:src.cover,insuredValue:src.insuredValue,insuranceMonthlyPremium:src.monthlyPremium,insurancePolicy:data.policy.reference,insuranceProvider:data.policy.provider,insuranceEffectiveDate:data.policy.issued,insuranceSource:data.source});truckUpdates++}for(const src of data.trailers){let t=state.trailers.find(x=>fleetKey(x.registration)===fleetKey(src.registration));if(!t){t={id:'trl_ins_'+fleetKey(src.registration),registration:src.registration,type:trailerTypeFromDescription(src.description),status:'Available'};state.trailers.push(t);trailerAdds++}Object.assign(t,{make:src.description,chassisNumber:src.chassis,insuranceCover:src.cover,insuredValue:src.insuredValue,insuranceMonthlyPremium:src.monthlyPremium,insurancePolicy:data.policy.reference,insuranceProvider:data.policy.provider,insuranceEffectiveDate:data.policy.issued,insuranceSource:data.source})}let p=state.permits.find(x=>x.id==='permit_santam_63119390204'||(x.ownerType==='company'&&String(x.reference||'')===data.policy.reference));const values={type:'Commercial insurance - Santam',ownerType:'company',ownerId:'company',reference:data.policy.reference,issued:data.policy.issued,expiry:'',provider:data.policy.provider,monthlyPremium:data.policy.monthlyPremium,goodsInTransitLimit:data.policy.goodsInTransitLimit,publicLiabilityLimit:data.policy.publicLiabilityLimit,insuredDriverCount:data.policy.insuredDriverCount,notes:'Goods in transit N$1,000,000; Public liability N$1,000,000; 9 truck drivers; total monthly policy premium N$61,253.82',sourceWorkbook:data.source};if(p)Object.assign(p,values);else state.permits.unshift({id:'permit_santam_63119390204',...values});state.insuranceWorkbookImportVersion=data.version;state.audit=state.audit||[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:'System',action:'Santam insurance summary imported - '+truckUpdates+' active trucks enriched - '+data.trailers.length+' trailer records',linkedType:'permit',linkedId:'permit_santam_63119390204'});state.audit=state.audit.slice(0,100);return{skipped:false,truckUpdates,trailerAdds,trailers:state.trailers.length,policy:data.policy}});return changed.result}

const NBL_CARRIER_LOAD_IMPORT={"version":"2026-09-30-carrier-load-status-441332-v1","source":"carrier_load_status441332.xlsx / Search Results","loads":[{"tmsId":"65921321","orderRef":"0888855824","pro":"ANG05","pickDate":"2026-09-24","dropDate":"2026-09-24","origin":"RAMATEX 2","originCity":"WINDHOEK","destination":"EMPTIES YARD NORTH","destinationCity":"WINDHOEK","trailers":"N113256W/N99297W","equipment":"38T FLATDECK","rate":0.01},{"tmsId":"65926023","orderRef":"0888854842","pro":"ANG11","pickDate":"2026-09-25","dropDate":"2026-09-28","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"SEFELANA CASH & CARRY T/A METRO ZAM","destinationCity":"KATIMA MULILO","trailers":"N138587W/N138588W","equipment":"38T FLATDECK","rate":61267},{"tmsId":"65928905","orderRef":"0888857100","pro":"ANG 12","pickDate":"2026-09-28","dropDate":"2026-09-29","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"WOERMANN LIQUOR NKURENKURU 94","destinationCity":"NKURENGKURU","trailers":"N76413W/N71184W","equipment":"38T FLATDECK","rate":42159},{"tmsId":"65935462","orderRef":"0888859716","pro":"ANG 4","pickDate":"2026-09-29","dropDate":"2026-09-29","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"DISTELL WHK","destinationCity":"WINDHOEK","trailers":"N49078W/N49108W","equipment":"36T FLAT DECK","rate":0.01},{"tmsId":"65935736","orderRef":"NBL32550","pro":"ANG 4","pickDate":"2026-09-29","dropDate":"2026-09-29","origin":"EMPTIES YARD NORTH","originCity":"WINDHOEK","destination":"MCG","destinationCity":"WINDHOEK","trailers":"N49078W/N49108W","equipment":"36T FLAT DECK","rate":0.01},{"tmsId":"65940459","orderRef":"0888859750","pro":"ANG 04","pickDate":"2026-09-30","dropDate":"2026-09-30","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"DISTELL WHK","destinationCity":"WINDHOEK","trailers":"N49078W/N49108W","equipment":"36T FLAT DECK","rate":0.01},{"tmsId":"65941152","orderRef":"0888862994","pro":"ANG 10","pickDate":"2026-09-30","dropDate":"2026-09-30","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"OKASHANDJA DEPOT","destinationCity":"WINDHOEK","trailers":"N187023W/N187021W","equipment":"38T FLATDECK","rate":1943},{"tmsId":"65941157","orderRef":"888861757","pro":"ANG 10","pickDate":"2026-09-30","dropDate":"2026-10-01","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"MAKITI BAR","destinationCity":"SWAKOPMUND","trailers":"N187023W/N187021W","equipment":"38T FLATDECK","rate":17946},{"tmsId":"65941533","orderRef":"NBL32580","pro":"ANG 05","pickDate":"2026-09-30","dropDate":"2026-09-30","origin":"RAMATEX 2","originCity":"WINDHOEK","destination":"PRO EX AUCTIONEERS","destinationCity":"WINDHOEK","trailers":"N113256W/N99297W","equipment":"36T FLAT DECK","rate":0.01},{"tmsId":"65946034","orderRef":"NBL32595","pro":"ANG 05","pickDate":"2026-09-30","dropDate":"2026-09-30","origin":"RAMATEX 2","originCity":"WINDHOEK","destination":"EMPTIES YARD NORTH","destinationCity":"WINDHOEK","trailers":"N113256W/N99297W","equipment":"36T FLAT DECK","rate":0.01},{"tmsId":"65946265","orderRef":"0888859774","pro":"ANG 4","pickDate":"2026-10-01","dropDate":"2026-10-01","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"DISTELL WHK","destinationCity":"WINDHOEK","trailers":"N49078W/N49108W","equipment":"36T FLAT DECK","rate":0.01},{"tmsId":"65946384","orderRef":"0888859777","pro":"","pickDate":"2026-10-01","dropDate":"2026-10-01","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"DISTELL WHK","destinationCity":"WINDHOEK","trailers":"","equipment":"36T FLAT DECK","rate":0.01},{"tmsId":"65946629","orderRef":"0888861940,0888861942","pro":"ANG11","pickDate":"2026-10-01","dropDate":"2026-10-02","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"SEFALANA T/A METRO LIQUOR OSHAKATI","destinationCity":"OSHAKATI","trailers":"N138587W/N138588W","equipment":"36T FLAT DECK","rate":34719},{"tmsId":"65946636","orderRef":"NBL32599","pro":"ANG12","pickDate":"2026-10-01","dropDate":"2026-10-02","origin":"WINDHOEK DC","originCity":"WINDHOEK","destination":"TRI-STAR INVESTMENTS CC","destinationCity":"OPUWO","trailers":"N76413W/N71184W","equipment":"38T FLATDECK","rate":36743},{"tmsId":"65947566","orderRef":"NBL32605","pro":"ANG 5","pickDate":"2026-10-01","dropDate":"2026-10-01","origin":"RAMATEX 2","originCity":"WINDHOEK","destination":"PRO EX AUCTIONEERS","destinationCity":"WINDHOEK","trailers":"N113256W/N99297W","equipment":"36T FLAT DECK","rate":0.01}]};
function carrierFleetNumber(pro){const m=String(pro||'').match(/(\d+)/);return m?Number(m[1]):0}
async function applyNblCarrierLoadImport(){const data=NBL_CARRIER_LOAD_IMPORT;const changed=await mutateOpsState(state=>{if(state.nblCarrierLoadImportVersion===data.version)return{skipped:true};state.trips=state.trips||[];state.routes=state.routes||[];state.clients=state.clients||[];state.trailers=state.trailers||[];const nbl=state.clients.find(x=>x.id==='cli_nbl'||/namibian breweries|^nbl$/i.test(String(x.name||'')));if(!nbl)throw Error('NBL client not found for carrier-load import');let added=0,unassigned=0,pendingRates=0;const findTrailer=reg=>state.trailers.find(x=>fleetKey(x.registration)===fleetKey(reg));for(const src of data.loads){if(state.trips.some(x=>String(x.externalTmsId||'')===src.tmsId||x.id==='trip_tms_'+src.tmsId))continue;const n=carrierFleetNumber(src.pro),truck=state.trucks.find(x=>Number((String(x.fleetName||'').match(/\d+/)||['0'])[0])===n),trailerRegs=String(src.trailers||'').split('/').map(x=>x.trim()).filter(Boolean),trailerIds=trailerRegs.map(r=>{const t=findTrailer(r);return t&&t.id}).filter(Boolean),routeName=src.origin+' -> '+src.destination,actualRate=num(src.rate)>1?num(src.rate):0,ratePending=num(src.rate)<=1;let route=state.routes.find(x=>workbookImportKey(x.name)===workbookImportKey(routeName));if(!route){route={id:'rte_tms_'+workbookImportSlug(src.origin+'_'+src.destination),name:routeName,distance:0,namibiaKm:0,rate:actualRate,crossBorder:false,roundTrip:false,loadName:src.origin,offloadName:src.destination,notes:'NBL carrier load status; '+src.originCity+' -> '+src.destinationCity+'; distance to be confirmed'};state.routes.push(route)}else if(actualRate>0&&num(route.rate)<=0)route.rate=actualRate;const id='trip_tms_'+src.tmsId,load='NBL '+(ratePending?'internal/local movement':'accepted load')+' - Order '+src.orderRef,leg={id:'leg_tms_'+src.tmsId,sequence:1,label:'NBL load',routeId:route.id,clientId:nbl.id,load,tons:0,pallets:0,distance:0,namibiaKm:0,pricingMethod:'Manual negotiated',unitRate:0,agreedAmount:actualRate,income:actualRate,status:'Planned',pod:false,invoiceId:''};state.trips.push({id,number:'NBL-'+src.tmsId,date:src.pickDate,plannedDropDate:src.dropDate,routeId:route.id,truckId:(truck&&truck.id)||'',trailerId:trailerIds[0]||'',trailerIds,driverId:'',clientId:nbl.id,load,tons:0,pallets:0,startKm:0,endKm:0,distance:0,income:actualRate,dieselCost:0,tolls:0,allowance:0,other:0,status:'Planned',stage:1,pod:false,invoiceId:'',approved:true,legs:[leg],externalTmsId:src.tmsId,sourceOrderRef:src.orderRef,carrierPro:src.pro,carrierStatus:'ACCEPTED',sourceRate:num(src.rate),ratePending,equipment:src.equipment,sourceTrailerRegistrations:trailerRegs,sourceWorkbook:data.source,importedAt:new Date().toISOString()});added++;if(!truck)unassigned++;if(ratePending)pendingRates++}state.nblCarrierLoadImportVersion=data.version;state.audit=state.audit||[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:'System',action:'NBL carrier load status imported - '+added+' accepted loads - '+unassigned+' unassigned truck - '+pendingRates+' source rates pending',linkedType:'trip',linkedId:data.version});state.audit=state.audit.slice(0,100);return{skipped:false,added,unassigned,pendingRates,total:data.loads.length}});return changed.result}

const TRIP_WORKBOOK_TEST_IMPORT={"version":"2026-09-30-sheet1-current-v2","source":"Trip Reports Vernon (1).xlsx / Sheet1","expected":{"trips":7,"distance":10136,"income":238188,"expenses":123605.12,"profit":114582.88},"trips":[
{"sourceIndex":1,"sourceRow":1,"driver":"JOSEF","client":"NBL","registration":"N 46928 W","fleet":12,"date":"2026-08-28","startKm":1750255,"endKm":1751736,"origin":"Windhoek","destination":"Rundu","returnOrigin":"Rundu","returnDestination":"Windhoek","note":"","distance":1481,"income":34361,"fuel":[{"date":"2026-01-09","supplier":"Bonsmara","litres":610.26,"amount":16324.57,"price":26.750188444269657}],"fuelTotal":16324.57,"tolls":0,"sAndT":500,"driverTripMoney":740.5,"offloading":0,"other":0,"expectedTotalExpenses":17565.07,"expectedProfit":16795.93},
{"sourceIndex":2,"sourceRow":47,"driver":"JOSEF","client":"NBL","registration":"N 46928 W","fleet":12,"date":"2026-01-09","startKm":1751736,"endKm":1752579,"origin":"Windhoek","destination":"Walvis","returnOrigin":"Walvis","returnDestination":"Windhoek","note":"","distance":843,"income":17438,"fuel":[{"date":"2026-03-09","supplier":"Bonsmara","litres":300,"amount":8505,"price":28.35}],"fuelTotal":8505,"tolls":0,"sAndT":500,"driverTripMoney":421.5,"offloading":0,"other":0,"expectedTotalExpenses":9426.5,"expectedProfit":8011.5},
{"sourceIndex":3,"sourceRow":93,"driver":"JOSEF","client":"NBL","registration":"N 46928 W","fleet":12,"date":"2026-03-09","startKm":1752579,"endKm":1754181,"origin":"Windhoek","destination":"Tsandi","returnOrigin":"Tsandi","returnDestination":"Windhoek","note":"","distance":1602,"income":39191,"fuel":[{"date":"2026-07-09","supplier":"Bonsmara","litres":680.23,"amount":19284.57,"price":28.350072769504433}],"fuelTotal":19284.57,"tolls":0,"sAndT":500,"driverTripMoney":801,"offloading":0,"other":0,"expectedTotalExpenses":20585.57,"expectedProfit":18605.43},
{"sourceIndex":4,"sourceRow":139,"driver":"JOSEF","client":"NBL","registration":"N 46928 W","fleet":12,"date":"2026-07-09","startKm":1754181,"endKm":1755660,"origin":"Windhoek","destination":"Rundu","returnOrigin":"Rundu","returnDestination":"Windhoek","note":"","distance":1479,"income":35459,"fuel":[{"date":"2026-09-14","supplier":"Bonsmara","litres":514.15,"amount":14576.11,"price":28.34991733929787}],"fuelTotal":14576.11,"tolls":0,"sAndT":500,"driverTripMoney":739.5,"offloading":0,"other":0,"expectedTotalExpenses":15815.61,"expectedProfit":19643.39},
{"sourceIndex":5,"sourceRow":185,"driver":"ANTON","client":"NBL","registration":"N 46928 W","fleet":12,"date":"2026-09-15","startKm":1755660,"endKm":1757388,"origin":"Windhoek","destination":"Oshakati","returnOrigin":"Oshakati","returnDestination":"Windhoek","note":"Load Emoties in Kongoloa","distance":1728,"income":40919,"fuel":[{"date":"2026-09-22","supplier":"Bonsmara","litres":705.4,"amount":19998,"price":28.349872412815426}],"fuelTotal":19998,"tolls":0,"sAndT":500,"driverTripMoney":864,"offloading":0,"other":0,"expectedTotalExpenses":21362,"expectedProfit":19557},
{"sourceIndex":6,"sourceRow":231,"driver":"JOSEF","client":"NBL","registration":"N 46928 W","fleet":12,"date":"2026-09-22","startKm":1757388,"endKm":1758911,"origin":"Windhoek","destination":"Endola","returnOrigin":"Endola","returnDestination":"Windhoek","note":"","distance":1523,"income":36101,"fuel":[{"date":"2026-09-24","supplier":"Bonsmara","litres":653.06,"amount":18514.21,"price":28.349937218632284}],"fuelTotal":18514.21,"tolls":0,"sAndT":500,"driverTripMoney":761.5,"offloading":0,"other":0,"expectedTotalExpenses":19775.71,"expectedProfit":16325.29},
{"sourceIndex":7,"sourceRow":277,"driver":"JOSEF","client":"NBL","registration":"N 46928 W","fleet":12,"date":"2026-09-24","startKm":1758911,"endKm":1760391,"origin":"Windhoek","destination":"Oshakati","returnOrigin":"Oshakati","returnDestination":"Windhoek","note":"","distance":1480,"income":34719,"fuel":[{"date":"2026-09-28","supplier":"Bonsmara","litres":629.09,"amount":17834.66,"price":28.349934031696577}],"fuelTotal":17834.66,"tolls":0,"sAndT":500,"driverTripMoney":740,"offloading":0,"other":0,"expectedTotalExpenses":19074.66,"expectedProfit":15644.34}
]};

function workbookImportKey(v){return String(v||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function workbookImportSlug(v){return workbookImportKey(v).replace(/\s+/g,'_')||'item'}
function applyWorkbookTripsToState(state){
  const data=TRIP_WORKBOOK_TEST_IMPORT,oldWorkbookTrips=(state.trips||[]).filter(x=>/^trip_xlsx_\d+$/.test(String(x.id||''))||/Trip Reports Vernon/i.test(String(x.sourceWorkbook||''))),oldTripIds=new Set(oldWorkbookTrips.map(x=>String(x.id)));
  state.trucks??=[];state.drivers??=[];state.clients??=[];state.routes??=[];

  const findDriver=name=>{
    const key=workbookImportKey(name),first=key.split(' ')[0];
    let d=(state.drivers||[]).find(x=>workbookImportKey(x.name)===key);
    if(!d&&first){
      const matches=(state.drivers||[]).filter(x=>workbookImportKey(x.name).split(' ')[0]===first);
      if(matches.length===1)d=matches[0]
    }
    if(!d){
      d={id:'drv_xlsx_'+workbookImportSlug(name),name:String(name||'Imported Driver').trim(),phone:'',license:'CE',prdpExpiry:'',passportExpiry:'',status:'Available',role:'Driver',score:0,source:'Trip Reports Vernon.xlsx'};
      state.drivers.push(d)
    }
    return d
  };
  const findClient=name=>{
    const key=workbookImportKey(name);
    let c=(state.clients||[]).find(x=>x.id==='cli_nbl'||workbookImportKey(x.name)===key||(/\bnbl\b/.test(key)&&/namibian breweries|\bnbl\b/.test(workbookImportKey(x.name))));
    if(!c){
      c={id:'cli_xlsx_'+workbookImportSlug(name),name:name==='NBL'?'Namibian Breweries Limited':String(name||'Imported Client'),terms:30,contact:'',email:'',status:'Active',source:'Trip Reports Vernon.xlsx'};
      state.clients.push(c)
    }
    return c
  };
  const findTruck=registration=>{
    const k=fleetKey(registration);
    let t=(state.trucks||[]).find(x=>fleetKey(x.registration)===k);
    if(!t){
      t={id:'trk_xlsx_'+workbookImportSlug(registration),fleetName:'Imported '+registration,registration:String(registration||''),make:'',type:'Truck',status:'Available',odometer:0,serviceDue:0,licenseExpiry:'',roadworthyExpiry:'',trackerId:'',trackerModel:'',gps:'Not linked'};
      state.trucks.push(t)
    }
    return t
  };
  const findRoute=src=>{
    const origin=String(src.origin||'').trim(),dest=String(src.destination||'').trim(),name=origin+' ↔ '+dest;
    const ok=v=>workbookImportKey(v);
    let r=(state.routes||[]).find(x=>ok(x.name)===ok(name));
    if(!r){
      r={id:'rte_xlsx_'+workbookImportSlug(origin+'_'+dest),name,distance:num(src.distance),rate:num(src.income),crossBorder:/south africa|cape town|johannesburg|durban|rosslyn|ottery/i.test(name),roundTrip:true,notes:'Imported from Trip Reports Vernon.xlsx for workbook reconciliation'};
      state.routes.push(r)
    }
    return r
  };

  // Replace only the workbook test trips. Keep unrelated operational data intact.
  state.trips=(state.trips||[]).filter(x=>!oldTripIds.has(String(x.id)));
  state.diesel=(state.diesel||[]).filter(x=>!oldTripIds.has(String(x.tripId))&&!/Trip Reports Vernon/i.test(String(x.sourceWorkbook||'')));
  state.expenses=(state.expenses||[]).filter(x=>!oldTripIds.has(String(x.tripId))&&!/Trip Reports Vernon/i.test(String(x.sourceWorkbook||'')));
  state.invoices=(state.invoices||[]).filter(x=>!oldTripIds.has(String(x.tripId)));
  state.payments=(state.payments||[]).filter(x=>!oldTripIds.has(String(x.tripId)));
  state.advances=(state.advances||[]).filter(x=>!oldTripIds.has(String(x.tripId)));
  state.tripIssues=(state.tripIssues||[]).filter(x=>!oldTripIds.has(String(x.tripId)));
  state.inspections=(state.inspections||[]).filter(x=>!x.tripId||!oldTripIds.has(String(x.tripId)));
  state.tasks=(state.tasks||[]).filter(x=>!(x.linkedType==='trip'&&oldTripIds.has(String(x.linkedId||''))));
  state.approvals=(state.approvals||[]).filter(x=>!(x.linkedType==='trip'&&oldTripIds.has(String(x.linkedId||''))));
  state.incidents=(state.incidents||[]).map(x=>x.tripId&&oldTripIds.has(String(x.tripId))?{...x,tripId:''}:x);

  const importedTrips=[],importedDiesel=[],importedExpenses=[];
  for(const src of data.trips){
    const n=String(src.sourceIndex).padStart(2,'0'),id='trip_xlsx_'+n,driver=findDriver(src.driver),client=findClient(src.client),truck=findTruck(src.registration),route=findRoute(src);
    const trip={id,number:'AT-XLS-'+n,date:src.date,routeId:route.id,truckId:truck.id,trailerId:'',driverId:driver.id,clientId:client.id,load:'NBL load · '+src.origin+' → '+src.destination+' → '+src.returnDestination,tons:0,pallets:0,startKm:num(src.startKm),endKm:num(src.endKm),distance:num(src.distance),income:num(src.income),dieselCost:0,tolls:0,allowance:0,other:0,status:'Closed',stage:5,pod:true,invoiceId:'',approved:true,sourceWorkbook:data.source,sourceRow:src.sourceRow,sourceExpectedTotalExpenses:num(src.expectedTotalExpenses),sourceExpectedProfit:num(src.expectedProfit),notes:src.note||''};
    importedTrips.push(trip);

    for(let i=0;i<(src.fuel||[]).length;i++){
      const f=src.fuel[i],amount=num(f.amount),litres=num(f.litres),price=num(f.price)||(litres?amount/litres:0);
      importedDiesel.push({id:'fuel_xlsx_'+n+'_'+String(i+1).padStart(2,'0'),tripId:id,date:f.date||src.date,truckId:truck.id,driverId:driver.id,litres,price:Number(price.toFixed(6)),total:Number(amount.toFixed(2)),printedTotal:Number(amount.toFixed(2)),odometer:0,supplier:f.supplier||'',slip:'Workbook import row '+src.sourceRow,verified:true,status:'Verified',scope:'trip',companyPaid:true,receiptCount:0,receiptSource:'workbook',sourceWorkbook:data.source})
    }
    const addExpense=(suffix,category,amount,notes='')=>{if(num(amount)<=0)return;importedExpenses.push({id:'expense_xlsx_'+n+'_'+suffix,date:src.date,tripId:id,truckId:truck.id,driverId:driver.id,category,supplier:category==='Toll'?'Toll gates':'Trip report',amount:Number(num(amount).toFixed(2)),receiptNo:'',notes,status:'Approved',reimbursable:false,systemGenerated:false,sourceWorkbook:data.source})};
    addExpense('st','S&T / trip allowance',src.sAndT,'Imported S&T from trip report');
    addExpense('driver','Driver trip money',src.driverTripMoney,'Imported driver trip money · '+num(src.distance).toFixed(0)+' km × N$0.50');
    addExpense('toll','Toll',src.tolls,'Imported toll total');
    addExpense('offload','Loading / offloading',src.offloading,'Imported offloading expense');
    addExpense('other','Other',src.other,'Imported other expense');
  }
  state.trips=[...importedTrips,...state.trips];
  state.diesel=[...importedDiesel,...state.diesel];
  state.expenses=[...importedExpenses,...state.expenses];
  for(const t of importedTrips)recalcTripCosts(state,t);

  const maxEnd=Math.max(0,...state.trips.map(x=>num(x.endKm)));
  for(const t of state.trucks){
    if(state.trips.some(x=>x.truckId===t.id)){
      t.odometer=Math.max(num(t.odometer),maxEnd);
      if(!/workshop|out of service/i.test(String(t.status||'')))t.status='Available'
    }
  }
  for(const d of state.drivers)if(state.trips.some(x=>x.driverId===d.id)&&/on trip|on duty/i.test(String(d.status||'')))d.status='Available';

  const actual={
    trips:importedTrips.length,
    distance:Number(importedTrips.reduce((a,x)=>a+num(x.distance),0).toFixed(2)),
    income:Number(importedTrips.reduce((a,x)=>a+num(x.income),0).toFixed(2)),
    expenses:Number(importedTrips.reduce((a,x)=>a+num(x.actualTripCost),0).toFixed(2)),
    profit:Number(importedTrips.reduce((a,x)=>a+num(x.actualProfit),0).toFixed(2))
  };
  const expected=data.expected;
  for(const k of ['trips','distance','income','expenses','profit'])if(Math.abs(num(actual[k])-num(expected[k]))>.02)throw Error('Workbook import validation failed for '+k+': expected '+expected[k]+' got '+actual[k]);

  state.tripWorkbookImportVersion=data.version;
  state.tripWorkbookImportSource=data.source;
  state.tripWorkbookImportExpected=expected;
  state.tripWorkbookImportActual=actual;
  state.audit??=[];
  state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:'System',action:'Workbook trips refreshed from uploaded Sheet1 · 7 trips · income N$238,188.00 · expenses N$123,605.12 · profit N$114,582.88',linkedType:'workbook-import',linkedId:data.version});
  state.audit=state.audit.slice(0,100);
  return{oldTripIds:[...oldTripIds],actual,expected,drivers:[...new Set(state.trips.map(t=>t.driverId))],truckIds:[...new Set(state.trips.map(t=>t.truckId))]}
}
async function applyTripWorkbookTestImport(){
  const version=TRIP_WORKBOOK_TEST_IMPORT.version;
  if(pool){
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const row=(await c.query('SELECT payload,revision FROM app_state WHERE id=1 FOR UPDATE')).rows[0]||{payload:{},revision:0};
      const state=row.payload||{};
      if(state.tripWorkbookImportVersion===version){await c.query('ROLLBACK');return{skipped:true,version,actual:state.tripWorkbookImportActual||null}}
      await c.query('INSERT INTO app_state_backups(id,version,payload,note) VALUES($1,$2,$3,$4) ON CONFLICT(version) DO NOTHING',[crypto.randomUUID(),version,state,'Backup before Trip Reports Vernon.xlsx test import']);
      const result=applyWorkbookTripsToState(state);
      const updated=(await c.query('UPDATE app_state SET payload=$1,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision,updated_at',[state])).rows[0];
      await c.query('COMMIT');
      emit('state',{revision:updated.revision,updatedAt:updated.updated_at});
      return{skipped:false,version,...result}
    }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  }
  const state=memory.state||{};if(state.tripWorkbookImportVersion===version)return{skipped:true,version,actual:state.tripWorkbookImportActual||null};
  const result=applyWorkbookTripsToState(state);memory.state=state;emit('state',{revision:Date.now()});return{skipped:false,version,...result}
}

async function applyWorkforceEnvImport(){
  const version=String(process.env.WORKFORCE_IMPORT_VERSION||'').trim();
  if(!version)return {skipped:true};
  let employees,drivers,payProfiles,payroll;
  if(process.env.WORKFORCE_IMPORT_GZIP_B64){
    const raw=require('zlib').gunzipSync(Buffer.from(process.env.WORKFORCE_IMPORT_GZIP_B64,'base64')).toString('utf8');
    const payload=JSON.parse(raw);
    employees=payload.employees;drivers=payload.drivers;payProfiles=payload.payProfiles;payroll=payload.payroll;
  }else{
    const parts=['WORKFORCE_EMPLOYEES_B64','WORKFORCE_DRIVERS_B64','WORKFORCE_PAYPROFILES_B64','WORKFORCE_PAYROLL_B64'];
    if(parts.some(k=>!process.env[k]))return {skipped:true};
    const decode=k=>JSON.parse(Buffer.from(process.env[k],'base64').toString('utf8'));
    employees=decode(parts[0]);drivers=decode(parts[1]);payProfiles=decode(parts[2]);payroll=decode(parts[3]);
  }
  if(employees.length!==24||drivers.length!==10||payProfiles.length!==24||payroll.length!==24)throw Error('Workforce import count validation failed');
  const driverIds=new Set(drivers.map(x=>String(x.id)));
  const changed=await mutateOpsState(state=>{
    if(state.workforceImportVersion===version)return {skipped:true,count:(state.employees||[]).length};
    state.employees=employees;
    state.drivers=drivers;
    state.payProfiles=payProfiles;
    state.payroll=payroll;
    state.settings??={};state.settings.currentDriver=drivers[0]?.id||'';
    state.tasks=(state.tasks||[]).map(t=>t.assignedDriverId&&!driverIds.has(String(t.assignedDriverId))?{...t,assignedDriverId:''}:t);
    state.permits=(state.permits||[]).filter(p=>p.ownerType!=='driver'||driverIds.has(String(p.ownerId)));
    state.workforceImportVersion=version;
    state.workforceImportPeriod='2026-08';
    state.audit??=[];
    state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:'System',action:'Workforce replaced from August 2026 salary workbook · 24 workers / 10 drivers',linkedType:'workforce',linkedId:version});
    state.audit=state.audit.slice(0,100);
    return {skipped:false,employees:employees.length,drivers:drivers.length,payProfiles:payProfiles.length,payroll:payroll.length}
  });
  if(pool&&!changed.result.skipped){
    const keep=drivers.map(x=>String(x.id));
    await q("UPDATE users SET active=false WHERE role='driver' AND driver_id IS NOT NULL AND NOT (driver_id = ANY($1::text[]))",[keep]);
  }
  return changed.result
}

function workforceNameKey(v){
  return String(v||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')
}
async function reconcileWorkforceUserLinks(){
  if(!pool)return {linkedDrivers:0,linkedStaff:0};
  const snapshot=await readOpsState(),employees=workforceEmployees(snapshot),drivers=snapshot.drivers||[];
  const byName=(arr)=>{const m=new Map();for(const x of arr){const k=workforceNameKey(x.name);if(!k)continue;const a=m.get(k)||[];a.push(x);m.set(k,a)}return m};
  const empNames=byName(employees),driverNames=byName(drivers),employeeIds=new Set(employees.map(x=>String(x.id))),driverIds=new Set(drivers.map(x=>String(x.id)));
  const users=await q('SELECT id,name,role,driver_id AS "driverId",staff_id AS "staffId" FROM users');
  let linkedDrivers=0,linkedStaff=0;
  for(const u of users){
    if(u.role==='driver'){
      if(u.driverId&&driverIds.has(String(u.driverId)))continue;
      const matches=driverNames.get(workforceNameKey(u.name))||[];
      if(matches.length===1){await q('UPDATE users SET driver_id=$2,staff_id=NULL WHERE id=$1',[u.id,matches[0].id]);linkedDrivers++}
      else if(u.driverId&&!driverIds.has(String(u.driverId)))await q('UPDATE users SET driver_id=NULL WHERE id=$1',[u.id]);
      continue
    }
    if(u.staffId&&employeeIds.has(String(u.staffId)))continue;
    const matches=empNames.get(workforceNameKey(u.name))||[];
    if(matches.length===1){await q('UPDATE users SET staff_id=$2,driver_id=NULL WHERE id=$1',[u.id,matches[0].id]);linkedStaff++}
    else if(u.staffId&&!employeeIds.has(String(u.staffId)))await q('UPDATE users SET staff_id=NULL WHERE id=$1',[u.id]);
  }
  return {linkedDrivers,linkedStaff}
}

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
app.post('/api/payroll/loans',auth,roles('admin','manager','finance'),async(req,res)=>{try{const body=req.body&&typeof req.body==='object'?req.body:{},employeeId=String(body.employeeId||''),amount=num(body.amount),monthlyDeduction=num(body.monthlyDeduction);if(!employeeId||amount<=0||monthlyDeduction<=0)return res.status(400).json({error:'Employee, loan amount and monthly deduction are required'});const changed=await mutateOpsState(state=>{const employee=workforceEmployee(state,employeeId);if(!employee){const e=Error('Employee not found');e.status=404;throw e}state.loans??=[];const loan={id:'loan_'+crypto.randomUUID(),employeeId,date:String(body.date||new Date().toISOString().slice(0,10)),startPeriod:String(body.startPeriod||monthPeriod(new Date())),amount:Number(amount.toFixed(2)),balance:Number(amount.toFixed(2)),monthlyDeduction:Number(monthlyDeduction.toFixed(2)),reference:String(body.reference||'').slice(0,100),notes:String(body.notes||'').slice(0,500),status:['Active','Paused'].includes(body.status)?body.status:'Active',repayments:[],createdAt:new Date().toISOString(),createdBy:req.user.sub};state.loans.unshift(loan);return loan});res.status(201).json(changed.result)}catch(e){res.status(e.status||500).json({error:e.message})}});
app.patch('/api/payroll/loans/:id',auth,roles('admin','manager','finance'),async(req,res)=>{try{const body=req.body&&typeof req.body==='object'?req.body:{};const changed=await mutateOpsState(state=>{state.loans??=[];const loan=state.loans.find(x=>x.id===req.params.id);if(!loan){const e=Error('Loan not found');e.status=404;throw e}if(body.monthlyDeduction!==undefined){const v=num(body.monthlyDeduction);if(v<=0){const e=Error('Monthly deduction must be greater than zero');e.status=400;throw e}loan.monthlyDeduction=Number(v.toFixed(2))}if(body.balance!==undefined){const v=Math.max(0,num(body.balance));loan.balance=Number(v.toFixed(2));if(v<=0)loan.status='Paid'}if(body.reference!==undefined)loan.reference=String(body.reference||'').slice(0,100);if(body.notes!==undefined)loan.notes=String(body.notes||'').slice(0,500);if(body.startPeriod!==undefined)loan.startPeriod=String(body.startPeriod||'');if(body.status!==undefined&&['Active','Paused','Cancelled','Paid'].includes(String(body.status)))loan.status=String(body.status);loan.updatedAt=new Date().toISOString();loan.updatedBy=req.user.sub;return loan});res.json(changed.result)}catch(e){res.status(e.status||500).json({error:e.message})}});
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
      const employee=workforceEmployee(state,did);if(!employee){const e=Error('Employee not found');e.status=404;throw e}
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
      const employee=workforceEmployee(state,row.employeeId);if(!employee){const e=Error('Employee not found');e.status=404;throw e}
      for(const key of ['days','overtimeHours','overtimeRate','base','tripRatePerKm','paye','ssc','deductions'])if(body[key]!==undefined)row[key]=num(body[key]);
      const wasStatus=row.status,wantedStatus=wasStatus==='Paid'?'Paid':(body.status!==undefined?String(body.status):row.status);
      Object.assign(row,calculatePayrollRecord(state,employee,row.period,row));
      if(['Draft','Approved','Paid'].includes(wantedStatus))row.status=wantedStatus;
      if(row.status==='Approved'&&!row.approvedAt)row.approvedAt=new Date().toISOString();
      if(row.status==='Paid'&&wasStatus!=='Paid'){applyPayrollLoanRepayments(state,row,req.user.sub);row.paidAt=new Date().toISOString()}
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
function isNblClient(client){const k=String((client&&client.name)||'').toLowerCase();return String((client&&client.id)||'')==='cli_nbl'||k==='nbl'||k.indexOf('namibian breweries')>=0}
function nblInvoiceCycleBounds(endMonth){if(!/^\d{4}-\d{2}$/.test(String(endMonth||''))){const e=Error('Cycle month must be YYYY-MM');e.status=400;throw e}const p=String(endMonth).split('-').map(Number),end=new Date(Date.UTC(p[0],p[1]-1,20)),start=new Date(Date.UTC(p[0],p[1]-2,21));return{start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)}}
function tripInvoiceDate(t){return String((t&&(t.deliveredDate||t.completedDate||t.closedDate||t.date))||'').slice(0,10)}
function tripReadyForBilling(t,leg){return Boolean((leg&&leg.pod)||(t&&t.pod)||num(t&&t.stage)>=4||/delivered|closed|invoiced/i.test(String((t&&t.status)||'')))}
function collectNblInvoiceLines(state,nbl,start,end){
  const lines=[],excluded=[];
  for(const t of state.trips||[]){
    const billDate=tripInvoiceDate(t);if(!billDate||billDate<start||billDate>end)continue;
    const legs=ensureTripLegs(state,t);
    for(const leg of legs){
      if(leg.clientId!==nbl.id)continue;
      if(!tripReadyForBilling(t,leg)){excluded.push({tripId:t.id,tripNumber:t.number||t.id,reason:'Not delivered / no POD'});continue}
      if(leg.invoiceId){excluded.push({tripId:t.id,tripNumber:t.number||t.id,reason:'Already invoiced'});continue}
      const r=(state.routes||[]).find(x=>x.id===leg.routeId),tr=(state.trucks||[]).find(x=>x.id===t.truckId),dr=(state.drivers||[]).find(x=>x.id===t.driverId),amount=Number(calculateLegIncome(leg).toFixed(2));
      lines.push({tripId:t.id,legId:leg.id,date:billDate,tripNumber:t.number||t.id,route:(r&&r.name)||'',truck:(tr&&(tr.fleetName||tr.registration))||'',registration:(tr&&tr.registration)||'',driver:(dr&&dr.name)||'',load:leg.load||t.load||'',amount})
    }
  }
  lines.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.tripNumber).localeCompare(String(b.tripNumber)));
  return{lines,excluded}
}
function linkNblInvoiceLines(state,inv,lines){
  for(const line of lines){
    const t=(state.trips||[]).find(x=>x.id===line.tripId);if(!t)continue;
    const leg=ensureTripLegs(state,t).find(x=>x.id===line.legId);if(!leg)continue;
    leg.invoiceId=inv.id;leg.invoiceStatus='Unpaid';
    const all=ensureTripLegs(state,t);
    if(all.every(x=>x.invoiceId)){t.stage=Math.max(num(t.stage),5);t.status='Invoiced';t.invoiceIds=Array.from(new Set(all.map(x=>x.invoiceId).filter(Boolean)))}
  }
}
function buildNblConsolidatedInvoice(state,cycleMonth){
  const bounds=nblInvoiceCycleBounds(cycleMonth),start=bounds.start,end=bounds.end;
  state.invoices=state.invoices||[];
  const nbl=(state.clients||[]).find(isNblClient);if(!nbl){const e=Error('Namibian Breweries / NBL client was not found');e.status=404;throw e}
  const existing=state.invoices.find(x=>x.consolidated===true&&x.clientId===nbl.id&&x.periodStart===start&&x.periodEnd===end);
  if(existing)return{invoice:existing,existing:true,lines:existing.lines||[],excluded:[]};
  const found=collectNblInvoiceLines(state,nbl,start,end),lines=found.lines,excluded=found.excluded;
  if(!lines.length){const e=Error('No uninvoiced NBL trips are ready in the '+start+' to '+end+' cycle');e.status=400;throw e}
  const highest=state.invoices.reduce((m,x)=>{const n=Number(String(x.number||'').split('-').pop())||0;return Math.max(m,n)},999);
  const terms=num(nbl.terms)||30,endDate=new Date(end+'T00:00:00Z'),dueDate=new Date(endDate.getTime()+terms*86400000),amount=Number(lines.reduce((a,x)=>a+num(x.amount),0).toFixed(2));
  const inv={id:'inv_'+crypto.randomUUID(),number:'INV-'+(highest+1),date:end,clientId:nbl.id,tripId:'',amount,due:dueDate.toISOString().slice(0,10),status:'Unpaid',consolidated:true,billingCycle:'20th cutoff',periodStart:start,periodEnd:end,cutoffDay:20,lines,tripIds:Array.from(new Set(lines.map(x=>x.tripId))),lineCount:lines.length};
  state.invoices.unshift(inv);linkNblInvoiceLines(state,inv,lines);
  return{invoice:inv,existing:false,lines,excluded}
}
app.post('/api/invoices/nbl/consolidated',auth,roles('admin','manager','finance'),async(req,res)=>{try{const changed=await mutateOpsState(state=>buildNblConsolidatedInvoice(state,String((req.body&&req.body.cycleMonth)||'')));res.status(changed.result.existing?200:201).json(changed.result)}catch(e){res.status(e.status||500).json({error:e.message})}});
app.post('/api/admin/trips/:tripId/legs/:legId/invoice',auth,roles('admin','manager','finance'),async(req,res)=>{
  try{
    const changed=await mutateOpsState(async state=>{
      state.invoices??=[];
      const t=(state.trips||[]).find(x=>x.id===req.params.tripId);if(!t){const e=Error('Trip not found');e.status=404;throw e}
      const invoiceLegs=ensureTripLegs(state,t),leg=String(req.params.legId).startsWith('legacy_')?invoiceLegs[0]:invoiceLegs.find(x=>x.id===req.params.legId);if(!leg){const e=Error('Journey leg not found');e.status=404;throw e}
      const legClient=(state.clients||[]).find(x=>x.id===leg.clientId);
      if(isNblClient(legClient)){const e=Error('NBL uses one consolidated invoice per 20th billing cycle. Generate it from Invoices & Payments.');e.status=409;throw e}
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
      const state=row.payload||{}, {trip:t,did}=driverTrip(state,req),leg=activeTripLegServer(t),now=new Date().toISOString(),date=receiptDateISO(data.date),mk=p=>p+'_'+crypto.randomUUID();if(!date){const e=Error('Receipt date could not be read. Confirm the slip date before saving.');e.status=400;throw e}
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
    const state=await readOpsState(),{trip:t,did}=driverTrip(state,req),leg=activeTripLegServer(t),now=new Date().toISOString(),date=receiptDateISO(data.date),mk=p=>p+'_'+crypto.randomUUID(),ids=[];if(!date)return res.status(400).json({error:'Receipt date could not be read. Confirm the slip date before saving.'});
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
  const limit=Math.max(1,Math.min(500,num(req.query.limit)||300)),state=await readOpsState();
  const refs=new Map();
  for(const x of state.diesel||[])for(const id of (x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean))refs.set(id,{posted:true,linkedRecordType:'diesel',linkedRecordId:x.id,tripId:x.tripId||'',truckId:x.truckId||'',driverId:x.driverId||'',category:'Diesel'});
  for(const x of state.expenses||[])for(const id of (x.receiptUploadIds||[x.receiptUploadId]).filter(Boolean))refs.set(id,{posted:true,linkedRecordType:'expense',linkedRecordId:x.id,tripId:x.tripId||'',truckId:x.truckId||'',driverId:x.driverId||'',category:x.category||'Other'});
  for(const x of state.tripIssues||[])if(x.photoUploadId)refs.set(x.photoUploadId,{posted:true,linkedRecordType:'problem',linkedRecordId:x.id,tripId:x.tripId||'',truckId:x.truckId||'',driverId:x.driverId||'',category:'Problem'});
  for(const x of state.trips||[]){
    if(x.podUploadId)refs.set(x.podUploadId,{posted:true,linkedRecordType:'pod',linkedRecordId:x.id,tripId:x.id,truckId:x.truckId||'',driverId:x.driverId||'',category:'POD'});
    for(const l of x.legs||[])if(l.podUploadId)refs.set(l.podUploadId,{posted:true,linkedRecordType:'pod',linkedRecordId:l.id,tripId:x.id,truckId:x.truckId||'',driverId:x.driverId||'',category:'POD'})
  }
  const tripById=id=>(state.trips||[]).find(x=>x.id===id);
  const locationFor=meta=>{
    const t=tripById(meta.tripId),cat=String(meta.category||'Document');
    if(t)return 'Trip '+String(t.number||t.id)+' / '+cat;
    if(meta.linkedRecordType==='diesel'||cat==='Diesel')return 'Company / Diesel Control';
    if(meta.linkedRecordType==='expense')return 'Company / Expenses / '+cat;
    return 'Company / Uploads'
  };
  let driverRows=[],companyRows=[];
  if(pool){
    driverRows=await q('SELECT du.id,du.user_id AS "userId",u.driver_id AS "driverId",u.name AS "userName",du.trip_id AS "tripId",du.kind,du.filename,du.mime_type AS "mimeType",octet_length(du.content) AS size,du.created_at AS "createdAt" FROM driver_uploads du LEFT JOIN users u ON u.id=du.user_id ORDER BY du.created_at DESC LIMIT $1',[limit]);
    companyRows=await q('SELECT cr.id,cr.user_id AS "userId",u.name AS "userName",cr.linked_type AS "linkedType",cr.linked_id AS "linkedId",cr.kind,cr.filename,cr.mime_type AS "mimeType",octet_length(cr.content) AS size,cr.created_at AS "createdAt" FROM company_receipts cr LEFT JOIN users u ON u.id=cr.user_id ORDER BY cr.created_at DESC LIMIT $1',[limit])
  }else{
    driverRows=memory.uploads.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit).map(x=>({id:x.id,userId:x.userId,driverId:x.driverId||null,userName:x.userName||'',tripId:x.tripId,kind:x.kind,filename:x.filename,mimeType:x.mimeType,size:x.content?.length||0,createdAt:x.createdAt}));
    companyRows=(memory.companyReceipts||[]).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit).map(x=>({id:x.id,userId:x.userId,userName:'',linkedType:x.linkedType,linkedId:x.linkedId,kind:x.kind,filename:x.filename,mimeType:x.mimeType,size:x.content?.length||0,createdAt:x.createdAt}))
  }
  const driver=driverRows.map(x=>{
    const ref=refs.get(x.id)||{posted:false,linkedRecordType:null,linkedRecordId:null,tripId:x.tripId||'',truckId:'',driverId:x.driverId||'',category:uploadCategoryFromKind(x.kind)};
    const meta={...x,...ref,source:'driver'};
    meta.location=locationFor(meta);
    return meta
  });
  const company=companyRows.map(x=>{
    let rec=null,type='';
    if(x.linkedType==='fuel'){rec=(state.diesel||[]).find(r=>r.id===x.linkedId);type='diesel'}
    else if(x.linkedType==='expense'){rec=(state.expenses||[]).find(r=>r.id===x.linkedId);type='expense'}
    else{
      rec=(state.diesel||[]).find(r=>r.receiptUploadId===x.id)||(state.expenses||[]).find(r=>r.receiptUploadId===x.id);
      type=rec&&Object.prototype.hasOwnProperty.call(rec,'litres')?'diesel':(rec?'expense':'')
    }
    const meta={...x,source:'company',posted:true,linkedRecordType:type||x.linkedType||'document',linkedRecordId:(rec&&rec.id)||x.linkedId||'',tripId:(rec&&rec.tripId)||'',truckId:(rec&&rec.truckId)||'',driverId:(rec&&rec.driverId)||'',category:type==='diesel'?'Diesel':((rec&&rec.category)||uploadCategoryFromKind(x.kind))};
    meta.location=locationFor(meta);
    return meta
  });
  res.json([...driver,...company].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit))
});

app.post('/api/admin/driver-uploads/:id/scan',auth,roles('admin','manager','dispatcher','finance'),async(req,res)=>{
  try{
    const u=pool?(await q('SELECT du.id,du.user_id AS "userId",u.driver_id AS "driverId",u.name AS "userName",du.trip_id AS "tripId",du.kind,du.filename,du.mime_type AS "mimeType",du.content FROM driver_uploads du LEFT JOIN users u ON u.id=du.user_id WHERE du.id=$1',[req.params.id]))[0]:memory.uploads.find(x=>x.id===req.params.id);
    if(!u)return res.status(404).json({error:'Upload not found'});
    const state=await readOpsState(),result=await analyzeReceiptHybrid(u.content,u.mimeType,state);
    res.json({upload:{id:u.id,driverId:u.driverId||null,userName:u.userName||'',tripId:u.tripId,kind:u.kind,filename:u.filename,mimeType:u.mimeType},extracted:result.extracted,confidence:result.confidence,ai:result.ai})
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
app.get('/api/company/receipts/:id',auth,async(req,res)=>{
  const r=pool?(await q('SELECT id,user_id AS "userId",linked_type AS "linkedType",linked_id AS "linkedId",kind,filename,mime_type AS "mimeType",content FROM company_receipts WHERE id=$1',[req.params.id]))[0]:memory.companyReceipts.find(x=>x.id===req.params.id);
  if(!r)return res.status(404).json({error:'Receipt not found'});
  res.set({'Content-Type':r.mimeType||'application/octet-stream','Content-Disposition':'inline; filename="'+String(r.filename||'receipt').replace(/"/g,'')+'"'});res.send(r.content)
});
app.get('/api/driver/uploads/:id',auth,async(req,res)=>{const u=pool?(await q('SELECT id,user_id AS "userId",trip_id AS "tripId",kind,filename,mime_type AS "mimeType",content FROM driver_uploads WHERE id=$1',[req.params.id]))[0]:memory.uploads.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Upload not found'});if(req.user.role==='driver'&&u.userId!==req.user.sub)return res.status(403).json({error:'Access denied'});res.set({'Content-Type':u.mimeType||'application/octet-stream','Content-Disposition':'inline; filename="'+String(u.filename||'document').replace(/"/g,'')+'"'});res.send(u.content)});
app.post('/api/driver/trips/:tripId/action',auth,roles('driver'),async(req,res)=>{const action=String(req.body.action||''),data=req.body.data&&typeof req.body.data==='object'?req.body.data:{},clientActionId=String(req.body.clientActionId||'').slice(0,100);const allowed=['accept','inspection','start','arrive','pod','finish','diesel','expense','problem'];if(!allowed.includes(action))return res.status(400).json({error:'Invalid driver action'});try{const changed=await mutateOpsState(async state=>{state.driverActions??=[];if(clientActionId){const prior=state.driverActions.find(x=>x.clientActionId===clientActionId);if(prior)return{duplicate:true,action,tripId:req.params.tripId}}const{trip:t,did}=driverTrip(state,req),now=new Date().toISOString(),date=now.slice(0,10),mk=p=>p+'_'+crypto.randomUUID(),legs=ensureTripLegs(state,t),leg=activeTripLegServer(t),multi=legs.length>1;state.inspections??=[];state.diesel??=[];state.expenses??=[];state.tripIssues??=[];state.tasks??=[];state.trucks??=[];state.drivers??=[];if(action==='accept'){t.driverAcceptedAt=t.driverAcceptedAt||now;t.stage=Math.max(1,num(t.stage)||1);t.status=t.status||'Planned'}else if(action==='inspection'){const defects=String(data.defects||'').trim(),passed=!defects;state.inspections.unshift({id:mk('ins'),date,tripId:t.id,truckId:t.truckId,driverId:did,type:'Pre-trip',score:passed?100:80,status:passed?'Passed':'Failed',defects,items:{tyres:true,lights:true,brakes:true,fluids:true,documents:true,load:true},driverEasyMode:true});if(passed&&num(t.stage)<2){t.stage=2;t.status='Loading'}if(passed&&leg)leg.status='Loading'}else if(action==='start'){const passed=state.inspections.some(x=>x.tripId===t.id&&x.driverId===did&&x.type==='Pre-trip'&&x.status==='Passed');if(!passed){const e=Error('Complete the pre-trip vehicle check first');e.status=400;throw e}t.stage=3;t.status='In transit';t.startedAt=t.startedAt||now;if(leg){leg.status='In transit';leg.startedAt=leg.startedAt||now;}const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='On trip';const dr=state.drivers.find(x=>x.id===did);if(dr)dr.status='On trip'}else if(action==='arrive'){if(leg){leg.status='At offloading';leg.arrivedAt=leg.arrivedAt||now}t.status='At offloading';t.arrivedAt=t.arrivedAt||now;if(!state.tasks.some(x=>x.linkedId===t.id&&x.legId===leg?.id&&/POD/i.test(x.title)&&x.status==='Open'))state.tasks.unshift({id:mk('task'),title:'Upload POD for '+t.number+(multi&&leg?' · '+leg.label:''),ownerRole:'Driver',assignedDriverId:t.driverId||'',linkedType:'trip',linkedId:t.id,legId:leg?.id||'',due:date,priority:'High',status:'Open'})}else if(action==='pod'){if(!data.uploadId){const e=Error('Take a POD photo first');e.status=400;throw e}if(leg){leg.pod=true;leg.podUploadId=data.uploadId;leg.podAt=now;leg.status='Delivered'}state.tasks.filter(x=>x.linkedId===t.id&&(!x.legId||x.legId===leg?.id)&&/POD/i.test(x.title)).forEach(x=>x.status='Completed');const next=legs.find(x=>!['Delivered','Invoiced','Closed'].includes(String(x.status||'')));if(next&&next.id!==leg?.id){next.status='Loading';t.stage=2;t.status='Loading';t.pod=false;t.podUploadId='';t.geo={};}else{t.pod=true;t.podUploadId=data.uploadId;t.podAt=now;t.stage=4;t.status='Delivered'}}else if(action==='finish'){if(legs.some(x=>!x.pod)){const e=Error('POD is required for every journey leg before finishing');e.status=400;throw e}if(!t.pod){const e=Error('POD photo is required before finishing the trip');e.status=400;throw e}t.driverComplete=true;t.driverCompletedAt=now;const tr=state.trucks.find(x=>x.id===t.truckId);if(tr)tr.status='Available';const dr=state.drivers.find(x=>x.id===did);if(dr)dr.status='Available';if(!state.tasks.some(x=>x.linkedId===t.id&&/Review completed trip/i.test(x.title)&&x.status==='Open'))state.tasks.unshift({id:mk('task'),title:'Review completed trip '+t.number,ownerRole:'Dispatcher',linkedType:'trip',linkedId:t.id,due:date,priority:'Normal',status:'Open'})}else if(action==='diesel'){const litres=num(data.litres),total=num(data.total),price=num(data.price)||(litres>0?total/litres:0);if(litres<=0){const e=Error('Enter diesel litres');e.status=400;throw e}const rec={id:mk('fuel'),tripId:t.id,legId:leg?.id||'',date,truckId:t.truckId,driverId:did,litres,price,total:total>0?total:Number((litres*price).toFixed(2)),odometer:num(data.odometer),supplier:String(data.supplier||''),slip:String(data.slip||''),receiptUploadId:data.uploadId||'',receiptUploadIds:Array.isArray(data.receiptUploadIds)?data.receiptUploadIds.slice(0,2):(data.uploadId?[data.uploadId]:[]),supportingReceiptUploadId:String(data.supportingUploadId||''),receiptCount:Array.isArray(data.receiptUploadIds)?Math.min(2,data.receiptUploadIds.length):(data.uploadId?1:0),verified:false,detectedCategory:String(data.detectedCategory||'Diesel'),categoryConfidence:num(data.categoryConfidence),fuelTransactions:Array.isArray(data.fuelTransactions)?data.fuelTransactions.slice(0,10):[],fuelTransactionCount:num(data.fuelTransactionCount)||1,printedTotal:num(data.printedTotal)||null,receiptAdjustment:data.adjustment===null||data.adjustment===undefined?null:num(data.adjustment),driverEasyMode:true};state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel');t.dieselCost=state.diesel.filter(x=>x.tripId===t.id).reduce((a,x)=>a+(num(x.printedTotal)||num(x.total)||num(x.litres)*num(x.price)),0);t.routeExpenseCost=state.expenses.filter(x=>x.tripId===t.id).reduce((a,x)=>a+num(x.amount),0)}else if(action==='expense'){const amount=num(data.amount);if(amount<=0){const e=Error('Enter the expense amount');e.status=400;throw e}const category=String(data.category||'Other'),supplier=String(data.supplier||'');state.expenses.unshift({id:mk('expense'),date,tripId:t.id,legId:leg?.id||'',truckId:t.truckId,driverId:did,category,supplier,amount,receiptNo:String(data.receiptNo||''),notes:String(data.notes||''),receiptUploadId:data.uploadId||'',receiptUploadIds:Array.isArray(data.receiptUploadIds)?data.receiptUploadIds.slice(0,2):(data.uploadId?[data.uploadId]:[]),supportingReceiptUploadId:String(data.supportingUploadId||''),receiptCount:Array.isArray(data.receiptUploadIds)?Math.min(2,data.receiptUploadIds.length):(data.uploadId?1:0),status:data.uploadId?'Review':'Receipt missing',reimbursable:true,detectedCategory:String(data.detectedCategory||''),categoryConfidence:num(data.categoryConfidence),driverEasyMode:true});rememberSupplierCategory(state,supplier,category);t.routeExpenseCost=state.expenses.filter(x=>x.tripId===t.id).reduce((a,x)=>a+num(x.amount),0);t.dieselCost=state.diesel.filter(x=>x.tripId===t.id).reduce((a,x)=>a+(num(x.printedTotal)||num(x.total)||num(x.litres)*num(x.price)),0)}else if(action==='problem'){const type=String(data.type||'Other'),description=String(data.description||'').trim();state.tripIssues.unshift({id:mk('issue'),date,tripId:t.id,truckId:t.truckId,driverId:did,type,location:String(data.location||''),cost:num(data.cost),description:description||type,action:String(data.actionTaken||''),photoUploadId:data.uploadId||'',status:'Open',driverEasyMode:true})}if(action==='diesel'||action==='expense')recalcTripCosts(state,t);if(clientActionId)state.driverActions.unshift({clientActionId,tripId:t.id,driverId:did,action,at:now});state.driverActions=state.driverActions.slice(0,1000);return{duplicate:false,action,tripId:t.id,number:t.number,status:t.status,stage:t.stage,pod:Boolean(t.pod),driverComplete:Boolean(t.driverComplete)}});if(action==='problem'&&!changed.result.duplicate)createNotification({type:'driver-problem',severity:'warning',title:'Driver reported a trip problem',message:(req.user.name||'Driver')+' reported '+String(data.type||'a problem')+' on trip '+req.params.tripId+'.',role:'dispatcher',linkedType:'trip',linkedId:req.params.tripId}).catch(()=>{});res.status(changed.result.duplicate?200:201).json({...changed.result,revision:changed.revision})}catch(e){res.status(e.status||500).json({error:e.message})}});

app.get('/api/events',auth,(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();res.write('event: ready\ndata: {}\n\n');clients.add(res);req.on('close',()=>clients.delete(res))});

function driverMobileTrip(state,driverId){
  const rows=(state.trips||[]).filter(t=>t.driverId===driverId&&!t.driverComplete&&!['Closed','Invoiced'].includes(t.status));
  const priority=t=>{const x=String(t.status||'').toLowerCase();if(/loading|to loading|loaded|departure pending|in transit|at offloading|awaiting pod|return journey/.test(x))return 500;if(/planned|assigned|booked|at loading/.test(x))return 400;if(/delivered/.test(x)&&!t.pod)return 250;if(/delivered/.test(x)&&!t.driverComplete)return 200;return 100};
  rows.sort((a,b)=>priority(b)-priority(a)||(new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0))||String(b.number||'').localeCompare(String(a.number||''),undefined,{numeric:true}));
  return rows[0]||null
}
app.post('/api/mobile/register',auth,async(req,res)=>{
  try{
    const deviceId=String(req.body.deviceId||'').trim().slice(0,160);if(!deviceId)return res.status(400).json({error:'deviceId is required'});
    const token=crypto.randomBytes(32).toString('base64url'),hash=deviceTokenHash(token),name=String(req.body.name||'Android Driver').slice(0,120),platform=String(req.body.platform||'android').slice(0,40),id=crypto.randomUUID();
    if(pool){
      await q('INSERT INTO mobile_devices(id,device_id,user_id,driver_id,token_hash,name,platform,active,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,true,now()) ON CONFLICT(device_id) DO UPDATE SET user_id=excluded.user_id,driver_id=excluded.driver_id,token_hash=excluded.token_hash,name=excluded.name,platform=excluded.platform,active=true,last_seen=now()',[id,deviceId,req.user.sub,req.user.driverId||null,hash,name,platform])
    }else{
      let d=memory.mobileDevices.find(x=>x.deviceId===deviceId);
      if(d)Object.assign(d,{userId:req.user.sub,driverId:req.user.driverId||null,tokenHash:hash,name,platform,active:true,lastSeen:new Date().toISOString()});
      else memory.mobileDevices.push({id,deviceId,userId:req.user.sub,driverId:req.user.driverId||null,tokenHash:hash,name,platform,active:true,lastSeen:new Date().toISOString()})
    }
    res.status(201).json({deviceToken:token,driverId:req.user.driverId||null,role:req.user.role,serverTime:new Date().toISOString()})
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
    const testMode=req.body.testMode===true||String(req.body.testMode||'').toLowerCase()==='true';
    if(testMode){
      const label=String(req.body.testLabel||req.user.name||req.device.name||'Phone test').trim().slice(0,80).replace(/[^a-zA-Z0-9 ._-]/g,'')||'Phone test';
      req.body={...req.body,vehicleId:'phone-test:'+label,driverId:req.user.driverId||null,tripId:null};
      return gpsIn(req,res,'phone-test')
    }
    if(req.user.role!=='driver'||!req.user.driverId)return res.status(403).json({error:'GPS upload is only available to linked driver accounts unless Phone GPS Test is enabled'});
    const state=await readOpsState(),t=driverMobileTrip(state,req.user.driverId);
    if(!t)return res.status(204).end();
    req.body={...req.body,vehicleId:t.truckId,driverId:req.user.driverId,tripId:t.id};
    return gpsIn(req,res,'android-background')
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/mobile/alerts',deviceAuth,async(req,res)=>{
  const afterRaw=String(req.query.after||''),after=Number.isFinite(Date.parse(afterRaw))?new Date(afterRaw).toISOString():new Date(Date.now()-5*60*1000).toISOString();
  if(pool){
    const rows=await q(`SELECT id,type,severity,title,message,role,user_id AS "userId",driver_id AS "driverId",linked_type AS "linkedType",linked_id AS "linkedId",created_at AS "createdAt" FROM notifications WHERE created_at>$1 AND (user_id=$2 OR (user_id IS NULL AND driver_id IS NOT NULL AND driver_id=$3) OR (user_id IS NULL AND driver_id IS NULL AND role=$4) OR (user_id IS NULL AND driver_id IS NULL AND role IS NULL)) ORDER BY created_at ASC LIMIT 50`,[after,req.user.sub,req.user.driverId||'',req.user.role]);
    return res.json({alerts:rows,serverTime:new Date().toISOString()})
  }
  const rows=memory.notifications.filter(n=>new Date(n.created_at||n.createdAt)>new Date(after)&&(n.user_id?String(n.user_id)===String(req.user.sub):n.driver_id?String(n.driver_id)===String(req.user.driverId||''):n.role?String(n.role)===String(req.user.role):true)).sort((a,b)=>new Date(a.created_at||a.createdAt)-new Date(b.created_at||b.createdAt)).slice(0,50);
  res.json({alerts:rows,serverTime:new Date().toISOString()})
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
async function gpsIn(req,res,source){const p={vehicleId:String(req.body.vehicleId||req.body.vehicle_id||''),driverId:req.body.driverId||req.user.driverId||null,tripId:req.body.tripId||null,latitude:Number(req.body.latitude),longitude:Number(req.body.longitude),speed:num(req.body.speed),heading:num(req.body.heading),accuracy:req.body.accuracy==null?null:num(req.body.accuracy),source,recordedAt:req.body.recordedAt||new Date().toISOString()};if(!p.vehicleId||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))return res.status(400).json({error:'vehicleId, latitude and longitude are required'});if(pool)await q('INSERT INTO gps_positions(vehicle_id,driver_id,trip_id,latitude,longitude,speed,heading,accuracy,source,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.vehicleId,p.driverId,p.tripId,p.latitude,p.longitude,p.speed,p.heading,p.accuracy,p.source,p.recordedAt]);else memory.gps.push(p);await evaluateGeofences(p);if(source!=='phone-test')await evaluateTripZones(p);emit('gps',p);res.status(201).json(p)}
app.post('/api/admin/slips/post',auth,roles('admin','manager','dispatcher','workshop','finance'),upload.fields([{name:'receipt',maxCount:1},{name:'receipts',maxCount:20}]),async(req,res)=>{
  let receipt=null;
  try{
    const slipFiles=[...((req.files&&req.files.receipts)||[]),...((req.files&&req.files.receipt)||[])];
    if(!slipFiles.length)return res.status(400).json({error:'Slip or receipt image is required'});
    const body=req.body||{},category=String(body.category||'Other').slice(0,80),tripId=String(body.tripId||''),requestedTruck=String(body.truckId||''),snapshot=await readOpsState();
    const trip=tripId?(snapshot.trips||[]).find(x=>x.id===tripId):null;
    if(tripId&&!trip)return res.status(400).json({error:'Selected trip was not found'});
    const truckId=trip?.truckId||requestedTruck,driverId=trip?.driverId||String(body.driverId||''),date=receiptDateISO(body.date);if(!date)return res.status(400).json({error:'Receipt date could not be read. Confirm the slip date before posting.'});
    const directApproval=['admin','manager','finance'].includes(req.user.role);
    if(category==='Diesel'){
      const litres=num(body.litres),total=num(body.amount||body.total),enteredPrice=num(body.price);
      if(litres<=0)return res.status(400).json({error:'Enter diesel litres'});
      if(total<=0&&enteredPrice<=0)return res.status(400).json({error:'Enter receipt total or price per litre'});
      if(!truckId||!(snapshot.trucks||[]).some(x=>x.id===truckId))return res.status(400).json({error:'Select the truck that received the fuel'});
      const id='fuel_'+crypto.randomUUID();receipt=await storeCompanyReceiptFiles(slipFiles,req.user,'fuel',id,'ai-slip');
      const price=enteredPrice||(total/litres),printedTotal=total||(litres*price);
      const changed=await mutateOpsState(state=>{
        state.diesel??=[];
        const rec={id,scope:trip?'trip':'company',companyPaid:true,tripId:trip?.id||'',legId:trip?activeTripLegServer((state.trips||[]).find(x=>x.id===trip.id))?.id||'':'',date,truckId,driverId,litres,price:Number(price.toFixed(4)),total:Number(printedTotal.toFixed(2)),printedTotal:Number(printedTotal.toFixed(2)),odometer:num(body.odometer),supplier:String(body.supplier||'').slice(0,160),slip:String(body.receiptNo||body.slip||'').slice(0,120),paymentMethod:String(body.paymentMethod||'Company card').slice(0,80),receiptUploadId:receipt.id,receiptUploadIds:[receipt.id],receiptCount:slipFiles.length,receiptPageCount:slipFiles.length,receiptSource:'company-ai',verified:directApproval,status:directApproval?'Verified':'Review',detectedCategory:category,categoryConfidence:num(body.categoryConfidence),fuelTransactions:body.fuelTransactions?JSON.parse(String(body.fuelTransactions||'[]')):[],fuelTransactionCount:num(body.fuelTransactionCount)||1,recordedBy:req.user.sub,recordedAt:new Date().toISOString(),aiSlip:true};
        state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel');if(trip){const t=(state.trips||[]).find(x=>x.id===trip.id);if(t)recalcTripCosts(state,t)}
        state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'AI slip confirmed → Diesel Control · '+rec.litres+' L · N$'+rec.printedTotal.toFixed(2),linkedType:trip?'trip':'truck',linkedId:trip?.id||truckId});state.audit=state.audit.slice(0,100);
        return rec
      });
      return res.status(201).json({destination:'diesel',record:changed.result,receipt,revision:changed.revision})
    }
    const amount=num(body.amount);if(amount<=0)return res.status(400).json({error:'Enter the expense amount'});
    const id='expense_'+crypto.randomUUID();receipt=await storeCompanyReceiptFiles(slipFiles,req.user,'expense',id,'ai-slip');
    const changed=await mutateOpsState(state=>{
      const status=directApproval?'Approved':'Review';
      const rec=buildCompanyExpense(state,{sourceType:'ai-slip',sourceId:id,title:'AI scanned slip',body:{...body,date,tripId:trip?.id||'',truckId,driverId,amount,category},receiptId:receipt.id,status,linkedType:trip?'trip':(truckId?'truck':''),linkedId:trip?.id||truckId||''});
      rec.aiSlip=true;rec.receiptPageCount=slipFiles.length;rec.detectedCategory=String(body.detectedCategory||category);rec.categoryConfidence=num(body.categoryConfidence);rec.registration=String(body.registration||'').slice(0,40);
      if(category==='Mass distance charge (MDC)')rec.mdc=true;
      if(category==='Police / traffic fine')rec.reimbursable=false;
      rememberSupplierCategory(state,rec.supplier,category);
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'AI slip confirmed → '+category+' · N$'+amount.toFixed(2)+(trip?' · '+trip.number:' · company expense'),linkedType:trip?'trip':'expense',linkedId:trip?.id||rec.id});state.audit=state.audit.slice(0,100);
      return rec
    });
    res.status(201).json({destination:'expense',record:changed.result,receipt,revision:changed.revision})
  }catch(err){res.status(err.status||500).json({error:err.message})}
});
app.post('/api/admin/fuel',auth,roles('admin','manager','dispatcher','workshop','finance'),upload.single('receipt'),async(req,res)=>{
  try{
    const litres=num(req.body.litres),total=num(req.body.total),enteredPrice=num(req.body.price),tripId=String(req.body.tripId||''),requestedTruck=String(req.body.truckId||'');
    if(litres<=0)return res.status(400).json({error:'Enter diesel litres'});
    if(total<=0&&enteredPrice<=0)return res.status(400).json({error:'Enter receipt total or price per litre'});
    if(!req.file)return res.status(400).json({error:'Fuel slip or receipt is required'});
    const snapshot=await readOpsState(),trip=tripId?(snapshot.trips||[]).find(x=>x.id===tripId):null,truckId=trip?.truckId||requestedTruck,driverId=trip?.driverId||String(req.body.driverId||'');
    if(!truckId||!(snapshot.trucks||[]).some(x=>x.id===truckId))return res.status(400).json({error:'Select the truck that received the fuel'});
    if(tripId&&!trip)return res.status(400).json({error:'Selected trip was not found'});
    const id='fuel_'+crypto.randomUUID(),receipt=await storeCompanyReceipt(req.file,req.user,'fuel',id,'fuel-slip'),price=enteredPrice||(total/litres),printedTotal=total||(litres*price),verified=['admin','manager','finance'].includes(req.user.role);
    const changed=await mutateOpsState(state=>{
      state.diesel??=[];const rec={id,scope:trip?'trip':'company',companyPaid:true,tripId:trip?.id||'',legId:'',date:String(req.body.date||new Date().toISOString().slice(0,10)).slice(0,10),truckId,driverId,litres,price:Number(price.toFixed(4)),total:Number(printedTotal.toFixed(2)),printedTotal:Number(printedTotal.toFixed(2)),odometer:num(req.body.odometer),supplier:String(req.body.supplier||''),slip:String(req.body.slip||''),paymentMethod:String(req.body.paymentMethod||'Company card'),receiptUploadId:receipt.id,receiptUploadIds:[receipt.id],receiptCount:1,receiptSource:'company',verified,status:verified?'Verified':'Review',recordedBy:req.user.sub,recordedAt:new Date().toISOString()};
      state.diesel.unshift(rec);rememberSupplierCategory(state,rec.supplier,'Diesel');if(trip){const t=(state.trips||[]).find(x=>x.id===trip.id);if(t)recalcTripCosts(state,t)}
      state.audit??=[];state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:req.user.name||req.user.email||req.user.role,action:'Recorded '+(trip?'trip':'company fleet')+' fuel '+rec.litres+' L · '+rec.truckId+' · '+rec.total.toFixed(2),linkedType:trip?'trip':'truck',linkedId:trip?.id||truckId});state.audit=state.audit.slice(0,100);
      return rec
    });
    if(!verified)createNotification({type:'fuel-review',severity:'info',title:'Fuel slip awaiting review',message:req.user.name+' recorded '+litres+' L company fuel.',role:'finance',linkedType:'fuel',linkedId:id}).catch(()=>{});
    res.status(201).json({record:changed.result,receipt,revision:changed.revision})
  }catch(err){res.status(err.status||500).json({error:err.message})}
});
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
app.post('/api/gps/test',auth,async(req,res)=>{
  try{
    const label=String(req.body.testLabel||req.user.name||'Phone GPS Test').trim().slice(0,80).replace(/[^a-zA-Z0-9 ._-]/g,'')||'Phone GPS Test';
    req.body={...req.body,vehicleId:'phone-test:'+label,driverId:req.user.driverId||null,tripId:null};
    return gpsIn(req,res,'phone-test')
  }catch(e){res.status(500).json({error:e.message})}
});
app.get('/api/gps/latest',auth,async(req,res)=>{const rows=pool?await q("SELECT DISTINCT ON(vehicle_id) vehicle_id AS \"vehicleId\",driver_id AS \"driverId\",trip_id AS \"tripId\",latitude,longitude,speed,heading,accuracy,source,recorded_at AS \"recordedAt\" FROM gps_positions WHERE source IN ('telematics','truck-device','tracker','vehicle-tracker','phone-test') ORDER BY vehicle_id,recorded_at DESC"):Object.values(memory.gps.filter(x=>trustedVehicleGpsSource(x.source)).reduce((a,x)=>(a[x.vehicleId]=x,a),{}));res.json(rows)});
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
app.get('/api/notifications',auth,async(req,res)=>res.json(pool?await q(`SELECT id,type,severity,title,message,role,user_id AS "userId",driver_id AS "driverId",linked_type AS "linkedType",linked_id AS "linkedId",read,created_at AS "createdAt" FROM notifications WHERE user_id=$1 OR (user_id IS NULL AND driver_id IS NOT NULL AND driver_id=$2) OR (user_id IS NULL AND driver_id IS NULL AND role=$3) OR (user_id IS NULL AND driver_id IS NULL AND role IS NULL) ORDER BY created_at DESC LIMIT 100`,[req.user.sub,req.user.driverId||'',req.user.role]):memory.notifications.filter(x=>x.user_id?x.user_id===req.user.sub:x.driver_id?x.driver_id===req.user.driverId:x.role?x.role===req.user.role:true).slice(0,100)));
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
app.get('/api/config',auth,(req,res)=>res.json({vapidPublicKey:process.env.VAPID_PUBLIC_KEY||null,mapStyle:process.env.MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/liberty',providers:{whatsapp:Boolean(process.env.META_WHATSAPP_TOKEN),email:Boolean(process.env.RESEND_API_KEY),push:Boolean(process.env.VAPID_PUBLIC_KEY),telematics:Boolean(process.env.TELEMATICS_WEBHOOK_TOKEN||process.env.TRACCAR_FORWARD_TOKEN),maps:'OpenFreeMap'},receiptAI:{enabled:Boolean(OPENAI_API_KEY),primaryModel:RECEIPT_AI_PRIMARY_MODEL,escalationModel:RECEIPT_AI_ESCALATION_MODEL,solThreshold:RECEIPT_AI_SOL_THRESHOLD}}));
app.post('/api/export/:kind',auth,async(req,res)=>{const title=String(req.body.title||req.params.kind).slice(0,80),columns=Array.isArray(req.body.columns)?req.body.columns:[],rows=Array.isArray(req.body.rows)?req.body.rows:[];if(!columns.length)return res.status(400).json({error:'Export columns required'});const book=new ExcelJS.Workbook();book.creator='Angermund Transport';book.created=new Date();const cover=book.addWorksheet('Angermund Transport');cover.getColumn(1).width=44;cover.getColumn(2).width=25;cover.getRow(1).height=100;const brandImage=book.addImage({buffer:fs.readFileSync(path.join(root,'angermund-logo.png')),extension:'png'});cover.addImage(brandImage,{tl:{col:0,row:0},ext:{width:340,height:120}});cover.getCell('A6').value='ANGERMUND TRANSPORT CC';cover.getCell('A6').font={name:'Aptos Display',size:18,bold:true,color:{argb:'FF101E80'}};cover.getCell('A8').value=title;cover.getCell('A8').font={name:'Aptos',size:14,bold:true};cover.getCell('A9').value=`Exported ${new Date().toLocaleString('en-NA',{timeZone:'Africa/Windhoek'})}`;cover.getCell('A10').value=`${rows.length} record(s)`;const sheet=book.addWorksheet(title.slice(0,31)||'Export',{views:[{state:'frozen',ySplit:4}]});sheet.properties.defaultRowHeight=20;sheet.mergeCells(1,1,1,columns.length);const heading=sheet.getCell(1,1);heading.value=`Angermund Transport CC — ${title}`;heading.font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};heading.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0B2035'}};heading.alignment={vertical:'middle'};sheet.getRow(1).height=30;sheet.mergeCells(2,1,2,columns.length);sheet.getCell(2,1).value=`Exported ${new Date().toLocaleString('en-NA',{timeZone:'Africa/Windhoek'})}`;sheet.getCell(2,1).font={name:'Aptos',size:10,italic:true,color:{argb:'FF5E7184'}};sheet.getRow(4).values=columns.map(c=>c.label);sheet.getRow(4).eachCell(c=>{c.font={name:'Aptos',bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1769AA'}};c.alignment={vertical:'middle',horizontal:'center'}});for(const source of rows){const values=columns.map(c=>source[c.key]??'');const row=sheet.addRow(values);row.eachCell((cell,index)=>{cell.font={name:'Aptos',size:10};cell.alignment={vertical:'middle',wrapText:false};const col=columns[index-1];if(col.type==='currency')cell.numFmt='N$ #,##0.00';else if(col.type==='number')cell.numFmt='#,##0.00';else if(col.type==='date'&&cell.value)cell.numFmt='yyyy-mm-dd'})}columns.forEach((c,i)=>{let width=Math.max(12,c.label.length+2);for(const row of rows.slice(0,200))width=Math.max(width,String(row[c.key]??'').length+2);sheet.getColumn(i+1).width=Math.min(42,width)});sheet.autoFilter={from:{row:4,column:1},to:{row:Math.max(4,rows.length+4),column:columns.length}};sheet.getRow(rows.length+5).getCell(1).value=`${rows.length} record(s)`;sheet.getRow(rows.length+5).getCell(1).font={italic:true,color:{argb:'FF5E7184'}};const buffer=await book.xlsx.writeBuffer();res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${req.params.kind}-${new Date().toISOString().slice(0,10)}.xlsx"`});res.send(Buffer.from(buffer))});
app.post('/api/documents/scan',auth,upload.single('document'),async(req,res)=>{if(!req.file)return res.status(400).json({error:'Document image required'});const id=crypto.randomUUID(),row={id,user_id:req.user.sub,filename:req.file.originalname,status:'processing'};if(pool)await q('INSERT INTO scan_jobs(id,user_id,filename,status) VALUES($1,$2,$3,$4)',[id,row.user_id,row.filename,row.status]);else memory.scanJobs.push({...row,rawText:null,extracted:null,confidence:null,error:null,createdAt:new Date().toISOString(),completedAt:null});res.status(202).json({id,status:'processing'});(async()=>{try{const state=await readOpsState().catch(()=>({})),result=await analyzeReceiptHybrid(req.file.buffer,req.file.mimetype,state),{extracted,raw,confidence}=result;if(pool)await q('UPDATE scan_jobs SET status=$2,raw_text=$3,extracted=$4,confidence=$5,completed_at=now() WHERE id=$1',[id,'review',raw,extracted,confidence]);else{const m=memory.scanJobs.find(x=>x.id===id);if(m)Object.assign(m,{status:'review',rawText:raw,extracted,confidence,completedAt:new Date().toISOString()})}emit('scan',{id,status:'review',extracted,confidence,ocrMode:result.ai.used?'ocr+ai':'ocr',ai:result.ai})}catch(e){if(pool)await q('UPDATE scan_jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[id,'failed',e.message]);else{const m=memory.scanJobs.find(x=>x.id===id);if(m)Object.assign(m,{status:'failed',error:e.message,completedAt:new Date().toISOString()})}emit('scan',{id,status:'failed',error:e.message})}})()});
app.get('/api/documents/scans/:id',auth,async(req,res)=>{const row=pool?(await q('SELECT id,filename,status,raw_text AS "rawText",extracted,confidence,error,created_at AS "createdAt",completed_at AS "completedAt" FROM scan_jobs WHERE id=$1',[req.params.id]))[0]:memory.scanJobs.find(x=>x.id===req.params.id);if(!row)return res.status(404).json({error:'Scan not found'});res.json(row)});
app.post('/api/notifications/test',auth,roles('admin','manager'),async(req,res)=>res.status(201).json(await createNotification({type:'test',severity:'info',title:'Angermund Transport test alert',message:'Notification providers are connected and working.'})));

async function ensureOperationalAlerts(){
  try{
    const today=new Date(Date.now()+2*60*60*1000).toISOString().slice(0,10),snapshot=await readOpsState(),alerts=[];
    const changed=await mutateOpsState(state=>{
      state.tasks??=[];state.permits??=[];state.maintenance??=[];state.invoices??=[];
      for(const t of state.tasks){
        if(!t||['Completed','Cancelled'].includes(t.status)||!t.due)continue;
        if(t.due<today&&t.overdueAlertDate!==today){t.overdueAlertDate=today;alerts.push({task:t,title:'Overdue task: '+t.title,message:'This task was due '+t.due+'.',severity:'warning'})}
        else if(t.due===today&&t.dueAlertDate!==today){t.dueAlertDate=today;alerts.push({task:t,title:'Task due today: '+t.title,message:t.description||'Please complete this task today.',severity:t.priority==='Critical'?'critical':t.priority==='High'?'warning':'info'})}
      }
      for(const p of state.permits){
        if(!p?.expiry)continue;const days=Math.ceil((new Date(p.expiry+'T23:59:59+02:00')-new Date())/86400000);
        if(days<=30&&p.expiryAlertDate!==today){p.expiryAlertDate=today;alerts.push({admin:true,title:(days<0?'Expired: ':'Document expiring: ')+p.type,message:(p.reference||p.type)+' '+(days<0?'expired '+Math.abs(days)+' day(s) ago':'expires in '+days+' day(s)'),severity:days<0?'critical':'warning',linkedType:'permit',linkedId:p.id})}
      }
      for(const m of state.maintenance){
        if(String(m.status||'').toLowerCase()==='completed')continue;const tr=(state.trucks||[]).find(x=>x.id===m.truckId),remaining=num(m.nextService)-num(tr?.odometer);
        if(num(m.nextService)>0&&remaining<=5000&&m.serviceAlertDate!==today){m.serviceAlertDate=today;alerts.push({role:'workshop',title:'Vehicle service due: '+(tr?.registration||'Vehicle'),message:m.type+' · '+(remaining<=0?'service is due/overdue':remaining.toLocaleString()+' km remaining'),severity:remaining<=0?'critical':'warning',linkedType:'maintenance',linkedId:m.id})}
      }
      for(const i of state.invoices){
        if(!i?.due||['Paid'].includes(i.status))continue;
        if(i.due<today&&i.overdueAlertDate!==today){i.overdueAlertDate=today;alerts.push({role:'finance',title:'Invoice overdue: '+i.number,message:'Invoice '+i.number+' was due '+i.due+'.',severity:'warning',linkedType:'invoice',linkedId:i.id})}
      }
      return{count:alerts.length}
    });
    for(const a of alerts){
      if(a.task)await notifyTask(a.task,a.title,a.message,a.severity);
      else await createNotification({type:'operational-alert',severity:a.severity,title:a.title,message:a.message,role:a.admin?'admin':a.role||'admin',linkedType:a.linkedType,linkedId:a.linkedId})
    }
    return changed.result
  }catch(e){console.error('Operational alert sweep failed',e.message)}
}

async function applyPayeThresholdMigration(){
  const version='2026-09-30-paye-threshold-8000-v1';
  const changed=await mutateOpsState(state=>{
    if(state.payeThresholdMigrationVersion===version)return{skipped:true};
    let updated=0;
    for(const row of state.payroll||[]){
      if(['Approved','Paid'].includes(row.status))continue;
      const employee=workforceEmployee(state,row.employeeId);if(!employee)continue;
      const next=calculatePayrollRecord(state,employee,row.period,row);
      Object.assign(row,next);updated++
    }
    state.payeThresholdMigrationVersion=version;
    state.audit??=[];
    state.audit.unshift({id:'log_'+crypto.randomUUID(),at:new Date().toISOString(),actor:'System',action:'PAYE threshold applied at N$8,000 taxable gross · '+updated+' draft payslip(s) refreshed',linkedType:'payroll',linkedId:version});
    state.audit=state.audit.slice(0,100);
    return{skipped:false,updated}
  });
  return changed.result
}
async function ensureMonthEndPayroll(){
  try{
    const na=new Date(Date.now()+2*60*60*1000),y=na.getUTCFullYear(),m=na.getUTCMonth(),day=na.getUTCDate(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
    let period=null;if(day===last)period=y+'-'+String(m+1).padStart(2,'0');else if(day<=3){const p=new Date(Date.UTC(y,m-1,1));period=p.getUTCFullYear()+'-'+String(p.getUTCMonth()+1).padStart(2,'0')}
    if(!period)return;
    const snapshot=await readOpsState(),employees=workforceEmployees(snapshot),rows=snapshot.payroll||[];
    const missing=employees.some(e=>payrollProfile(snapshot,e.id).autoGenerate!==false&&!rows.some(x=>x.period===period&&x.employeeId===e.id));
    if(!missing)return;
    await mutateOpsState(state=>generatePayrollPeriod(state,period,true))
  }catch(e){console.error('Month-end payroll check failed',e.message)}
}
app.get('/download/android',async(req,res)=>{
  const url='https://github.com/zjondreangermund/Angermund-Transport/releases/download/android-latest/Angermund-Transport.apk';
  try{
    const upstream=await fetch(url,{redirect:'follow'});
    if(!upstream.ok||!upstream.body)throw new Error('APK upstream '+upstream.status);
    res.status(200);
    res.setHeader('Content-Type','application/vnd.android.package-archive');
    res.setHeader('Content-Disposition','attachment; filename="Angermund-Transport.apk"');
    res.setHeader('Cache-Control','no-store');
    const {Readable}=require('stream');
    Readable.fromWeb(upstream.body).pipe(res)
  }catch(e){
    console.error('APK proxy failed',e.message);
    res.redirect(302,url)
  }
});
app.get('/login',(req,res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');res.sendFile(path.join(root,'index.html'))});app.use(express.static(root,{maxAge:'1h',setHeaders:(res,file)=>{if(file.endsWith('.html')||file.endsWith('/app.js')||file.endsWith('/styles.css')||file.endsWith('/sw.js'))res.setHeader('Cache-Control','no-store, no-cache, must-revalidate')}}));app.use((req,res)=>res.sendFile(path.join(root,'index.html')));
initDb().then(async()=>{if(process.argv.includes('--init-only'))return pool?.end();const fleet=await ensureCanonicalFleet();if(!fleet?.skipped)console.log('Canonical fleet applied',fleet);const insuranceImport=await applyInsuranceWorkbookImport();if(!insuranceImport?.skipped)console.log('Insurance workbook import applied',insuranceImport);const imported=await applyWorkforceEnvImport();if(!imported?.skipped)console.log('Workforce import applied',imported);const linked=await reconcileWorkforceUserLinks();if(linked.linkedDrivers||linked.linkedStaff)console.log('Workforce user links reconciled',linked);const tripImport=await applyTripWorkbookTestImport();if(!tripImport?.skipped)console.log('Trip workbook test import applied',tripImport.actual);else console.log('Trip workbook test import already applied',tripImport.actual||'');const carrierImport=await applyNblCarrierLoadImport();if(!carrierImport?.skipped)console.log('NBL carrier loads imported',carrierImport);const payeMigration=await applyPayeThresholdMigration();if(!payeMigration?.skipped)console.log('PAYE threshold migration applied',payeMigration);app.listen(PORT,()=>console.log(`Angermund Transport V3 running on port ${PORT}`));setTimeout(ensureMonthEndPayroll,15000);setInterval(ensureMonthEndPayroll,6*60*60*1000);setTimeout(ensureOperationalAlerts,20000);setInterval(ensureOperationalAlerts,10*60*1000)}).catch(e=>{console.error('Startup failed',e);process.exit(1)});
