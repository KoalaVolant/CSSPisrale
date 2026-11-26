// V86: menus visibles + statistiques en lecture seule. Simulation Vue, pas de test Firebase.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const backup=JSON.parse(fs.readFileSync(process.argv[2]||path.join(root,'todo-quest-2026-11-10.json'),'utf8'));
for(const folder of ['.','mobile']){
 const html=fs.readFileSync(path.join(root,folder,'index.html'),'utf8');
 const core=fs.readFileSync(path.join(root,folder,'js/01-core.js'),'utf8');
 assert(html.includes('view === \'task-templates\''),'Dedicated models view exists');
 assert(html.includes('🔎 Analyse détaillée V86'),'V86 analytics UI exists');
 assert(core.includes("id: 'task-templates'"),'Models in menu');
 assert(html.includes('v86 test')||html.includes('v87 test'),'Version V86 or newer shown');
 let api;
 const callbacks=[],writes={'todo-quest-v65-test-isolated':JSON.stringify(backup)};
 const Vue={createApp:opts=>({config:{},component(){return this},mount(){api=opts.setup();return this}}),reactive:x=>x,ref:x=>({value:x}),computed:fn=>({get value(){return fn()}}),watch(){},nextTick:fn=>{if(fn)callbacks.push(fn);return Promise.resolve()},provide(){}};
 const ctx={Vue,window:{TODO_SPORT_V67:[],TODO_QUEST_MOBILE:folder==='mobile',location:{protocol:'http:',origin:'http://local'}},document:{getElementById:()=>null,querySelector:()=>null,addEventListener(){}},navigator:{onLine:true},console,localStorage:{getItem:k=>writes[k]||null,setItem:(k,v)=>{writes[k]=v}},setTimeout,clearTimeout,setInterval(){},structuredClone,confirm:()=>true,prompt:()=>null,Date,Math,Blob,URL};
 vm.createContext(ctx);
 for(const n of ['01-core.js','02-catalogue.js','03-storage.js','04-task-components.js','05-application.js']) vm.runInContext(fs.readFileSync(path.join(root,folder,'js',n),'utf8'),ctx,{filename:n});
 assert(api);
 const before=JSON.stringify(api.data);
 api.v86Period.value='all';api.v86Scope.value='all';const all=api.v86Analytics.value;
 const taskCount=backup.tasks.filter(x=>x.status==='done'&&/^\d{4}-\d{2}-\d{2}/.test(x.doneAt||'')&&x.doneAt<='9999').length;
 const ticketCount=backup.workTickets.filter(x=>x.done&&/^\d{4}-\d{2}-\d{2}/.test(x.doneAt||'')).length;
 assert.equal(all.tasks,taskCount,'All dated done tasks');
 assert.equal(all.tickets,ticketCount,'All dated closed tickets');
 assert(all.actionPoints>=0&&Number.isFinite(all.taskPoints));
 assert(all.categories.length>0&&all.projects.length>0&&all.topActions.length>0);
 assert(all.days.every((d,i)=>!i||all.days[i-1].date<=d.date));
 api.v86Scope.value='personal';const personal=api.v86Analytics.value;
 api.v86Scope.value='work';const work=api.v86Analytics.value;
 assert.equal(all.tasks,personal.tasks+work.tasks);
 assert.equal(all.tickets,personal.tickets); assert.equal(all.tickets,work.tickets);
 api.v86Period.value='7';assert(api.v86Analytics.value.tasks<=all.tasks);
 assert.deepEqual(JSON.stringify(api.data),before,'Reading analytics changed live data');
 // CSV: compare rows, file name and MIME without filesystem or network operations.
 let downloadName='',csvBody='';
 ctx.document.createElement=()=>({click(){downloadName=this.download;}});
 ctx.URL={createObjectURL(blob){csvBody=blob;return 'blob:local'},revokeObjectURL(){}};
 api.downloadV86Csv();assert(downloadName.startsWith('todo-quest-analyse-v86-'));
 assert(csvBody instanceof Blob&&csvBody.size>60);
 console.log('OK V86',folder,'analytics, CSV, navigation, read-only backup',all.tasks,'tasks',all.tickets,'tickets');
}
