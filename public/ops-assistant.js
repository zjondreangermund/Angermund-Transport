'use strict';
(function(){
  const bridge=()=>window.angermundAssistantBridge;
  const host=document.createElement('div');host.id='angermundAssistantRoot';host.className='angermund-assistant-root';host.hidden=true;
  host.innerHTML='<button type="button" class="assistant-launch" aria-label="Ask Angermund assistant" title="Ask Angermund assistant">✦ <span>Ask Angermund</span></button>'+
    '<section class="assistant-panel" role="dialog" aria-label="Angermund assistant" aria-modal="false" hidden>'+
    '<header class="assistant-head"><div><b>✦ Angermund Assistant</b><small>Find pages, understand figures, prepare tasks</small></div><button type="button" class="assistant-close" aria-label="Close assistant">×</button></header>'+
    '<div class="assistant-log" aria-live="polite"></div><div class="assistant-suggestions">'+
    '<button type="button" data-example="Where do I see my monthly income?">Monthly income</button>'+
    '<button type="button" data-example="Where do I see unpaid invoices?">Unpaid invoices</button>'+
    '<button type="button" data-example="How do I create a new trip?">Create trip</button>'+
 '<button type="button" data-example="Add loan to Josef for N$2000 monthly deduction N$200">Employee loan</button>'+
 '<button type="button" data-example="Create task to check ANG 12 tomorrow, high priority">Create task</button>'+
 '<button type="button" data-example="Assign driver Josef to trip AT-101">Assign driver</button></div>'+
    '<form class="assistant-form"><input type="text" maxlength="1200" aria-label="Ask a question" placeholder="Ask anything about this site…" autocomplete="off" required><button type="submit" aria-label="Send question">➤</button></form>'+
    '<small class="assistant-foot">Ask for loans, tasks, truck/driver assignments, trip changes or expenses. Every change requires approval.</small></section>';
  document.body.appendChild(host);
  const launch=host.querySelector('.assistant-launch'),panel=host.querySelector('.assistant-panel'),
    log=host.querySelector('.assistant-log'),input=host.querySelector('input'),form=host.querySelector('form');
  const turns=[];let busy=false;
  function refresh(){
    const ready=Boolean(bridge()?.context?.());
    host.hidden=!ready;if(!ready)panel.hidden=true;
    const financial=bridge()?.context?.()?.pages?.some(x=>x.id==='monthlyPnl');
    const monthly=host.querySelector('[data-example="Where do I see my monthly income?"]');
    if(monthly)monthly.hidden=!financial;
  }
  window.angermundAssistantRefresh=refresh;
  function toggle(open){
    panel.hidden=!open;launch.setAttribute('aria-expanded',String(open));
    if(open){
      if(!log.children.length)bubble('assistant','Hi! I know the pages available to your account. Ask me where to find information, or how to start a task.');
      setTimeout(()=>input.focus(),75);
    }
  }
  launch.onclick=()=>toggle(panel.hidden);
  host.querySelector('.assistant-close').onclick=()=>toggle(false);
  host.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>ask(b.dataset.example));
  function bubble(who,message,pageId,action,proposal){
    const row=document.createElement('div');row.className='assistant-row assistant-row-'+who;
    const msg=document.createElement('p');msg.textContent=message;row.appendChild(msg);
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
          const result=await post('/api/assistant/approve/'+encodeURIComponent(proposal.id),{confirm:true});
          yes.textContent='✓ Saved';actions.remove();
          const saved=document.createElement('p');saved.textContent=result.message||'Approved and saved.';box.appendChild(saved);
          try{await bridge()?.reload?.()}catch{}
          const open=document.createElement('button');open.type='button';open.className='assistant-go';open.textContent='View saved record →';
          open.onclick=()=>{
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
        try{await post('/api/assistant/cancel/'+encodeURIComponent(proposal.id),{})}
        catch(e){const err=document.createElement('p');err.textContent=e.message;box.appendChild(err)}
        actions.remove();const msg=document.createElement('p');msg.textContent='Draft cancelled. No changes were saved.';box.appendChild(msg);
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
      const response=await fetch('/api/assistant/ask',{method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+String(localStorage.getItem('angermund_token')||'')},
        body:JSON.stringify({message:text,context:ctx,history})});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Unable to answer');
      const reply=String(result.answer||'No answer available.');
      bubble('assistant',reply,result.page,result.action,result.proposal||null);
      turns.push({role:'user',content:text},{role:'assistant',content:reply});
      if(!result.aiEnabled&&result.source==='site-guide')host.querySelector('.assistant-foot').textContent='Site guide mode · enable server AI for deeper questions. No tasks are submitted automatically.';
    }catch(e){
      const local=window.AngermundSiteAssistant?.answer(text,ctx)||{};
      bubble('assistant',local.answer||'I could not reach the assistant. Check your connection and try again.',local.page,local.action);
    }finally{busy=false;form.querySelector('button').disabled=false;input.focus()}
  }
  form.onsubmit=e=>{e.preventDefault();ask(input.value)};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)toggle(false)});
  refresh();
})();
