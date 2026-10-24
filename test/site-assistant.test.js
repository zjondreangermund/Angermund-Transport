'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const a=require('../public/site-assistant-core');
const pages=[
{id:'command',label:'Command Centre',description:'Live overview'},
{id:'monthlyPnl',label:'Monthly P&L & Overheads',description:'Month by month truck income and profit'},
{id:'reports',label:'Reports & P&L',description:'All-time performance'},
{id:'invoices',label:'Invoices & Payments',description:'Payments and unpaid invoices'},
{id:'tracking',label:'Live GPS & Geofences',description:'Live truck GPS'},
{id:'dispatch',label:'Dispatch Board',description:'Make trips'},
{id:'trips',label:'Trips & Loads',description:'Trips'}
];
test('exact monthly income navigation uses monthly P&L not generic reports',()=>{
 const r=a.answer('Where do I see my monthly income?',{pages,financials:{period:'2026-10',revenue:12345,tripCosts:4000,overheadTotal:1000,net:7345,source:'live'}});
 assert.equal(r.page,'monthlyPnl');assert.match(r.answer,/N\$ 12,345.00/);assert.match(r.answer,/2026-10/);
});
test('invoices and tracking map to existing app routes',()=>{
 assert.equal(a.answer('Which customers have unpaid invoices?',{pages}).page,'invoices');
 assert.equal(a.answer('Show me truck GPS', {pages}).page,'tracking');
 assert.equal(a.answer('Create a new trip',{pages}).action,'new_trip');
 assert.equal(a.answer('Create a new task',{pages:[...pages,{id:'tasks',label:'Tasks & Approvals',description:'Task management'}]}).action,'new_task');
});
test('role-sensitive absent pages never return forbidden routes or private figures',()=>{
 const limited=[{id:'tracking',label:'Live GPS & Geofences',description:'View GPS'}];
 const r=a.answer('Tell me monthly income',{pages:limited});
 assert.equal(r.page,null);assert.doesNotMatch(r.answer,/N\$/);
});
