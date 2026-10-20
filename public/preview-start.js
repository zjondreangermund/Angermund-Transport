window.ANGERMUND_DESIGN_PREVIEW=true;
try{localStorage.clear();localStorage.setItem('angermund_token','visual-preview-only');sessionStorage.setItem('angermund_android_app_skip','1')}catch{}
sessionStorage.removeItem('nr-theme');
// Do not request phone permissions or register a production-style service worker here.
if('serviceWorker'in navigator)navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});
