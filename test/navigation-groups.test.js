const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const groups=source.slice(source.indexOf('const navGroups='),source.indexOf('const allowed='));
const permissions=source.slice(source.indexOf('const allowed='),source.indexOf('let navigationReady='));
const start=source.indexOf('let expandedNavGroup=');
const render=source.slice(start,source.indexOf('\nfunction ',source.indexOf('function renderNav(){',start)+20));
const expected=['command','dispatch','trips','carrierOrders','shunterRecon','fleet','driverAccounts','clients','diesel','invoices','payroll','loans','imports','tasks','tracking','notifications','driverUploads','roadCharges','driverPortal','inspections','workshop','tyres','documents','insurance','incidents','rates','reports','monthlyPnl','automation','knowledge','settings'];
function setup(role='admin',page='command',desktop=false){
  const context={role,page,clicked:null,window:{matchMedia:()=>({matches:desktop,addEventListener(){}}),addEventListener(){}},document:{documentElement:{style:{setProperty(){}}}}};
  const nav={html:'',pages:[],toggles:[],querySelector(){return null},querySelectorAll(selector){return selector==='button[data-page]'?this.pages:this.toggles}};
  Object.defineProperty(nav,'innerHTML',{get(){return this.html},set(value){
    this.html=value;
    this.pages=[...value.matchAll(/data-page="([^"]+)"/g)].map(m=>({dataset:{page:m[1]}}));
    this.toggles=[...value.matchAll(/data-nav-group="(\d+)"/g)].map(m=>{
      const state={classes:{},classList:{toggle(name,value){state.classes[name]=value}}};
      const items={hidden:false,classList:{toggle(){}}};
      return {dataset:{navGroup:m[1]},classList:{toggle(){}},setAttribute(){},closest(){return {...state,querySelector(){return items}}}};
    });
  }});
  context.$=id=>id==='nav'?nav:{onwheel:null,getBoundingClientRect:()=>({height:92})};
  context.go=id=>{context.clicked=id};
  vm.createContext(context);vm.runInContext(groups+permissions+render,context);
  return {context,nav,draw:()=>context.renderNav(),ids:()=>nav.pages.map(x=>x.dataset.page)};
}
test('all existing page destinations occur once in seven groups',()=>{
 const s=setup();s.draw();
 assert.deepEqual(s.ids().sort(),expected.slice().sort());
 assert.equal(s.nav.toggles.length,7);
 assert.equal((s.nav.html.match(/aria-expanded="true"/g)||[]).length,1);
});
test('invoicing has an explicit main group and Admin has sections',()=>{
 const s=setup('admin','invoices');s.draw();
 assert.match(s.nav.html,/Finance & Invoicing/);
 assert.match(s.nav.html,/People & Customers/);
 assert.match(s.nav.html,/Compliance & Records/);
 assert.match(s.nav.html,/Reports & Accounts/);
 assert.match(s.nav.html,/Tools & Settings/);
 assert.match(s.nav.html,/data-page="invoices" class="active" aria-current="page"/);
});
test('original role permissions still determine every visible destination',()=>{
 for(const role of ['manager','driver','warehouse','workshop','finance','dispatcher','site_worker']){
   const s=setup(role);s.draw();
   const allowed=vm.runInContext('allowed[role].slice().sort()',s.context);
   assert.deepEqual(s.ids().sort(),Array.from(allowed));
 }
});
test('navigation calls the existing go destination',()=>{
 const s=setup();s.draw();
 for(const button of s.nav.pages){button.onclick();assert.equal(s.context.clicked,button.dataset.page)}
});
test('group toggling does not navigate; changing page expands its own group',()=>{
 const s=setup();s.draw();s.nav.toggles[6].onclick();
 assert.equal(s.context.clicked,null);
 s.draw();assert.match(s.nav.html,/data-nav-group="6" aria-expanded="true"/);
 s.context.page='invoices';s.draw();
 assert.match(s.nav.html,/data-nav-group="5" aria-expanded="true"/);
 assert.equal((s.nav.html.match(/aria-expanded="true"/g)||[]).length,1);
});

test('top navigation keeps every destination and role restriction across submenus',()=>{
 for(const role of ['admin','manager','driver','warehouse','workshop','finance','dispatcher','site_worker']){
  const s=setup(role,'command',true),seen=new Set();s.draw();assert.match(s.nav.html,/top-nav-groups/);
  const count=s.nav.toggles.length;
  for(let i=0;i<count;i++){s.nav.toggles[i].onclick();if(!s.ids().length)s.nav.toggles[i].onclick();s.ids().forEach(id=>seen.add(id))}
  const expected=vm.runInContext('role==="admin"?navGroups.flatMap(g=>g[1].map(x=>x[0])):allowed[role]',s.context);
  assert.deepEqual([...seen].sort(),Array.from(expected).sort());
 }
});
test('top groups change submenu without navigating; links keep their destinations',()=>{
 const s=setup('admin','dispatch',true);s.draw();assert.ok(s.ids().includes('dispatch'));s.nav.toggles[5].onclick();assert.equal(s.context.clicked,null);assert.ok(s.ids().includes('invoices'));
 for(const b of s.nav.pages){b.onclick();assert.equal(s.context.clicked,b.dataset.page)}
 s.context.page='documents';s.draw();assert.ok(s.ids().includes('documents'));assert.match(s.nav.html,/aria-current="page"/);
});
