(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FleetPhotos=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const fallback='/angermund-truck-cutout.webp';
 function number(vehicle){const label=String(vehicle?.fleetName||vehicle?.name||'');let m=label.match(/\b(?:ang(?:ermund)?|truck)\s*[-#]?\s*(\d+)\b/i);if(!m)m=String(vehicle?.id||'').match(/^trk_ang(\d+)$/i);return m?Number(m[1]):null}
 function source(vehicle){return {2:'/fleet/ang-2-cutout.webp',3:'/fleet/ang-3-cutout.webp',4:'/fleet/ang-4-cutout.webp',5:'/fleet/ang-5-cutout.webp',10:'/fleet/ang-10-cutout.webp',11:'/fleet/ang-11-cutout.webp',12:'/fleet/ang-12-cutout.webp'}[number(vehicle)]||fallback}
 return{number,source,fallback};
});
