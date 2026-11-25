// Tests d'etat V84 avec un harnais Vue minimal, sans backend ni navigateur.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
for(const platform of ['.','mobile']){
  let api, post=[];let writes={};let intervalCalls=[];
  const Vue={
    createApp:(opts)=>({config:{},component(){return this},mount(){api=opts.setup();post.splice(0).forEach(f=>f());return this}}),
    reactive:v=>v, ref:v=>({value:v}),computed:fn=>({get value(){return fn()}}),
    watch(){},nextTick:fn=>{if(fn)post.push(fn);return Promise.resolve()}, provide(){},
  };
  const window={TODO_SPORT_V67:[],TODO_QUEST_MOBILE:platform==='mobile', scrollTo(){},location:{protocol:'http:',origin:'http://local'}};
  const ctx={window,Vue,document:{getElementById(){return null},querySelector(){return null},addEventListener(){}},navigator:{onLine:true},localStorage:{getItem:key=>writes[key]||null,setItem:(key,v)=>{writes[key]=v}},console,setInterval:f=>{intervalCalls.push(f)},setTimeout,clearTimeout,URL,Blob,Date,Math,structuredClone,confirm:()=>true,prompt:()=>null};
  vm.createContext(ctx);
  const base=path.join(root,platform);
  for(const f of ['01-core.js','02-catalogue.js','03-storage.js','04-task-components.js','05-application.js'])vm.runInContext(fs.readFileSync(path.join(base,'js',f),'utf8'),ctx,{filename:f,timeout:30000});
  assert(api,'Vue setup returned '+platform);
  const txt=(v)=>JSON.parse(JSON.stringify(v));
  // Ticket creation respects quick inputs and historical Salesforce age.
  assert.equal(api.ticketQuickMode.value,true);
  Object.assign(api.ticketDraft,{name:'Essai V84',ageHours:'309',typeName:'Outlook',initialTaskName:'Vérifier',initialTaskPoints:5,due:'2027-02-01',url:'https://example.org/ticket/1',urgency:'high'});
  api.createTicket();
  const t=api.data.workTickets.at(-1);
  assert(t,'ticket created');
  assert.equal(t.name,'Essai V84');assert.equal(t.due,'');assert.equal(t.url,'');assert.equal(t.urgency,'');
  assert.equal(t.items.length,1);assert.equal(t.items[0].name,'Vérifier');
  assert(Math.abs((Date.now()-new Date(t.createdAtTime).getTime())/3600000-309)<.25,'Salesforce age');
  assert.equal(t.coolingAt,'');
  api.toggleTicketItem(t,t.items[0]);
  assert.equal(t.items[0].done,true);
  api.startCooling(t);
  assert.equal(api.ticketView.value,'cooling');assert(api.ticketInCooling(t));
  assert(api.coolingTickets.value.some(x=>x.id===t.id));assert(!api.openTickets.value.some(x=>x.id===t.id));
  // Cooling gets closed only after 7 days and only when every task is done.
  t.coolingUntil=new Date(Date.now()-1000).toISOString();
  api.processCooling();assert.equal(t.done,true);assert.equal(t.waiting,false);assert.equal(t.coolingAt,'');
  assert.equal(t.coolingHistory.at(-1).result,'auto-closed');
  api.reopenTicket(t);assert.equal(t.done,false);
  api.startCooling(t);
  api.toggleTicketItem(t,t.items[0]);
  assert(!api.ticketInCooling(t),'undo task cancels Cooling');
  api.startCooling(t); t.coolingUntil=new Date(Date.now()-1000).toISOString();api.processCooling();
  assert.equal(t.done,false,'pending actions block automatic close');
  api.reopenCooling(t);assert(!api.ticketInCooling(t));assert.equal(api.ticketView.value,'active');
  // Meal quick state is real data and can be reset without destroying detailed reports.
  const y=new Date(Date.now()-86400000).toISOString().slice(0,10);
  api.updateSimpleMeal(y,'lunch','Riz');
  api.quickMealState(y,'lunch','done');
  assert.equal(api.mealSlot(y,'lunch').state,'done');
  assert.equal(api.foodReview(y,'lunch').quick,true);
  api.quickMealState(y,'lunch','missed');
  assert.equal(api.foodReview(y,'lunch').completed,false);
  api.updateQuickMealActual(y,'lunch','Pates');
  assert.equal(api.foodReview(y,'lunch').completed,true);
  api.updateSimpleMeal(y,'lunch','Soup');
  assert.equal(api.foodReview(y,'lunch'),null);
  assert.equal(api.mealSlot(y,'lunch').state,'');
  // Centre de rappels, suppression durable du rappel sans supprimer le menu.
  const reminders=api.reminderItems.value;
  assert(reminders.some(x=>x.kind==='meal'&&x.date===y&&x.mealKind==='lunch'));
  const reminder=reminders.find(x=>x.kind==='meal'&&x.date===y&&x.mealKind==='lunch');
  api.dismissReminder(reminder);assert(!api.reminderItems.value.some(x=>x.key===reminder.key));
  assert.equal(api.mealSlot(y,'lunch').name,'Soup');
  // import old saves keeps data for reminders + closed tickets never marked waiting
  const old=txt(api.data);old.reminderDismissals={'mood:2026-11-01':'2026-11-02'};old.workTickets=[{id:'legacy',name:'Ancien',done:true,waiting:true,items:[],doneAt:y}];
  // applyData not exposed; validate load migration by reading/writing STORAGE_KEY then loadData in vm
  writes['todo-quest-v65-test-isolated']=JSON.stringify(old);
  const migrated=vm.runInContext('loadData()',ctx);
  assert.equal(migrated.workTickets[0].waiting,false);
  assert.equal(migrated.reminderDismissals['mood:2026-11-01'],'2026-11-02');
  console.log('OK V84 behaviour '+platform+' (creation, Cooling, meal, reminder, legacy load)');
}
