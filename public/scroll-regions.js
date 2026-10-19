(function(root){
'use strict';
function wheelRegion(el,e){
 const x=Math.max(0,el.scrollWidth-el.clientWidth),y=Math.max(0,el.scrollHeight-el.clientHeight);
 if(!x&&!y)return false;
 const factor=e.deltaMode===1?20:e.deltaMode===2?el.clientHeight:1;
 const horizontal=x>0&&(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)||!y);
 if(horizontal)el.scrollLeft=Math.max(0,Math.min(x,el.scrollLeft+(e.deltaX||e.deltaY)*factor));
 else el.scrollTop=Math.max(0,Math.min(y,el.scrollTop+e.deltaY*factor));
 e.preventDefault();return true;
}
function wire(){
 if(typeof document==='undefined')return;
 document.querySelectorAll('.payroll-secondary>.panel').forEach(panel=>{if(panel.dataset.scrollWired)return;panel.dataset.scrollWired='1';panel.addEventListener('wheel',e=>{if(e.target.closest('.table-wrap'))return;const table=panel.querySelector('.table-wrap');if(table&&wheelRegion(table,e))e.stopPropagation()},{passive:false})});
 document.querySelectorAll('.table-wrap').forEach(el=>{
  if(el.dataset.scrollWired)return;el.dataset.scrollWired='1';el.tabIndex=0;
  el.addEventListener('wheel',e=>{if(wheelRegion(el,e))e.stopPropagation()},{passive:false});
  const tools=document.createElement('div');tools.className='table-scroll-tools';
  const left=document.createElement('button'),right=document.createElement('button'),label=document.createElement('span');
  for(const b of [left,right]){b.type='button';b.className='ghost small'}left.textContent='←';right.textContent='→';label.textContent='Scroll sideways';left.setAttribute('aria-label','Scroll table left');right.setAttribute('aria-label','Scroll table right');
  tools.append(left,label,right);el.before(tools);left.onclick=()=>el.scrollBy({left:-Math.max(160,el.clientWidth*.7),behavior:'smooth'});right.onclick=()=>el.scrollBy({left:Math.max(160,el.clientWidth*.7),behavior:'smooth'});
  const update=()=>{const max=el.scrollWidth-el.clientWidth;tools.hidden=max<=1;left.disabled=el.scrollLeft<=1;right.disabled=el.scrollLeft>=max-1};el.addEventListener('scroll',update,{passive:true});
  if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(!el.isConnected){observer.disconnect();return}update()});observer.observe(el);if(el.firstElementChild)observer.observe(el.firstElementChild)}update();
 });
}
function init(){
 if(typeof document==='undefined')return;
 document.addEventListener('pointerdown',e=>{const panel=e.target.closest('.panel');document.querySelectorAll('.active-scroll-panel').forEach(p=>{if(p!==panel)p.classList.remove('active-scroll-panel')});if(panel)panel.classList.add('active-scroll-panel')});
 const modal=document.getElementById('modal');if(modal&&typeof MutationObserver!=='undefined'){const sync=()=>{document.body.classList.toggle('modal-open',!modal.classList.contains('hidden'));document.documentElement.classList.toggle('modal-open',!modal.classList.contains('hidden'));wire()};new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class']});sync()}
}
if(typeof module==='object'&&module.exports)module.exports={wheelRegion};else{root.wireScrollRegions=wire;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()}
})(typeof globalThis!=='undefined'?globalThis:this);
