'use strict';
function isLatestTrip(q){return /\b(last|latest|most recent)\b/i.test(q)&&/\b(trip|trips|load|loads)\b/i.test(q);}
function normalizeTruck(q){const m=/^\s*(?:truck\s+)?ANG[\s-]*0?(\d{1,2})[.! ]*$/i.exec(String(q||''));return m?'ANG '+Number(m[1]):null;}
function recentUser(turns){const items=Array.isArray(turns)?turns:[];for(let i=items.length-1;i>=0;i--)if(items[i]?.role==='user')return String(items[i].content||'');return '';}
function resolve(q,session,history){const truck=normalizeTruck(q);if(!truck)return q;
 const previous=recentUser(session?.turns)||recentUser(history);
 return isLatestTrip(previous)?'Investigate '+truck+' latest trip, including diesel, POD, invoice and driver payroll. What needs attention?':q;
}
module.exports={resolve,isLatestTrip,normalizeTruck};
