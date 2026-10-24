'use strict';
(function(){
  const bridge=()=>window.angermundAssistantBridge;
  const host=document.createElement('div');host.id='angermundAssistantRoot';host.className='angermund-assistant-root';host.hidden=true;
  host.innerHTML='<button type="button" class="assistant-launch" aria-label="Ask Angermund assistant" title="Ask Angermund assistant">✦ <span>Ask Angermund</span></button>'+
    '<section class="assistant-panel" role="dialog" aria-label="Angermund assistant" aria-modal="false" hidden>'+
    '<div class="assistant-head"><div><b>✦ Angermund Assistant</b><small>Trips, purchases, diesel, documents & finance</small></div><button type="button" class="assistant-close" aria-label="Close assistant">×</button></div>'+
    '<div class="assistant-log" aria-live="polite"></div><div class="assistant-suggestions">'+
    '<button type="button" data-example="Where do I see my monthly income?">Monthly income</button>'+
    '<button type="button" data-example="Where do I see unpaid invoices?">Unpaid invoices</button>'+
 '<button type="button" data-example="Which trucks are available?">Available trucks</button>'+
 '<button type="button" data-example="Show overdue tasks">Overdue tasks</button>'+
    '<button type="button" data-example="How do I create a new trip?">Create trip</button>'+
 '<button type="button" data-example="Add loan to Josef for N$2000 monthly deduction N$200">Employee loan</button>'+
 '<button type="button" data-example="Create task to check ANG 12 tomorrow, high priority">Create task</button>'+
 '<button type="button" data-example="What can you do?">All actions</button>'+
 '<button type="button" data-example="Record parts expense N$1200 for truck ANG 12 on 2026-10-24">Parts purchase</button>'+
 '<button type="button" data-example="Create invoice for trip AT-101 leg 1">Invoice</button>'+
 '<button type="button" data-example="Attach POD to trip AT-101">Attach POD</button></div>'+
    '<form class="assistant-form"><textarea class="assistant-text" rows="2" maxlength="4000" aria-label="Ask a question" placeholder="Tell me what to do…" required></textarea><button type="submit" aria-label="Send question">➤</button></form>'+
    '<div class="assistant-attachment"><label>Attach slip / POD <input class="assistant-file" type="file" multiple accept="image/*,application/pdf" aria-label="Attach slips or PODs"></label><button type="button" class="assistant-clear-file" hidden>Remove file</button><small class="assistant-file-name"></small></div>'+
    '<div class="assistant-tools"><button type="button" class="assistant-mic" aria-label="Dictate instruction" aria-pressed="false">🎤 Speak</button><button type="button" class="assistant-record-audio">Record audio</button><button type="button" class="assistant-brief">Needs attention</button><button type="button" class="assistant-history">Changes</button><button type="button" class="assistant-clear-chat">Clear chat</button></div><small class="assistant-voice-status" role="status">Voice uses browser or server transcription. Check dictated text before sending.</small>'+
    '<small class="assistant-foot">Create, edit or delete supported records. Review each change before saving. Ask “What can you do?” for the current list.</small></section>';
  document.body.appendChild(host);
  const launch=host.querySelector('.assistant-launch'),panel=host.querySelector('.assistant-panel'),
    log=host.querySelector('.assistant-log'),input=host.querySelector('.assistant-text'),form=host.querySelector('form');
  const fileInput=host.querySelector('.assistant-file'),clearFile=host.querySelector('.assistant-clear-file'),fileName=host.querySelector('.assistant-file-name');
  function clearAttachment(){fileInput.value='';fileName.textContent='';clearFile.hidden=true}
  fileInput.onchange=()=>{fileName.textContent=Array.from(fileInput.files||[]).map((f,i)=>(i+1)+': '+f.name).join(' · ');clearFile.hidden=!fileInput.files?.length};clearFile.onclick=clearAttachment;
  const turns=[];let busy=false,loadedUser='',loadingSession=false;
  const voiceStatus=host.querySelector('.assistant-voice-status');
  const voice=window.AngermundVoice?.install({button:host.querySelector('.assistant-mic'),input,status:text=>{voiceStatus.textContent=text},postAudio:async(blob,name)=>{
    const body=new FormData();body.append('audio',blob,name);const response=await fetch('/api/assistant/voice',{method:'POST',headers:{Authorization:'Bearer '+String(localStorage.getItem('angermund_token')||'')},body});const x=await response.json();if(!response.ok)throw Error(x.error||'Transcription failed');return x.text;
  }});
  window.angermundVoiceStop=()=>{voice?.stop();window.speechSynthesis?.cancel()};
  host.querySelector('.assistant-record-audio').onclick=()=>voice?.record();
  host.querySelector('.assistant-brief').onclick=()=>ask('What needs attention?');
  host.querySelector('.assistant-history').onclick=()=>ask('Action history');
  host.querySelector('.assistant-clear-chat').onclick=async()=>{try{const r=await fetch('/api/assistant/session',{method:'DELETE',headers:{Authorization:'Bearer '+String(localStorage.getItem('angermund_token')||'')}});if(!r.ok)throw Error('Could not clear conversation');log.replaceChildren();turns.length=0;voiceStatus.textContent='Conversation cleared. Saved records stay unchanged.';}catch(e){voiceStatus.textContent=e.message}};
  async function loadSession(){
    const sessionKey=String(localStorage.getItem('angermund_token')||'');if(!sessionKey||loadingSession||loadedUser===sessionKey)return;
    loadingSession=true;const beforeTurns=turns.length;try{const r=await fetch('/api/assistant/session',{headers:{Authorization:'Bearer '+sessionKey}});if(!r.ok)return;const x=await r.json();if(sessionKey!==String(localStorage.getItem('angermund_token')||''))return;if(turns.length!==beforeTurns||log.querySelector('.assistant-approval-card')){loadedUser=sessionKey;return}log.replaceChildren();turns.length=0;for(const t of x.turns||[]){bubble(t.role,t.content);turns.push(t)}loadedUser=sessionKey;const n=x.briefing?.count||0;launch.title=n?n+' items need attention':'Ask Angermund assistant';const label=launch.querySelector('span');if(label)label.textContent='Ask Angermund'+(n?' · '+n+' to check':'');if(n&&!log.children.length)bubble('assistant',x.briefing.answer,'command');}catch{}finally{loadingSession=false;}
  }

  function refresh(){
    const ready=Boolean(bridge()?.context?.());
    const account=String(localStorage.getItem('angermund_token')||'');if(loadedUser&&loadedUser!==account){voice?.stop();window.speechSynthesis?.cancel();loadedUser='';log.replaceChildren();turns.length=0;}
    host.hidden=!ready;if(!ready){panel.hidden=true;voice?.stop();loadedUser='';log.replaceChildren();turns.length=0}else loadSession();
    const financial=bridge()?.context?.()?.pages?.some(x=>x.id==='monthlyPnl');
    const monthly=host.querySelector('[data-example="Where do I see my monthly income?"]');
    if(monthly)monthly.hidden=!financial;
    const loans=host.querySelector('[data-example^="Add loan to"]');
    if(loans)loans.hidden=!bridge()?.context?.()?.pages?.some(x=>x.id==='loans');
    const assign=host.querySelector('[data-example^="Assign driver"]');
    if(assign)assign.hidden=!bridge()?.context?.()?.pages?.some(x=>x.id==='dispatch');
  }
  window.angermundAssistantRefresh=refresh;
  function toggle(open){
    if(!open)voice?.stop();
    panel.hidden=!open;launch.setAttribute('aria-expanded',String(open));
    if(open){
      if(!log.children.length)bubble('assistant','Tell me what to do: record a purchase, capture diesel, attach a POD, prepare an invoice or quotation, edit or delete a record. Include exact truck/trip references. I will ask for missing details and show a preview before saving.');
      setTimeout(()=>input.focus(),75);
    }
  }
  launch.onclick=()=>toggle(panel.hidden);
  host.querySelector('.assistant-close').onclick=()=>toggle(false);
  host.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>ask(b.dataset.example));
  function bubble(who,message,pageId,action,proposal){
    const row=document.createElement('div');row.className='assistant-row assistant-row-'+who;
    const msg=document.createElement('p');msg.textContent=message;row.appendChild(msg);
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
    bubble('user',text);input.value='';busy=true;
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
      bubble('assistant',reply,result.page,result.action,result.proposal||null);
      turns.push({role:'user',content:text},{role:'assistant',content:reply});
      if(result.proposal)clearAttachment();
    }catch(e){
      const local=window.AngermundSiteAssistant?.answer(text,ctx)||{};
      bubble('assistant',e.message||local.answer||'I could not reach the assistant. Check your connection and try again.',local.page,local.action);
    }finally{busy=false;form.querySelector('button').disabled=false;input.focus()}
  }
  form.onsubmit=e=>{e.preventDefault();ask(input.value)};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)toggle(false)});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){voice?.stop();window.speechSynthesis?.cancel()}});
  setInterval(()=>{if(!document.hidden&&bridge()?.context?.()){loadedUser='';loadSession()}},5*60*1000);
  refresh();
})();
