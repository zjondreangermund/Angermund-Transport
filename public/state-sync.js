(function(root){
  'use strict';
  const missing=Symbol('missing'),equal=(a,b)=>a===b||(a!==missing&&b!==missing&&JSON.stringify(a)===JSON.stringify(b));
  function mergeStateChanges(base,local,remote,path='state'){
    if(equal(local,base))return remote;
    if(equal(remote,base)||equal(local,remote))return local;
    const object=x=>x!==missing&&x!==null&&typeof x==='object'&&!Array.isArray(x);
    if(object(base)&&object(local)&&object(remote)){
      const result={};
      for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
        const read=x=>Object.hasOwn(x,key)?x[key]:missing;
        const value=mergeStateChanges(read(base),read(local),read(remote),path+'.'+key);
        if(value!==missing)result[key]=value;
      }
      return result;
    }
    const keyed=x=>Array.isArray(x)&&x.every(row=>object(row)&&typeof row.id==='string')&&new Set(x.map(row=>row.id)).size===x.length;
    if(keyed(base)&&keyed(local)&&keyed(remote)){
      const maps=[base,local,remote].map(rows=>new Map(rows.map(row=>[row.id,row]))),result=[];
      for(const id of new Set([...remote.map(row=>row.id),...local.map(row=>row.id),...base.map(row=>row.id)])){
        const value=mergeStateChanges(...maps.map(map=>map.has(id)?map.get(id):missing),path+'['+id+']');
        if(value!==missing)result.push(value);
      }
      return path==='state.audit'?result.sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,100):result;
    }
    throw Error('Conflicting changes to '+path+'. Your edits are retained; resolve the conflict before saving.');
  }
  if(typeof module!=='undefined')module.exports={mergeStateChanges};else root.mergeStateChanges=mergeStateChanges;
})(typeof globalThis==='undefined'?this:globalThis);
