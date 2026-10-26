'use strict';
const test=require('node:test'),a=require('node:assert/strict'),S=require('../trip-search'),P=require('../assistant-platform'),{preserveTrips}=require('../preserve-trips');
const state=()=>({trucks:[{id:'tr10',fleetName:'ANG 10',registration:'N123W'},{id:'tr1',fleetName:'ANG 1'}],drivers:[{id:'d',name:'Anton Example'}],routes:[{id:'r',name:'Windhoek to Walvis Bay'}],clients:[{id:'c',name:'Namibian Breweries'}],trips:[{id:'manual',number:'AT-1001',date:'2026-10-21',truckId:'tr10',driverId:'d',routeId:'r',clientId:'c',load:'Charcoal',status:'Closed',stage:6,createdBy:'Admin'},{id:'import',number:'NBL-543',date:'2026-10-25',truckId:'tr10',externalTmsId:'543',load:'Beer',status:'Planned'},{id:'one',number:'AT-1002',date:'2026-10-21',truckId:'tr1',load:'Furniture'}]});
test('natural trip lookup finds manual and historical trips across filters and truck spelling',()=>{
 const s=state();for(const q of ['Find trip ANG10 21 Oct 2026','Where is my trip for ANG-10 on 21/10/2026?','show trips Anton','Find trips Walvis Bay','show my manual trips ANG 10','find charcoal trip'])a.deepEqual(S.find(s,q).map(x=>x.id),['manual'],q);
 a.deepEqual(S.find(s,'find trips ANG 1').map(x=>x.id),['one']);a.deepEqual(S.find(s,'show trips ANG10').map(x=>x.id),['import','manual']);
 a.equal(S.find(s,'show trips ANG10 21 Oct 2025').length,0);a.equal(S.find(s,'show trips 21 Oct').length,2);
});
test('read lookup returns each match with direct record links; does not pick a mutation target',()=>{
 const r=P.read('Can you find my trips for ANG10?',state(),'admin');a.equal(r.records.length,2);a.match(r.answer,/AT-1001/);a.match(r.answer,/NBL-543/);a.equal(r.source,'live-records');
 a.equal(P.read('Delete trip ANG10',state(),'admin'),null);a.equal(P.read('Create invoice for ANG10',state(),'admin'),null);
 a.equal(P.read('Find trips ANG10',state(),'driver').source,'record-permission');
});
test('stale browser saves preserve missing trips and their route/master dependencies',()=>{
 const current=state();current.trips.forEach(t=>t.source='manual');const incoming={trips:[current.trips[1]],routes:[],clients:[],drivers:[],trucks:[],trailers:[]};
 preserveTrips(incoming,current);a.equal(incoming.trips.length,3);a.equal(incoming.routes[0].id,'r');a.equal(incoming.drivers[0].id,'d');preserveTrips(incoming,current);a.equal(incoming.trips.length,3);
 const unchanged={settings:{}};preserveTrips(unchanged,current);a.equal(unchanged.trips,undefined);
});
