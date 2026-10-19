(function(root){
'use strict';
function matches(filename,trips){
 const stem=String(filename||'').replace(/\.pdf$/i,'').toLowerCase();
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 function contains(ref){const tokens=String(ref||'').toLowerCase().match(/[a-z]+|\d+/g);if(!tokens?.length)return false;return new RegExp('(?:^|[^a-z0-9])'+tokens.map(escape).join('[^a-z0-9]*')+'(?:$|[^a-z0-9])','i').test(stem)}
 return (trips||[]).filter(t=>{const refs=[t.number,t.externalTmsId,t.sourceTmsId];const suffix=String(t.number||'').match(/(\d{5,})$/);if(suffix)refs.push(suffix[1]);return refs.filter(Boolean).some(contains)});
}
const api={matches};if(typeof module==='object'&&module.exports)module.exports=api;else root.PodBatch=api;
})(typeof globalThis!=='undefined'?globalThis:this);
