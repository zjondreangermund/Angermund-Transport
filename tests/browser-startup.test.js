const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('all navigation views initialize and login handlers are reachable',()=>{
  const elements=new Map(),storage=new Map(),listeners=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){},toggle(){}},style:{},dataset:{},remove(){}});return elements.get(id)},addEventListener(){}};
  const context={document,window:{addEventListener(name,fn){listeners.set(name,fn)}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},navigator:{},location:{pathname:'/',search:''},URLSearchParams,structuredClone,console,setTimeout(){}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/state-sync.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
  assert.equal(typeof elements.get('loginForm').onsubmit,'function');
  assert.equal(typeof listeners.get('load'),'function');
  const missing=vm.runInContext('navGroups.flatMap(group=>group[1]).map(item=>item[0]).filter(page=>typeof views[page]!=="function")',context);
  assert.equal(missing.length,0,'Every menu target must have a view: '+missing.join(', '));
});
