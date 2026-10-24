'use strict';
/**
 * Browser and server-compatible release checks. Never announce a new APK
 * until the canonical android-latest release has both an asset and the
 * version metadata written AFTER a successful APK upload.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AngermundAndroidUpdate=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function versionParts(s){
    if(typeof s!=='string'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(s))return null;
    return s.split('.').map(Number);
  }
  function compareVersions(installed,latest){
    const a=versionParts(installed),b=versionParts(latest);
    if(!a||!b)return 0;
    for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;
    return 0;
  }
  function releaseDetails(release){
    if(!release||release.draft||release.prerelease||release.tag_name!=='android-latest')return null;
    const body=String(release.body||'');
    const version=/^ANGERMUND_VERSION_NAME=(\d{1,4}\.\d{1,4}\.\d{1,4})$/m.exec(body)?.[1];
    const code=Number(/^ANGERMUND_VERSION_CODE=(\d+)$/m.exec(body)?.[1]);
    const asset=Array.isArray(release.assets)?release.assets.find(x=>x?.name==='Angermund-Transport.apk'&&Number(x.size)>0&&(!x.state||x.state==='uploaded')):null;
    if(!version||!versionParts(version)||!Number.isSafeInteger(code)||code<1||!asset)return null;
    // Return only server-chosen same-origin URL, never arbitrary release links.
    return {available:true,version,versionCode:code,
      downloadUrl:'/download/android',publishedAt:asset.updated_at||release.published_at||null};
  }
  return {versionParts,compareVersions,releaseDetails};
});
