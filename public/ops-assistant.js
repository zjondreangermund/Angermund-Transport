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
    '<button type="button" data-example="How do I create a new trip?">Create trip</button></div>'+
    '<form class="assistant-form"><input type="text" maxlength="1200" aria-label="Ask a question" placeholder="Ask anything about this site…" autocomplete="off" required><button type="submit" aria-label="Send question">➤</button></form>'+
    '<small class="assistant-foot">Read-only guidance. All changes still need your confirmation.</small></section>';
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
  function bubble(who,message,pageId,action){
    const row=document.createElement('div');row.className='assistant-row assistant-row-'+who;
    const msg=document.createElement('p');msg.textContent=message;row.appendChild(msg);
    if(who==='assistant'&&(pageId||action)){
      const ctx=bridge()?.context?.(),info=(ctx?.pages||[]).find(p=>p.id===pageId);
      if(info&&pageId){
        const btn=document.createElement('button');btn.type='button';btn.className='assistant-go';btn.textContent='Open '+info.label+' →';
        btn.onclick=()=>{if(bridge()?.navigate(pageId))toggle(false)};row.appendChild(btn);
      }
      if(action==='new_trip'){
        const b=document.createElement('button');b.type='button';b.className='assistant-go';b.textContent='Open new trip form →';
        b.onclick=()=>{if(bridge()?.openNewTrip())toggle(false)};row.appendChild(b);
      }
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
      bubble('assistant',reply,result.page,result.action);
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
