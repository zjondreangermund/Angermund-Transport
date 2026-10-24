'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {shouldSendWebPush,pushOptions}=require('../push-delivery-policy');
test('GPS journey milestones still push to a second browser device when a native phone is active',()=>{
  assert.equal(shouldSendWebPush({type:'gps-test-journey'},{nativeActive:true}),true);
  assert.deepEqual(pushOptions({type:'gps-test-journey'}),{urgency:'high',TTL:3600});
});
test('keep existing duplicate suppression for regular operational alerts',()=>{
  assert.equal(shouldSendWebPush({type:'trip-geofence'},{nativeActive:true}),false);
  assert.equal(shouldSendWebPush({type:'geofence'},{nativeActive:true}),false);
  assert.equal(pushOptions({type:'trip-geofence'}),undefined);
});
test('subscriptions still receive other notifications when no native session is active',()=>{
  assert.equal(shouldSendWebPush({type:'geofence'},{nativeActive:false}),true);
  assert.equal(shouldSendWebPush({type:'task'},{}),true);
});
