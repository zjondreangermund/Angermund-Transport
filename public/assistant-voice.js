'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AngermundVoice=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function install({button,input,status,env=globalThis,token=()=>'',postAudio}){
  let recognition=null,recorder=null,stream=null,timer=null,disposed=false,starting=false,generation=0;
  const stopTracks=()=>{stream?.getTracks?.().forEach(t=>t.stop());stream=null};
  const reset=()=>{if(timer)env.clearTimeout(timer);timer=null;button.textContent='🎤 Speak';button.setAttribute('aria-pressed','false');};
  const append=text=>{if(disposed||!text)return;input.value=(input.value?input.value.trim()+' ':'')+String(text).trim();input.focus();status('Voice captured. Check the text, then press Send.');};
  async function record(){
   if(disposed||starting||recognition||recorder){status('Stop the current dictation before starting another recording.');return;}
   if(!env.navigator?.mediaDevices?.getUserMedia||!env.MediaRecorder){status('Voice recording is unavailable here. Use your keyboard microphone or type.');return;}
   starting=true;const version=++generation;status('Allow microphone access to dictate your instruction.');
   try{
    const acquired=await env.navigator.mediaDevices.getUserMedia({audio:true});if(disposed||version!==generation){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;
    const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>env.MediaRecorder.isTypeSupported?.(t));recorder=new env.MediaRecorder(stream,type?{mimeType:type}:undefined);const chunks=[];let size=0,oversize=false;
    recorder.ondataavailable=e=>{if(e.data?.size){size+=e.data.size;chunks.push(e.data);if(size>12*1024*1024){oversize=true;stop();}}};
    recorder.onerror=()=>{status('Recording failed. Retry or type your instruction.');stopTracks();reset();recorder=null;};
    recorder.onstop=async()=>{const mime=recorder?.mimeType||type||'audio/webm';recorder=null;stopTracks();reset();if(disposed||oversize){if(oversize)status('Recording too large. Try a shorter instruction.');return;}if(!size){status('No audio captured. Please retry.');return;}
     try{status('Transcribing…');const blob=new env.Blob(chunks,{type:mime}),ext=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';const text=await postAudio(blob,'instruction.'+ext);append(text);}catch(e){status(e.message||'Transcription failed. Try keyboard dictation or type.');}
    };
    recorder.start(500);button.textContent='⏹ Stop';button.setAttribute('aria-pressed','true');status('Listening… tap Stop when finished. Maximum one minute.');timer=env.setTimeout(stop,60000);
   }catch(e){stopTracks();reset();status(e.name==='NotAllowedError'?'Microphone permission denied. Enable it in site settings or use keyboard dictation.':'Cannot access the microphone. Try keyboard dictation or type.');}finally{if(version===generation)starting=false;}
  }
  function stop(){if(starting){generation++;starting=false;}if(recognition){const r=recognition;recognition=null;r.stop();}if(recorder&&recorder.state!=='inactive')recorder.stop();reset();}
  function listen(){
   const Speech=env.SpeechRecognition||env.webkitSpeechRecognition;if(!Speech){record();return;}
   try{
    recognition=new Speech();const r=recognition;r.lang='en-ZA';r.continuous=false;r.interimResults=false;button.textContent='⏹ Stop';button.setAttribute('aria-pressed','true');status('Listening… speak your instruction.');
    r.onresult=e=>{const parts=[];for(let i=e.resultIndex||0;i<e.results.length;i++)if(e.results[i].isFinal!==false)parts.push(e.results[i][0].transcript);append(parts.join(' '));};
    r.onerror=e=>{recognition=null;reset();if(['network','service-not-allowed','language-not-supported'].includes(e.error)){status('Browser dictation is unavailable. Tap Record audio to use server transcription.');}else status(e.error==='not-allowed'?'Microphone access denied. Check site permissions or use keyboard dictation.':'No clear speech captured. Retry or type.');};
    r.onend=()=>{recognition=null;reset()};r.start();timer=env.setTimeout(stop,60000);
   }catch{recognition=null;reset();record();}
  }
  button.onclick=()=>{if(disposed||starting)return;if(recognition||recorder){stop();return;}listen();};
  return{stop,record,dispose(){disposed=true;generation++;recognition?.abort?.();stop();stopTracks();}};
 }
 return{install};
});
