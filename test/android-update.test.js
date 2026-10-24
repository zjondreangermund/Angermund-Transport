'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareVersions,releaseDetails}=require('../public/android-update');
const release={
  tag_name:'android-latest',draft:false,prerelease:false,
  body:'Latest Angermund Transport Android build.\nANGERMUND_VERSION_NAME=1.4.4\nANGERMUND_VERSION_CODE=21',
  assets:[{name:'Angermund-Transport.apk',size:2417918,state:'uploaded',updated_at:'2026-10-24T06:00:00Z'}]
};
test('only newer major/minor/patch versions prompt an upgrade',()=>{
 assert.equal(compareVersions('1.4.3','1.4.4'),-1);
 assert.equal(compareVersions('1.5.0','1.4.99'),1);
 assert.equal(compareVersions('1.4.4','1.4.4'),0);
 assert.equal(compareVersions('invalid','1.4.4'),0);
});
test('only published release with APK and completed metadata announces update',()=>{
 assert.deepEqual(releaseDetails(release),{available:true,version:'1.4.4',versionCode:21,downloadUrl:'/download/android',publishedAt:'2026-10-24T06:00:00Z'});
 assert.equal(releaseDetails({...release,body:'Latest app available'}),null);
 assert.equal(releaseDetails({...release,assets:[]}),null);
 assert.equal(releaseDetails({...release,draft:true}),null);
 assert.equal(releaseDetails({...release,tag_name:'unknown'}),null);
});
