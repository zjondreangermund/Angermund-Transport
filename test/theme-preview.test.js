const test=require('node:test'),assert=require('node:assert/strict');
const {server,sample}=require('../preview-server');
test('visual preview serves only sample state and rejects mutations',async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const r=await fetch(base+'/api/state'),data=await r.json();assert.equal(data.payload.trips.length,4);assert.ok(data.payload.drivers.every(x=>/^Driver [A-D]$/.test(x.name)));assert.ok(data.payload.trucks.every(x=>x.registration.startsWith('N 000')));assert.equal((await fetch(base+'/api/state',{method:'PUT',body:'{}'})).status,403);assert.equal((await fetch(base+'/api/admin/whiteboard/approve',{method:'POST',body:'{}'})).status,403);const html=await(await fetch(base+'/')).text();assert.ok(html.includes('namibian-routes.css'));assert.ok(html.includes('preview-start.js'));assert.equal((await fetch(base+'/sw.js')).status,404);assert.equal((await fetch(base+'/api/session').then(r=>r.json())).user.role,'admin');assert.equal(sample.trips.length,4)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
