'use strict';
(function(){
  const bridge=()=>window.angermundAssistantBridge;
  const host=document.createElement('div');host.id='angermundAssistantRoot';host.className='angermund-assistant-root';host.hidden=true;
  host.innerHTML=`<button type="button" class="assistant-launch" aria-label="Ask Angermund assistant" title="Ask Angermund assistant"><span aria-hidden="true">✦</span></button>
    <section class="assistant-panel" role="dialog" aria-label="Angermund assistant" aria-modal="false" hidden>
      <div class="assistant-head"><div><b>✦ Angermund Assistant</b></div><button type="button" class="assistant-close" aria-label="Close assistant">×</button></div>
      <div class="assistant-log" aria-live="polite"></div>
      <div class="assistant-suggestions" id="assistantExamples" hidden>
        <button type="button" data-example="Where do I see my monthly income?">Monthly income</button>
        <button type="button" data-example="Where do I see unpaid invoices?">Unpaid invoices</button>
        <button type="button" data-example="Which trucks are available?">Available trucks</button>
        <button type="button" data-audit-example data-example="Investigate ANG 10 latest trip">Investigate trip</button>
        <button type="button" data-audit-example data-example="Prepare audit tasks for ANG 10 latest trip">Prepare review tasks</button>
        <button type="button" data-example="Show overdue tasks">Overdue tasks</button>
        <button type="button" data-example="How do I create a new trip?">Create trip</button>
        <button type="button" data-example="Add loan to Josef for N$2000 monthly deduction N$200">Employee loan</button>
        <button type="button" data-example="Create task to check ANG 12 tomorrow, high priority">Create task</button>
        <button type="button" data-example="What can you do?">All actions</button>
        <button type="button" data-example="How can we improve trip profit margins this month?">Improve profit margins</button>
        <button type="button" data-example="Record parts expense N$1200 for truck ANG 12 on 2026-10-24">Parts purchase</button>
        <button type="button" data-example="Create invoice for truck ANG 12">Invoice</button>
        <button type="button" data-example="Attach POD to truck ANG 12">Attach POD</button>
      </div>
      <div class="assistant-tools" id="assistantOptions" hidden>
        <button type="button" class="assistant-examples-toggle" aria-expanded="false" aria-controls="assistantExamples">Examples</button>
        <button type="button" class="assistant-record-audio">Record audio</button>
        <button type="button" class="assistant-brief">Needs attention</button>
        <button type="button" class="assistant-history">Changes</button>
        <button type="button" class="assistant-clear-chat">Clear chat</button>
        <small class="assistant-foot">Review changes before saving. Voice uses browser or server transcription; check the dictated text before sending.</small>
      </div>
      <div class="assistant-composer">
        <input class="assistant-file" type="file" multiple accept="image/*,application/pdf" aria-label="Attach slips or PODs" hidden>
        <div class="assistant-attachment" hidden><small class="assistant-file-name"></small><button type="button" class="assistant-clear-file" aria-label="Remove attachments" hidden>×</button></div>
        <form class="assistant-form"><textarea class="assistant-text" rows="1" maxlength="4000" aria-label="Ask a question" placeholder="Tell me what to do…" required></textarea><button type="submit" aria-label="Send question">➤</button></form>
        <div class="assistant-compose-actions"><button type="button" class="assistant-attach" aria-label="Attach slips or PODs">📎 Attach</button><button type="button" class="assistant-mic" aria-label="Dictate instruction" aria-pressed="false">🎤 Speak</button><button type="button" class="assistant-options-toggle" aria-expanded="false" aria-controls="assistantOptions">⋯ More</button></div>
        <small class="assistant-voice-status" role="status" hidden></small>
      </div>
    </section>`;
  document.body.appendChild(host);
  const launch=host.querySelector('.assistant-launch'),panel=host.querySelector('.assistant-panel'),
    log=host.querySelector('.assistant-log'),input=host.querySelector('.assistant-text'),form=host.querySelector('form');
  const fileInput=host.querySelector('.assistant-file'),clearFile=host.querySelector('.assistant-clear-file'),fileName=host.querySelector('.assistant-file-name');
  const attachment=host.querySelector('.assistant-attachment'),options=host.querySelector('.assistant-tools'),examples=host.querySelector('.assistant-suggestions'),optionsToggle=host.querySelector('.assistant-options-toggle'),examplesToggle=host.querySelector('.assistant-examples-toggle');
  function collapseMenus(){options.hidden=examples.hidden=true;optionsToggle.setAttribute('aria-expanded','false');examplesToggle.setAttribute('aria-expanded','false')}
  optionsToggle.onclick=()=>{const open=options.hidden;collapseMenus();options.hidden=!open;optionsToggle.setAttribute('aria-expanded',String(open));};
  examplesToggle.onclick=()=>{const open=examples.hidden;collapseMenus();examples.hidden=!open;examplesToggle.setAttribute('aria-expanded',String(open));};
  host.querySelector('.assistant-attach').onclick=()=>fileInput.click();
  function clearAttachment(){fileInput.value='';fileName.textContent='';clearFile.hidden=true;attachment.hidden=true}
  fileInput.onchange=()=>{fileName.textContent=Array.from(fileInput.files||[]).map((f,i)=>(i+1)+': '+f.name).join(' · ');clearFile.hidden=!fileInput.files?.length;attachment.hidden=!fileInput.files?.length};clearFile.onclick=clearAttachment;
  const turns=[];let busy=false,loadedUser='',loadingSession=false;
  const voiceStatus=host.querySelector('.assistant-voice-status');
  const voice=window.AngermundVoice?.install({button:host.querySelector('.assistant-mic'),input,status:text=>{voiceStatus.textContent=text;voiceStatus.hidden=!text},postAudio:async(blob,name)=>{
    const body=new FormData();body.append('audio',blob,name);const response=await fetch('/api/assistant/voice',{method:'POST',headers:{Authorization:'Bearer '+String(localStorage.getItem('angermund_token')||'')},body});const x=await response.json();if(!response.ok)throw Error(x.error||'Transcription failed');return x.text;
  }});
  window.angermundVoiceStop=()=>{voice?.stop();window.speechSynthesis?.cancel()};
  host.querySelector('.assistant-record-audio').onclick=()=>{collapseMenus();voice?.record()};
  host.querySelector('.assistant-brief').onclick=()=>ask('What needs attention?');
  host.querySelector('.assistant-history').onclick=()=>ask('Action history');
  host.querySelector('.assistant-clear-chat').onclick=async()=>{try{const r=await fetch('/api/assistant/session',{method:'DELETE',headers:{Authorization:'Bearer '+String(localStorage.getItem('angermund_token')||'')}});if(!r.ok)throw Error('Could not clear conversation');log.replaceChildren();turns.length=0;voiceStatus.textContent='Conversation cleared.';voiceStatus.hidden=false;collapseMenus();}catch(e){voiceStatus.textContent=e.message;voiceStatus.hidden=false}};
  async function loadSession(){
    const sessionKey=String(localStorage.getItem('angermund_token')||'');if(!sessionKey||loadingSession||loadedUser===sessionKey)return;
    loadingSession=true;const beforeTurns=turns.length;try{const r=await fetch('/api/assistant/session',{headers:{Authorization:'Bearer '+sessionKey}});if(!r.ok)return;const x=await r.json();if(sessionKey!==String(localStorage.getItem('angermund_token')||''))return;if(turns.length!==beforeTurns||log.querySelector('.assistant-approval-card')){loadedUser=sessionKey;return}log.replaceChildren();turns.length=0;for(const t of x.turns||[]){bubble(t.role,t.content);turns.push(t)}loadedUser=sessionKey;const n=x.briefing?.count||0;launch.title=n?n+' items need attention':'Ask Angermund assistant';launch.setAttribute('aria-label',n?'Ask Angermund assistant, '+n+' items need attention':'Ask Angermund assistant');if(n&&!log.children.length)bubble('assistant',x.briefing.answer,'command');}catch{}finally{loadingSession=false;}
  }

  function refresh(){
    const ready=Boolean(bridge()?.context?.());
    const account=String(localStorage.getItem('angermund_token')||'');if(loadedUser&&loadedUser!==account){voice?.stop();window.speechSynthesis?.cancel();loadedUser='';log.replaceChildren();turns.length=0;}
    host.hidden=!ready;if(!ready){toggle(false);voice?.stop();loadedUser='';log.replaceChildren();turns.length=0}else loadSession();
    const financial=bridge()?.context?.()?.pages?.some(x=>x.id==='monthlyPnl');
    const monthly=host.querySelector('[data-example="Where do I see my monthly income?"]');
    if(monthly)monthly.hidden=!financial;
    const canAudit=['admin','manager','finance','dispatcher'].includes(bridge()?.context?.()?.role);
    host.querySelectorAll('[data-audit-example]').forEach(b=>b.hidden=!canAudit);
    const loans=host.querySelector('[data-example^="Add loan to"]');
    if(loans)loans.hidden=!bridge()?.context?.()?.pages?.some(x=>x.id==='loans');
    const assign=host.querySelector('[data-example^="Assign driver"]');
    if(assign)assign.hidden=!bridge()?.context?.()?.pages?.some(x=>x.id==='dispatch');
  }
  window.angermundAssistantRefresh=refresh;
  function toggle(open){
    if(!open)voice?.stop();
    panel.hidden=!open;host.classList.toggle('is-open',open);document.documentElement.classList.toggle('assistant-open',open);launch.setAttribute('aria-expanded',String(open));syncViewport();if(!open)collapseMenus();
    if(open){
      if(!log.children.length)bubble('assistant','Tell me what to do: record a purchase, capture diesel, attach a POD, prepare an invoice or quotation, edit or delete a record. Include exact truck/trip references. I will ask for missing details and show a preview before saving.');
      log.scrollTop=log.scrollHeight;
      if(!window.matchMedia('(max-width:760px)').matches)setTimeout(()=>input.focus(),75);
    }
  }
  function syncViewport(){const viewport=window.visualViewport;host.style.setProperty('--assistant-viewport-height',(viewport?.height||window.innerHeight)+'px');host.style.setProperty('--assistant-viewport-top',(viewport?.offsetTop||0)+'px');}
  window.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);
  launch.onclick=()=>toggle(panel.hidden);
  host.querySelector('.assistant-close').onclick=()=>toggle(false);
  host.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>ask(b.dataset.example));

  function formatReply(message){
    // Render text safely: no HTML or AI-generated markup is interpreted.
    const body=document.createElement('div');body.className='assistant-message';
    const lines=String(message||'').split(/\r?\n/);
    let trip=null,metrics=null;
    for(const raw of lines){
      const line=raw.trim();
      if(!line){trip=null;metrics=null;continue}
      if(/^[A-Z][A-Z &/–—-]{3,}$/.test(line)&&line.length<42){
        trip=null;metrics=null;
        const h=document.createElement('h3');h.className='assistant-message-heading';h.textContent=line;
        body.appendChild(h);continue;
      }
      if(/^\d+\.\s+\S+\s+·\s+.*\s+·\s+20\d{2}-\d{2}-\d{2}$/.test(line)){
        trip=document.createElement('div');trip.className='assistant-trip-result';
        const title=document.createElement('strong');title.textContent=line;
        trip.appendChild(title);body.appendChild(trip);metrics=null;continue;
      }
      if(trip&&/^(Income\s+N\$|Contribution\s+N\$|Review:)/i.test(line)){
        const detail=document.createElement('div');detail.className=/^Review:/i.test(line)?'assistant-result-warning':'assistant-result-detail';
        detail.textContent=line;trip.appendChild(detail);continue;
      }
      trip=null;
      if(/^(?:Period|Reviewed|Revenue|Recorded costs|Operating contribution|Weighted margin):\s*/i.test(line)){
        const index=line.indexOf(':'),metric=document.createElement('div');metric.className='assistant-summary-metric';
        const title=document.createElement('span');title.textContent=line.slice(0,index)+':';
        const value=document.createElement('strong');value.textContent=line.slice(index+1).trim();
        metric.append(title,value);body.appendChild(metric);continue;
      }
      const item=document.createElement(/^\d+\.\s/.test(line)?'div':'p');
      item.className=/^\d+\.\s/.test(line)?'assistant-advice-item':/^Review:|^Warning:|^Provisional:/i.test(line)?'assistant-result-warning':'assistant-message-paragraph';
      item.textContent=line;body.appendChild(item);
    }
    return body;
  }

  function bubble(who,message,pageId,action,proposal,records){
    const row=document.createElement('div');row.className='assistant-row assistant-row-'+who;
    row.appendChild(formatReply(message));
    if(who==='assistant'&&window.speechSynthesis){const speak=document.createElement('button');speak.type='button';speak.className='assistant-read';speak.textContent='🔊 Read aloud';speak.onclick=()=>{voice?.stop();speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(String(message).slice(0,2500));utterance.lang='en-ZA';speechSynthesis.speak(utterance)};row.appendChild(speak)}
    if(who==='assistant'&&(pageId||action)){
      const ctx=bridge()?.context?.(),info=(ctx?.pages||[]).find(p=>p.id===pageId);
      if(info&&pageId){
        const btn=document.createElement('button');btn.type='button';btn.className='assistant-go';btn.textContent='Open '+info.label+' →';
        btn.onclick=()=>{if(bridge()?.navigate(pageId))toggle(false)};row.appendChild(btn);
      }
      if(action==='new_trip'||action==='new_task'){
        const b=document.createElement('button');b.type='button';b.className='assistant-go';b.textContent=action==='new_trip'?'Open new trip form →':'Open new task form →';
        b.onclick=()=>{const ok=action==='new_trip'?bridge()?.openNewTrip():bridge()?.openNewTask();if(ok)toggle(false)};row.appendChild(b);
      }
    }
    const recordLinks=document.createElement('div');recordLinks.className='assistant-record-links';
    if(who==='assistant'&&Array.isArray(records))for(const record of records.slice(0,6)){
      const button=document.createElement('button');button.type='button';button.className='assistant-go';button.textContent='Open '+record.label+' ↗';
      button.onclick=async()=>{try{await bridge()?.reload?.();if(record.kind==='trip'&&bridge()?.openTrip?.(record.id))toggle(false);else if(bridge()?.openRecord?.(record.kind,record.id))toggle(false);}catch(e){button.textContent=e.message||'Could not open record'}};recordLinks.appendChild(button);
    }
    if(recordLinks.children.length)row.appendChild(recordLinks);
    if(who==='assistant'&&proposal?.id){
      const box=document.createElement('div');box.className='assistant-approval-card';
      const title=document.createElement('b');title.textContent='Review change — not saved';box.appendChild(title);
      for(const [label,value] of (Array.isArray(proposal.lines)&&proposal.lines.length?proposal.lines:
   [['Trip',proposal.tripNumber],['Change',proposal.description],['Before',proposal.old],['After',proposal.next]])){
        const line=document.createElement('div');line.className='assistant-review-line';
        const k=document.createElement('span');k.textContent=label;
        const v=document.createElement('strong');v.textContent=String(value||'');
        line.append(k,v);box.appendChild(line);
      }
      if(proposal.warning){
        const warning=document.createElement('p');warning.className='assistant-review-warning';
        warning.textContent=proposal.warning;box.appendChild(warning);
      }
      const actions=document.createElement('div');actions.className='assistant-review-actions';
      const yes=document.createElement('button');yes.type='button';yes.className='assistant-approve';yes.textContent='✓ Approve & save';
      const no=document.createElement('button');no.type='button';no.className='assistant-reject';no.textContent='Cancel';
      actions.append(yes,no);box.appendChild(actions);row.appendChild(box);
      const post=async (endpoint,data)=>{
        const token=String(localStorage.getItem('angermund_token')||'');
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(data||{})});
        const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');
        return result;
      };
      yes.onclick=async()=>{
        if(!confirm('Approve and save: '+proposal.description+'?'))return;
        yes.disabled=no.disabled=true;yes.textContent='Saving…';
        try{
          const result=await post(proposal.approveUrl||'/api/assistant/approve/'+encodeURIComponent(proposal.id),{confirm:true});
          yes.textContent='✓ Saved';actions.remove();clearAttachment();
          const saved=document.createElement('p');saved.textContent=result.message||'Approved and saved.';box.appendChild(saved);
          try{await bridge()?.reload?.()}catch{}
          const open=document.createElement('button');open.type='button';open.className='assistant-go';open.textContent=result.change?.deleted?'View records →':'View saved record →';
          open.onclick=()=>{
            if(result.change?.deleted){if(proposal.page&&bridge()?.navigate?.(proposal.page))toggle(false);return}
            if(result.change?.tripId&&bridge()?.openTrip?.(result.change.tripId)){toggle(false);return}
            if(result.change?.entityId&&bridge()?.openRecord?.(result.change.recordType,result.change.entityId)){toggle(false);return}
            if(proposal.page&&bridge()?.navigate?.(proposal.page))toggle(false);
          };
          box.appendChild(open);
        }catch(e){
          yes.disabled=no.disabled=false;yes.textContent='✓ Approve & save';
          const err=document.createElement('p');err.className='assistant-review-warning';err.textContent=e.message+' Ask me again if the trip changed.';box.appendChild(err);
        }
      };
      no.onclick=async()=>{
        yes.disabled=no.disabled=true;
        try{await post(proposal.cancelUrl||'/api/assistant/cancel/'+encodeURIComponent(proposal.id),{})}
        catch(e){const err=document.createElement('p');err.textContent=e.message;box.appendChild(err);yes.disabled=no.disabled=false;return}
        actions.remove();const msg=document.createElement('p');msg.textContent='Draft cancelled. No changes were saved.';box.appendChild(msg);clearAttachment();
      };
    }
    log.appendChild(row);log.scrollTop=log.scrollHeight;
    while(log.children.length>28)log.firstChild.remove();
  }
  async function ask(question){
    const ctx=bridge()?.context?.();if(!ctx||busy)return;
    const text=String(question||'').trim();if(!text)return;
    collapseMenus();bubble('user',text);input.value='';input.style.height='auto';busy=true;
    form.querySelector('button').disabled=true;
    const history=turns.slice(-6);
    try{
      voice?.stop();const files=Array.from(fileInput.files||[]);
      if(files.length>20||files.reduce((n,f)=>n+f.size,0)>60*1024*1024||files.some(f=>f.size>12*1024*1024))throw Error('Choose up to 20 files, each under 12 MB, at most 60 MB in total.');
      let body,headers={'Authorization':'Bearer '+String(localStorage.getItem('angermund_token')||'')};
      if(files.length){body=new FormData();body.append('message',text);body.append('context',JSON.stringify(ctx));body.append('history',JSON.stringify(history));files.forEach(file=>body.append('document',file,file.name))}
      else{headers['Content-Type']='application/json';body=JSON.stringify({message:text,context:ctx,history})}
      const response=await fetch('/api/assistant/ask',{method:'POST',headers,body});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Unable to answer');
      const reply=String(result.answer||'No answer available.');
      bubble('assistant',reply,result.page,result.action,result.proposal||null,result.records);
      turns.push({role:'user',content:text},{role:'assistant',content:reply});
      if(result.proposal)clearAttachment();
    }catch(e){
      const local=window.AngermundSiteAssistant?.answer(text,ctx)||{};
      bubble('assistant',e.message||local.answer||'I could not reach the assistant. Check your connection and try again.',local.page,local.action);
    }finally{busy=false;form.querySelector('button').disabled=false;if(!window.matchMedia('(max-width:760px)').matches)input.focus()}
  }
  input.onfocus=collapseMenus;
  input.oninput=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,100)+'px'};
  form.onsubmit=e=>{e.preventDefault();ask(input.value)};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)toggle(false)});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){voice?.stop();window.speechSynthesis?.cancel()}});
  setInterval(()=>{if(!document.hidden&&bridge()?.context?.()){loadedUser='';loadSession()}},5*60*1000);
  refresh();
})();
