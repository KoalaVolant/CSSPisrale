// Tests sans Firestore, pour la fusion V72. Node.js uniquement.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../sync-merge-v72.js'),'utf8');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(source,ctx);
const merge=(b,l,r)=>ctx.window.TodoQuestMerge.threeWay(b,l,r);
const check=(name,fun)=>{fun();console.log('OK:',name)};
check('Deux modules independants',()=>{
 const x=merge({tasks:[{id:'a',title:'A'}],habits:[{id:'h',n:0}]},{tasks:[{id:'a',title:'B'}],habits:[{id:'h',n:0}]},{tasks:[{id:'a',title:'A'}],habits:[{id:'h',n:1}]});
 assert.equal(x.conflicts.length,0);assert.equal(x.result.tasks[0].title,'B');assert.equal(x.result.habits[0].n,1);
});
check('Ajouts concurrents a identifiants differents',()=>{
 const x=merge({tasks:[]},{tasks:[{id:'local',title:'L'}]},{tasks:[{id:'remote',title:'R'}]});
 assert.equal(x.conflicts.length,0);assert.equal(x.result.tasks.map(t=>t.id).sort().join(','),'local,remote');
});
check('Champs independants du meme objet',()=>{
 const b={tasks:[{id:'a',title:'A',duration:10,effort:'light'}]};
 const l={tasks:[{id:'a',title:'B',duration:10,effort:'light'}]};
 const r={tasks:[{id:'a',title:'A',duration:20,effort:'light'}]};
 const x=merge(b,l,r);
 assert.equal(x.conflicts.length,0);assert.equal(x.result.tasks[0].title,'B');assert.equal(x.result.tasks[0].duration,20);
});
check('Modification du meme champ = conflit',()=>{
 const x=merge({tasks:[{id:'a',title:'A'}]},{tasks:[{id:'a',title:'B'}]},{tasks:[{id:'a',title:'C'}]});
 assert(x.conflicts.some(c=>c.includes('title')));assert.equal(x.result.tasks[0].title,'C');
});
check('Suppression vs modification = conflit',()=>{
 const x=merge({tasks:[{id:'a',title:'A'}]},{tasks:[]},{tasks:[{id:'a',title:'C'}]});
 assert(x.conflicts.length>0);
});
check('Suppression d un cote, autre element modifie',()=>{
 const b={tasks:[{id:'a',title:'A'},{id:'b',title:'B'}]};
 const l={tasks:[{id:'b',title:'B'}]};
 const r={tasks:[{id:'a',title:'A'},{id:'b',title:'B2'}]};
 const x=merge(b,l,r);
 assert.equal(x.conflicts.length,0);assert.equal(x.result.tasks.map(t=>t.id).join(','),'b');assert.equal(x.result.tasks[0].title,'B2');
});
check('Duree 2.5 minutes et effort modifies independamment',()=>{
 const b={tasks:[{id:'a',duration:5,effort:'light'}]};
 const x=merge(b,{tasks:[{id:'a',duration:2.5,effort:'light'}]},{tasks:[{id:'a',duration:5,effort:'medium'}]});
 assert.equal(x.conflicts.length,0);assert.equal(x.result.tasks[0].duration,2.5);assert.equal(x.result.tasks[0].effort,'medium');
});
console.log('Tests merger V72 : 7/7 OK (simulations sans backend).');
