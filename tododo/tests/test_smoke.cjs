// Smoke test independent from external CDN / real Firebase: proves split scripts load
// into one global lexical environment, create the Vue app, register component and mount.
const fs=require('fs'); const vm=require('vm'); const path=require('path');const assert=require('assert');
const root=path.resolve(__dirname,'..');
for(const [dir,old] of [['.','app.js'],['mobile','app-mobile.js']]){
 const base=path.join(root,dir);
 let mounted=0,registered=0;
 const ctx={
  Vue:{createApp:(opts)=>({config:{},component:()=>{registered++},mount:()=>{mounted++}})},
  window:{TODO_SPORT_V67:[],TODO_QUEST_MOBILE:dir==='mobile'},
  console:console,localStorage:{getItem:()=>null,setItem:()=>{}},
  document:{},navigator:{},setTimeout,clearTimeout,
 };
 ctx.window.window=ctx.window;
 vm.createContext(ctx);
 for(const file of ['01-core.js','02-catalogue.js','03-storage.js','04-task-components.js','05-application.js']){
   const code=fs.readFileSync(path.join(base,'js',file),'utf8');
   vm.runInContext(code,ctx,{filename:file,timeout:30000});
 }
 assert.equal(mounted,1,`${dir} app mount`); assert.equal(registered,1,`${dir} component`);
 console.log(`OK ${dir}: sequential JS evaluation and Vue mount stub`);
}
// Regression for existing three-way merger: independent edits merge; divergent same-field edits flag conflict.
const ctx={window:{}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root,'sync-merge-v72.js'),'utf8'),ctx);
let {result,conflicts}=ctx.window.TodoQuestMerge.threeWay({tasks:[{id:'a',title:'A'},{id:'b',title:'B'}]}, {tasks:[{id:'a',title:'A1'},{id:'b',title:'B'}]}, {tasks:[{id:'a',title:'A'},{id:'b',title:'B1'}]});
assert.equal(conflicts.length,0);assert.equal(result.tasks.find(x=>x.id==='a').title,'A1');assert.equal(result.tasks.find(x=>x.id==='b').title,'B1');
({conflicts}=ctx.window.TodoQuestMerge.threeWay({tasks:[{id:'a',title:'A'}]}, {tasks:[{id:'a',title:'A1'}]}, {tasks:[{id:'a',title:'A2'}]}));
assert(conflicts.length>0);console.log('OK merge independent edits and conflict detection');
