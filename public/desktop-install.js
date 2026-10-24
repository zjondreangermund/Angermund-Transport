'use strict';
(function(){
  // APKs are Android-only. On Windows/macOS/Linux the existing secure
  // website can be installed as a desktop PWA from Chrome/Edge.
  let pendingInstall=null;
  const isAndroid=()=>/Android/i.test(navigator.userAgent||'');
  const isIos=()=>/iPad|iPhone|iPod/i.test(navigator.userAgent||'');
  const supportedDesktop=()=>!isAndroid()&&!isIos();
  const installed=()=>window.matchMedia('(display-mode: standalone)').matches
    ||window.matchMedia('(display-mode: fullscreen)').matches
    ||window.matchMedia('(display-mode: window-controls-overlay)').matches;
  const modal=document.createElement('div');
  modal.id='desktopInstallPrompt';
  modal.className='desktop-install-modal hidden';
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-labelledby','desktopInstallTitle');
  modal.innerHTML='<section class="desktop-install-card">'+
    '<div class="desktop-install-icon"><img src="/angermund-app-logo-hq.webp?v=38" alt=""></div>'+
    '<button class="desktop-install-close" type="button" id="closeDesktopInstall" aria-label="Close install instructions">×</button>'+
    '<h2 id="desktopInstallTitle">Angermund Transport for laptop</h2>'+
    '<p>Install our existing operations website as a <b>Windows desktop app</b>. It opens in its own window, uses your whole screen and updates automatically with Railway.</p>'+
    '<div class="desktop-install-steps" id="desktopInstallSteps"></div>'+
    '<div class="desktop-install-actions">'+
      '<button type="button" class="primary" id="desktopInstallNow">⬇ Install desktop app</button>'+
      '<button type="button" class="ghost" id="desktopFullscreenNow">⛶ Fullscreen now</button>'+
      '<button type="button" class="ghost" id="desktopInstallDone">Close</button>'+
    '</div><small>Desktop installation does not use an APK. Chrome or Microsoft Edge is required. No separate login or new account.</small>'+
    '</section>';
  document.body.appendChild(modal);
  const $=id=>document.getElementById(id);
  const updateCopy=()=>{
    const steps=$('desktopInstallSteps'),button=$('desktopInstallNow');
    const edge=/Edg\//.test(navigator.userAgent);
    const chrome=/Chrome\//.test(navigator.userAgent)&&!edge;
    if(installed()){
      steps.textContent='This laptop app is installed. Click Fullscreen now, or press F11 in your browser. Press Esc or F11 to exit fullscreen.';
      button.textContent='✓ Already installed';button.disabled=true;
    }else if(pendingInstall){
      steps.textContent='Click Install desktop app. Accept the browser confirmation. Your desktop app will appear in the Windows Start menu, and you can pin it to the taskbar.';
      button.textContent='⬇ Install desktop app';button.disabled=false;
    }else{
      steps.textContent=edge?
        'In Microsoft Edge: open the ⋯ menu → Apps → Install this site as an app. Name it Angermund Transport and click Install.':
        chrome?'In Google Chrome: open ⋮ → Cast, save and share → Install page as app (or click the install icon in the address bar).':
        'Open this website in Microsoft Edge or Google Chrome. From the browser menu, choose Install this site as an app. Then pin it to your taskbar.';
      button.textContent='Show installation steps';button.disabled=false;
    }
  };
  const open=()=>{if(!supportedDesktop())return false;updateCopy();modal.classList.remove('hidden');$('desktopInstallNow').focus();return true};
  const close=()=>modal.classList.add('hidden');
  async function install(){
    if(installed()){close();return}
    if(pendingInstall){
      const event=pendingInstall;pendingInstall=null;
      try{await event.prompt();await event.userChoice}catch(e){console.warn('Desktop app install prompt unavailable',e)}
      updateCopy();return;
    }
    updateCopy();
    // A browser installation menu is the only fallback if no event fires.
    $('desktopInstallSteps').focus();
  }
  async function fullscreen(){
    close();
    try{
      if(!document.fullscreenElement){
        await document.documentElement.requestFullscreen({navigationUI:'hide'});
      }else await document.exitFullscreen();
    }catch(e){
      alert('Fullscreen permission was not granted. Press F11 on your Windows laptop, or maximize your installed app window.');
    }
  }
  $('closeDesktopInstall').onclick=close;
  $('desktopInstallDone').onclick=close;
  $('desktopInstallNow').onclick=install;
  $('desktopFullscreenNow').onclick=fullscreen;
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.classList.contains('hidden'))close()});
  window.addEventListener('beforeinstallprompt',e=>{if(!supportedDesktop())return;e.preventDefault();pendingInstall=e;updateCopy()});
  window.addEventListener('appinstalled',()=>{pendingInstall=null;updateCopy();close()});
  window.AngermundDesktop={
    supported:supportedDesktop,
    isInstalled:installed,
    install:open,
    fullscreen,
    showInstallTips:open
  };
})();
