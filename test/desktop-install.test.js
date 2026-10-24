'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('desktop manifest is standalone with an existing 512px Windows icon',()=>{
 const m=JSON.parse(read('public/manifest.json'));
 assert.equal(m.display,'standalone');assert.equal(m.id,'/');
 assert.ok(m.icons.some(x=>x.src==='/angermund-icon.png'&&x.sizes==='512x512'&&x.type==='image/png'));
 for(const icon of m.icons)assert.ok(fs.existsSync(path.join(root,'public',icon.src.replace(/^\//,'').split('?')[0])));
});
test('install button dispatches desktop users to PWA installer instead of Android APK',()=>{
 const app=read('public/app.js');
 assert.match(app,/AngermundDesktop\?\.supported\?\.\(\)/);
 assert.match(app,/return window\.AngermundDesktop\.install\(\)/);
 assert.match(app,/globalFullscreenBtn/);
});
test('install UI is loaded before the app and avoids Android install prompts on laptops',()=>{
 const html=read('public/index.html');
 assert.ok(html.indexOf('desktop-install.js')>0);
 assert.ok(html.indexOf('desktop-install.js')<html.indexOf('app.js?v='));
 assert.match(html,/globalFullscreenBtn/);
 const script=read('public/desktop-install.js');
 assert.match(script,/beforeinstallprompt/);
 assert.match(script,/requestFullscreen/);
 assert.match(script,/Install this site as an app/);
});
