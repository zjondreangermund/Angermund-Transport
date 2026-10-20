const test=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../public/quote-costing');
const inputs={kml:2,margin:18,dieselNA:28.75,dieselForeign:26.76,driverRate:.5,mdcRate:73.3,maintenanceRate:2.5,tyreRate:1.5,insuranceRate:1,ownershipRate:3,days:2,foodRate:200,rounding:1000,vatRate:15};
const leg={actualKm:1400,namibiaKm:1400,tenderKm:1400,amount:41000};
test('PDF reference costing and corrected margin division',()=>{
 const x=calculate([leg],inputs);
 assert.equal(x.litres,700);assert.equal(x.totalCost,33451.2);
 assert.equal(x.unrounded.toFixed(2),'40794.15');
 assert.equal(x.recommended,41000);assert.equal(x.profit.toFixed(2),'7548.80');
 assert.equal(x.total,47150);
});
test('tender kilometres never multiply the actual journey distance',()=>{
 const a=calculate([{...leg,tenderKm:700}],inputs);
 const b=calculate([{...leg,tenderKm:1400}],inputs);
 assert.equal(a.totalCost,b.totalCost);
});
test('empty return adds costs but zero income',()=>{
 const x=calculate([{...leg,actualKm:700,namibiaKm:700,amount:41000},{...leg,actualKm:700,namibiaKm:700,amount:99999,empty:true}],inputs);
 assert.equal(x.totalCost,33451.2);assert.equal(x.quotedIncome,41000);
});
test('MDC uses only Namibian kilometres and fuel uses country prices',()=>{
 const x=calculate([{...leg,actualKm:1000,namibiaKm:200}],inputs);
 assert.equal(x.rows[2].amount,146.6);
 assert.equal(x.rows[0].amount,100*28.75+400*26.76);
});
test('zero margin, zero VAT, minimum charge and no rounding remain valid',()=>{
 const x=calculate([leg],{...inputs,margin:0,vatRate:0,minimum:40000,rounding:0});
 assert.equal(x.recommended,40000);assert.equal(x.total,41000);
});
test('reject invalid consumption, negative costs, margin and country distances',()=>{
 for(const bad of [{kml:0},{margin:100},{margin:-1},{driverRate:-1},{dieselNA:NaN}])assert.throws(()=>calculate([leg],{...inputs,...bad}));
 assert.throws(()=>calculate([{...leg,namibiaKm:1401}],inputs));
 assert.throws(()=>calculate([],inputs));
});
