'use strict';
// A running native app does not prove that the SAME physical device owns each
// browser push subscription. The user's other phone can be a separate device.
// Preserve existing suppression for regular notifications to prevent changing
// current duplicate behavior; always fan out user-specific GPS test milestones.
function shouldSendWebPush(notification,subscription){
  if(!subscription?.nativeActive)return true;
  return notification?.type==='gps-test-journey';
}
function pushOptions(notification){
  // GPS milestones are time-sensitive. Android may still defer delivery if
  // power-saving settings restrict its browser or app.
  return notification?.type==='gps-test-journey'?{urgency:'high',TTL:3600}:undefined;
}
module.exports={shouldSendWebPush,pushOptions};
