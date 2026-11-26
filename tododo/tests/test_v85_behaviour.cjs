// Test V85 PC/mobile avec simulation Vue et anciennes donnees: pas un test Firestore reel.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const backupFile=process.argv[2] || path.join(root,'todo-quest-2026-11-10.json');
const backup=JSON.parse(fs.readFileSync(backupFile,'utf8'));
for(const platform of ['.','mobile']){
 let api;const post=[];const writes={'todo-quest-v65-test-isolated':JSON.stringify(backup)};
 const Vue={createApp:opts=>({config:{},component(){return this},mount(){api=opts.setup();post.splice(0).forEach(f=>f());return this}}),reactive:x=>x,ref:x=>({value:x}),computed:fn=>({get value(){return fn()}}),watch(){},nextTick:f=>{if(f)post.push(f);return Promise.resolve()},provide(){}};
 const window={TODO_SPORT_V67:[],TODO_QUEST_MOBILE:platform==='mobile',location:{protocol:'http:',origin:'http://local'}};
 const ctx={Vue,window,document:{getElementById:()=>null,querySelector:()=>null,addEventListener(){}},navigator:{onLine:true},console,localStorage:{getItem:k=>writes[k]||null,setItem:(k,v)=>{writes[k]=v}},setTimeout,clearTimeout,setInterval(){},structuredClone,confirm:()=>true,prompt:()=>null,Date,Math,Blob,URL};
 vm.createContext(ctx);
 const folder=path.join(root,platform,'js');
 for(const name of ['01-core.js','02-catalogue.js','03-storage.js','04-task-components.js','05-application.js'])vm.runInContext(fs.readFileSync(path.join(folder,name),'utf8'),ctx,{filename:name});
 assert(api,'vue setup returned');
 // Verifie migration de la vraie sauvegarde utilisateur sans alteration des objets historiques.
 assert.equal(api.data.tasks.length,backup.tasks.length,'legacy task count');
 assert.equal(api.data.workTickets.length,backup.workTickets.length,'legacy ticket count');
 assert(Array.isArray(api.data.taskListTemplates));assert(Array.isArray(api.data.customReminders));
 // Modele => taches a faire sans points acquis et sans toucher aux originales.
 const oldTasks=api.data.tasks.length;
 Object.assign(api.taskTemplateDraft,{name:'Ménage test',projectId:'',points:8,lines:'Vaisselle\nLitière\nVaisselle'});
 api.saveTaskListTemplate();assert.equal(api.data.taskListTemplates.length,1);
 api.createTasksFromTemplate(api.data.taskListTemplates[0]);
 assert.equal(api.data.tasks.length,oldTasks+2);assert(api.data.tasks.slice(-2).every(x=>x.status==='todo'&&x.doneAt===''));
 // Recherche et filtres combines + journal activite.
 Object.assign(api.ticketDraft,{name:'Essai suivi V85',ageHours:'100',typeName:'Test',initialTaskName:'Appeler',initialTaskPoints:5});
 api.createTicket();const t=api.data.workTickets.at(-1);
 assert(t.activityHistory.length>0);
 api.ticketSearch.value='Essai suivi';assert(api.filteredDisplayedTickets.value.some(x=>x.id===t.id));
 api.ticketStatusFilter.value='pending';assert(api.filteredDisplayedTickets.value.some(x=>x.id===t.id));
 api.ticketTypeFilter.value='nonesuch';assert(!api.filteredDisplayedTickets.value.some(x=>x.id===t.id));
 api.ticketTypeFilter.value='';api.ticketStatusFilter.value='all';
 api.toggleTicketItem(t,t.items[0]);assert(t.activityHistory.some(x=>x.label.includes('terminée')));
 api.startCooling(t);const before=new Date(t.coolingUntil).getTime();api.extendCooling(t,7);
 assert(new Date(t.coolingUntil).getTime()>=before+6*86400000,'Cooling extended at least 6 days');
 assert(t.activityHistory.some(x=>x.label.includes('prolongé')));
 api.ticketView.value='cooling';api.ticketStatusFilter.value='expiring';assert(!api.filteredDisplayedTickets.value.some(x=>x.id===t.id));
 api.ticketStatusFilter.value='all';api.reopenCooling(t);assert(!api.ticketInCooling(t));
 // Rappel programme + report + acquittement (sans notif systeme).
 api.reminderDraft.label='Retour test';api.reminderDraft.date=new Date().toISOString().slice(0,10);api.reminderDraft.time='00:00';api.reminderDraft.repeat='none';api.addCustomReminder();
 const reminder=api.reminderItems.value.find(x=>x.kind==='custom'&&x.label==='Retour test');assert(reminder);
 api.snoozeReminder(reminder,1);assert(!api.reminderItems.value.some(x=>x.key===reminder.key));
 delete api.data.reminderSnoozes[reminder.key];api.dismissReminder(reminder);assert(!api.reminderItems.value.some(x=>x.key===reminder.key));
 // 4 dernieres semaines et points sans doublon.
 assert.equal(api.v85WeeklyTrends.value.length,4);assert(api.v85WeeklyTrends.value.every(x=>Number.isFinite(x.points)));
 assert.equal(api.localSaveError.value,'');
 // sauvegarde chargee garde ses donnees d'origine en dehors des tests de creation explicites.
 assert(api.data.appointments.length===backup.appointments.length);
 console.log('OK V85',platform,': old JSON, templates, search, Cooling, history, reminders, weekly stats');
}
