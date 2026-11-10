/* Todo Quest V72: fusion transactionnelle a trois versions.
   Un conflit sur un meme champ bloque la sauvegarde plutot que de perdre des donnees.
   Les tableaux d'objets identifies par id sont fusionnes par element. */
(function(global){
 'use strict';
 const MISSING=Symbol('absent');
 const eq=(a,b)=>a===MISSING||b===MISSING?a===b:JSON.stringify(a)===JSON.stringify(b);
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const keyed=x=>Array.isArray(x)&&x.every(v=>object(v)&&typeof v.id==='string')&&new Set(x.map(v=>v.id)).size===x.length;
 const own=(x,k)=>x&&Object.prototype.hasOwnProperty.call(x,k)?x[k]:MISSING;
 function merge(base,local,remote,path,conflicts){
   if(eq(local,base))return remote;
   if(eq(remote,base)||eq(local,remote))return local;
   if(object(local)&&object(remote)&&(object(base)||base===MISSING)){
     const keys=new Set([...Object.keys(base===MISSING?{}:base),...Object.keys(local),...Object.keys(remote)]);
     const result={};
     for(const key of keys){
       const value=merge(own(base,key),own(local,key),own(remote,key),path+'.'+key,conflicts);
       if(value!==MISSING) result[key]=value;
     }
     return result;
   }
   if(keyed(local)&&keyed(remote)&&(keyed(base)||base===MISSING)){
     const old=base===MISSING?[]:base;
     const toMap=items=>new Map(items.map(v=>[v.id,v]));
     const b=toMap(old),l=toMap(local),r=toMap(remote);
     const ids=[...new Set([...remote.map(v=>v.id),...local.map(v=>v.id),...old.map(v=>v.id)])];
     const result=[];
     for(const id of ids){
       const v=merge(b.has(id)?b.get(id):MISSING,l.has(id)?l.get(id):MISSING,r.has(id)?r.get(id):MISSING,path+'['+id+']',conflicts);
       if(v!==MISSING)result.push(v);
     }
     // Deux ordres differents modifies en parallele: signaler le conflit.
     const shared=old.map(v=>v.id).filter(id=>l.has(id)&&r.has(id));
     const seq=arr=>arr.map(v=>v.id).filter(id=>shared.includes(id)).join('|');
     if(seq(local)!==seq(old)&&seq(remote)!==seq(old)&&seq(local)!==seq(remote))conflicts.push(path+' (ordre)');
     // Preserver l'ordre utilisateur lorsque le cloud n'a pas reordonne.
     if(seq(remote)===seq(old)&&seq(local)!==seq(old)){
       const order=new Map(local.map((v,i)=>[v.id,i]));
       result.sort((a,b)=>(order.has(a.id)?order.get(a.id):1e9)-(order.has(b.id)?order.get(b.id):1e9));
     }
     return result;
   }
   conflicts.push(path);
   return remote;
 }
 global.TodoQuestMerge={
   threeWay(base,local,remote){const conflicts=[];const result=merge(base||{},local||{},remote||{},'data',conflicts);return {result,conflicts};}
 };
})(window);
